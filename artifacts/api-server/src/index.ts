import app from "./app";
import { logger } from "./lib/logger";
import cron from "node-cron";
import { startBatchJob } from "./lib/batch-processor";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { recordCronRun } from "./lib/cron-runs";
import { isOutlookConnected, probeOutlook } from "./lib/outlook";
import { recordConnectorHealth } from "./lib/connector-health";
import { resetStuckSubmissions } from "./lib/stuck-submissions";

// Boot-time DB ops have to tolerate a cold Neon serverless endpoint that
// auto-suspends after inactivity. The first query then fails with
// "The endpoint has been disabled. Enable it using the API and retry." but
// the act of querying wakes the endpoint, so a short retry succeeds.
// Without this, all the boot-time backfills silently fail on every cold
// production boot.
async function runWithDbWarmupRetry<T>(name: string, fn: () => Promise<T>, attempts = 5): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      const isColdEndpoint = /endpoint has been disabled|endpoint is disabled|Connection terminated|ECONNRESET|ETIMEDOUT/i.test(msg);
      if (i < attempts - 1 && isColdEndpoint) {
        const delayMs = 1000 * 2 ** i;
        logger.warn({ name, attempt: i + 1, delayMs, err: msg }, `Boot block: db endpoint cold, retrying`);
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

(async () => {
  try {
    await runWithDbWarmupRetry("attachment_urls backfill", () => db.execute(sql`
      UPDATE portal_submissions ps
      SET attachment_urls = (
        SELECT COALESCE(json_agg(ce.image_url), '[]'::json)
        FROM claim_evidence ce
        WHERE ce.claim_id = ps.claim_id
          AND ce.image_url IS NOT NULL
          AND ce.image_url != ''
      )
      WHERE (ps.attachment_urls IS NULL OR ps.attachment_urls::text = '[]' OR ps.attachment_urls::text = 'null')
        AND ps.claim_id IS NOT NULL
    `));
    logger.info("One-time migration: backfilled attachment_urls from claim_evidence");
  } catch (err) {
    logger.warn({ err }, "One-time migration: attachment_urls backfill failed");
  }

  try {
    await runWithDbWarmupRetry("conversation_id backfill", () => db.execute(sql`
      UPDATE portal_responses
      SET conversation_id = metadata->>'conversationId'
      WHERE conversation_id IS NULL
        AND metadata ? 'conversationId'
    `));
    logger.info("One-time migration: backfilled portal_responses.conversation_id from metadata");
  } catch (err) {
    logger.warn({ err }, "One-time migration: conversation_id backfill failed");
  }

  // Task #64: re-queue last night's three failed batch portal submissions
  // (#9, #10, #12) that hit the midnight Freshdesk-portal `networkidle` timeout.
  // PRODUCTION ONLY — the failed rows live in the deployed database; we
  // explicitly skip dev/staging boots so this never accidentally touches
  // unrelated rows that happen to share IDs in another environment.
  // Idempotent: each submission is only touched if it is still status='failed'
  // AND no `submission_manual_requeue` audit row already exists for it. Leaves
  // `attempts` unchanged so they still have 3 of 4 attempts left, and writes
  // an audit row per submission so the daily brief can surface the action.
  const isProduction = process.env.NODE_ENV === "production" || process.env.REPLIT_DEPLOYMENT === "1";
  if (!isProduction) {
    logger.info({ nodeEnv: process.env.NODE_ENV, replitDeployment: process.env.REPLIT_DEPLOYMENT }, "Task #64 backfill: skipping (not production)");
  } else try {
    const result = await runWithDbWarmupRetry("Task #64 backfill", () => db.execute(sql`
      WITH targets AS (
        SELECT id, claim_id
        FROM portal_submissions
        WHERE id IN (9, 10, 12)
          AND status = 'failed'
          AND NOT EXISTS (
            SELECT 1 FROM audit_logs al
            WHERE al.action = 'submission_manual_requeue'
              AND (al.metadata->>'submissionId')::int = portal_submissions.id
          )
      ),
      updated AS (
        UPDATE portal_submissions ps
        SET status = 'pending',
            next_retry_at = NOW(),
            error_message = NULL,
            updated_at = NOW()
        FROM targets t
        WHERE ps.id = t.id
        RETURNING ps.id, ps.claim_id
      )
      INSERT INTO audit_logs (claim_id, action, details, metadata, user_email, user_name)
      SELECT
        u.claim_id,
        'submission_manual_requeue',
        'Auto re-queued after the 2026-04-24 midnight Freshdesk portal slowdown (Task #64). Attempts unchanged; bot will retry on next poll.',
        jsonb_build_object(
          'submissionId', u.id,
          'reason', 'Midnight portal networkidle timeout (~2026-04-24 00:00 ET); portal slowdown not a code bug. See Task #64.',
          'task', 64
        ),
        'system@claimclear',
        'System (Task #64 backfill)'
      FROM updated u
      RETURNING (metadata->>'submissionId')::int AS submission_id
    `));
    const requeuedIds = (result.rows ?? []).map((r) => (r as { submission_id?: number }).submission_id).filter((n): n is number => typeof n === "number");
    if (requeuedIds.length > 0) {
      logger.info({ requeuedIds }, "Task #64 backfill: manually re-queued failed batch submissions");
    } else {
      logger.info("Task #64 backfill: no submissions needed re-queueing (already done or no longer failed)");
    }
  } catch (err) {
    logger.warn({ err }, "Task #64 backfill: re-queue failed batch submissions failed");
  }

  // Followup to Task #64: submissions #9 and #10 went through all 4 retries
  // on subsequent nights and exhausted at 4/4 (each retry landed inside the
  // same recurring midnight Freshdesk slowdown window). With the new wider
  // retry schedule [5m, 30m, 4h, 8h] and the loosened login-page navigation,
  // give them a full fresh batch of attempts by resetting attempts → 0.
  // PRODUCTION ONLY. Idempotent: gated by an audit row whose metadata
  // contains `phase: 'attempts-reset-apr27'`, distinct from the original
  // Task #64 backfill marker so it doesn't collide.
  if (!isProduction) {
    logger.info({ nodeEnv: process.env.NODE_ENV, replitDeployment: process.env.REPLIT_DEPLOYMENT }, "Apr-27 attempts reset: skipping (not production)");
  } else try {
    const result = await runWithDbWarmupRetry("Apr-27 attempts reset", () => db.execute(sql`
      WITH targets AS (
        SELECT id, claim_id
        FROM portal_submissions
        WHERE id IN (9, 10)
          AND status = 'failed'
          AND attempts >= max_attempts
          AND NOT EXISTS (
            SELECT 1 FROM audit_logs al
            WHERE al.action = 'submission_manual_requeue'
              AND (al.metadata->>'submissionId')::int = portal_submissions.id
              AND al.metadata->>'phase' = 'attempts-reset-apr27'
          )
      ),
      updated AS (
        UPDATE portal_submissions ps
        SET status = 'pending',
            attempts = 0,
            next_retry_at = NULL,
            error_message = NULL,
            updated_at = NOW()
        FROM targets t
        WHERE ps.id = t.id
        RETURNING ps.id, ps.claim_id
      )
      INSERT INTO audit_logs (claim_id, action, details, metadata, user_email, user_name)
      SELECT
        u.claim_id,
        'submission_manual_requeue',
        'Reset to 0/4 attempts after retries exhausted across the recurring 2026-04-24..27 midnight Freshdesk slowdown. New retry schedule [5m, 30m, 4h, 8h] now spreads attempts so at least one lands outside the slow window. Login-page navigation also loosened to match the form-page fix.',
        jsonb_build_object(
          'submissionId', u.id,
          'phase', 'attempts-reset-apr27',
          'previousStatus', 'failed',
          'previousAttempts', 4,
          'reason', 'Recurring midnight portal slowdown exhausted retries on 4 consecutive nights.',
          'newScheduleMinutes', jsonb_build_array(5, 30, 240, 480)
        ),
        'system@claimclear',
        'System (Apr-27 attempts reset)'
      FROM updated u
      RETURNING (metadata->>'submissionId')::int AS submission_id
    `));
    const resetIds = (result.rows ?? []).map((r) => (r as { submission_id?: number }).submission_id).filter((n): n is number => typeof n === "number");
    if (resetIds.length > 0) {
      logger.info({ resetIds }, "Apr-27 attempts reset: manually reset attempts to 0 for exhausted submissions");
    } else {
      logger.info("Apr-27 attempts reset: no submissions needed reset (already done or no longer exhausted)");
    }
  } catch (err) {
    logger.warn({ err }, "Apr-27 attempts reset: failed");
  }
})();

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});

cron.schedule("0 0 * * *", async () => {
  await recordCronRun("midnight_portal_processor", async () => {
    logger.info("Midnight cron: processing all pending portal submissions");
    try {
      const job = await startBatchJob("all", "Midnight Auto-Process");
      logger.info({ batchId: job.id, total: job.total }, "Midnight batch job started");
      return { message: `Started batch ${job.id} with ${job.total} submissions`, metadata: { batchId: job.id, total: job.total } };
    } catch (err) {
      logger.info("Midnight cron: no pending submissions to process");
      return { message: "No pending submissions to process" };
    }
  });
}, { timezone: "America/New_York" });

if (!process.env.BOT_SERVICE_TOKEN) {
  logger.warn("BOT_SERVICE_TOKEN not set; cron jobs that call internal HTTP endpoints will fail authentication.");
}

cron.schedule("0 7 * * 1-5", async () => {
  await recordCronRun("daily_brief", async () => {
    logger.info("Daily brief cron: sending morning brief");
    const res = await fetch(`http://localhost:${port}/api/daily-brief`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-bot-token": process.env.BOT_SERVICE_TOKEN ?? "" },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(`Daily brief HTTP ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
    }
    logger.info({ result: data }, "Daily brief sent");
    return { message: data?.message ?? "Daily brief sent", metadata: data };
  });
}, { timezone: "America/New_York" });

cron.schedule("*/30 8-18 * * 1-5", async () => {
  await recordCronRun("response_tracker", async () => {
    logger.info("Response tracker cron: checking email inbox for responses");
    const res = await fetch(`http://localhost:${port}/api/responses/check-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-bot-token": process.env.BOT_SERVICE_TOKEN ?? "" },
      body: JSON.stringify({ hoursBack: 1 }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(`Response tracker HTTP ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
    }
    logger.info({ result: data }, "Email response check completed");
    return {
      message: `${data?.checked ?? 0} checked, ${data?.matched ?? 0} matched, ${data?.bounces ?? 0} bounces`,
      metadata: data,
    };
  });
}, { timezone: "America/New_York" });

cron.schedule("*/15 * * * *", async () => {
  await recordCronRun("outlook_heartbeat", async () => {
    const tokenOk = await isOutlookConnected();
    if (!tokenOk) {
      await recordConnectorHealth("outlook", "unhealthy", "No valid OAuth token / not connected");
      return { message: "Outlook unhealthy: no token" };
    }
    const probe = await probeOutlook();
    if (!probe.ok) {
      await recordConnectorHealth("outlook", "unhealthy", probe.error ?? "/me probe failed");
      return { message: `Outlook unhealthy: ${probe.error?.slice(0, 120) ?? "probe failed"}` };
    }
    await recordConnectorHealth("outlook", "healthy", null, { email: probe.email });
    return { message: `Outlook healthy (${probe.email ?? "unknown mailbox"})` };
  });
}, { timezone: "America/New_York" });

cron.schedule("*/30 * * * *", async () => {
  await recordCronRun("stuck_submission_reset", async () => {
    const result = await resetStuckSubmissions();
    return {
      message: result.reset === 0
        ? "No stuck portal submissions found"
        : `Reset ${result.reset} stuck portal submission${result.reset === 1 ? "" : "s"}`,
      metadata: { reset: result.reset, ids: result.ids },
    };
  });
}, { timezone: "America/New_York" });

// Run an initial heartbeat shortly after boot so System Health has data immediately.
setTimeout(() => {
  recordCronRun("outlook_heartbeat", async () => {
    const tokenOk = await isOutlookConnected();
    if (!tokenOk) {
      await recordConnectorHealth("outlook", "unhealthy", "No valid OAuth token / not connected");
      return { message: "Outlook unhealthy: no token" };
    }
    const probe = await probeOutlook();
    if (!probe.ok) {
      await recordConnectorHealth("outlook", "unhealthy", probe.error ?? "/me probe failed");
      return { message: `Outlook unhealthy: ${probe.error?.slice(0, 120)}` };
    }
    await recordConnectorHealth("outlook", "healthy", null, { email: probe.email });
    return { message: `Outlook healthy (${probe.email ?? "unknown mailbox"})` };
  }).catch(() => undefined);
}, 5000);
