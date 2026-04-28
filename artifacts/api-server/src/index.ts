import app from "./app";
import { logger } from "./lib/logger";
import cron from "node-cron";
import { triggerWorkerRun, jobToCronOutcome, clearOrphanedBatchClaims } from "./lib/batch-processor";
import { db } from "@workspace/db";
import { sql, eq, and, or, isNull, lte, count } from "drizzle-orm";
import { portalSubmissionsTable } from "@workspace/db";
import { recordCronRun } from "./lib/cron-runs";
import { isOutlookConnected, probeOutlook } from "./lib/outlook";
import { recordConnectorHealth } from "./lib/connector-health";
import { resetStuckSubmissions } from "./lib/stuck-submissions";

// Cap on how long a cron-triggered worker run blocks its cron lane. On
// timeout the cron row is recorded as degraded and the worker continues in
// the background; stuck-running rollup detection escalates if it hangs.
const WORKER_AWAIT_TIMEOUT_MS = 20 * 60 * 1000;

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

  // Task #74 closure_reason backfill (production only, idempotent via
  // audit-log marker). Per-row classification of historical Denied rows
  // applied in priority order:
  //   1. Explicit "Accept as Loss" post-response audit -> Withdrawn + accepted_loss + Resolved
  //   2. response_received audit BEFORE the manual denial event       -> Withdrawn + accepted_loss + Resolved
  //   3. manual denial event AND no portal_response on file           -> Withdrawn + not_contestable + Resolved
  //   4. otherwise (auto-denial from response_received / response_reassign,
  //      i.e. real payer denial)                                       -> stays Denied + payer_denied
  if (!isProduction) {
    logger.info({ nodeEnv: process.env.NODE_ENV, replitDeployment: process.env.REPLIT_DEPLOYMENT }, "Task #74 closure_reason backfill: skipping (not production)");
  } else try {
    type ClassifiedRow = { id: number; closureReason: "payer_denied" | "not_contestable" | "accepted_loss"; toWithdrawn: boolean; rationale: string };
    const BACKFILL_PHASE = "task-74-closure-reason-backfill";
    const MANUAL_SOURCES = new Set(["manual", "post_response_action", "manual_outcome_change"]);
    const toDate = (v: string | Date | null | undefined): Date | null => {
      if (v == null) return null;
      const d = v instanceof Date ? v : new Date(v);
      return Number.isNaN(d.getTime()) ? null : d;
    };

    // ---- Claims ----
    const claimCandidates = await runWithDbWarmupRetry("Task #74 claim candidates", () => db.execute(sql`
      SELECT c.id
      FROM claims c
      WHERE c.outcome = 'Denied' AND c.closure_reason IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM audit_logs al
          WHERE al.claim_id = c.id
            AND al.action = 'closure_reason_backfill'
            AND al.metadata->>'phase' = ${BACKFILL_PHASE}
        )
    `));
    const claimRows: ClassifiedRow[] = [];
    for (const r of (claimCandidates.rows ?? []) as Array<{ id: number }>) {
      const claimId = r.id;

      // Rule 1: explicit accept-as-loss action.
      const acceptLossAudit = await runWithDbWarmupRetry(`Task #74 claim ${claimId} accept_loss check`, () => db.execute(sql`
        SELECT 1 FROM audit_logs
        WHERE claim_id = ${claimId}
          AND metadata->>'source' = 'post_response_action'
          AND (
            details ILIKE '%Accept as Loss%'
            OR metadata->>'action' = 'accept_loss'
            OR metadata->>'reason' ILIKE '%accept as loss%'
          )
        LIMIT 1
      `));
      if (((acceptLossAudit.rows ?? []) as unknown[]).length > 0) {
        claimRows.push({ id: claimId, closureReason: "accepted_loss", toWithdrawn: true, rationale: "audit shows explicit Accept-as-Loss post-response action" });
        continue;
      }

      // Most-recent audit entry that established outcome=Denied.
      const denialEventRes = await runWithDbWarmupRetry(`Task #74 claim ${claimId} denial event`, () => db.execute(sql`
        SELECT timestamp AS at, metadata->>'source' AS source
        FROM audit_logs
        WHERE claim_id = ${claimId}
          AND action IN ('outcome_changed', 'status_and_outcome_changed')
          AND (metadata->>'to' = 'Denied' OR metadata->>'toOutcome' = 'Denied')
        ORDER BY timestamp DESC
        LIMIT 1
      `));
      const denialEvent = (denialEventRes.rows ?? [])[0] as { at?: string | Date; source?: string } | undefined;
      const denialIsManual = !!denialEvent && MANUAL_SOURCES.has(denialEvent.source ?? "");
      const denialAt = toDate(denialEvent?.at);

      // First portal/email response on this claim (any).
      const firstResponseRes = await runWithDbWarmupRetry(`Task #74 claim ${claimId} first response`, () => db.execute(sql`
        SELECT received_at FROM portal_responses WHERE claim_id = ${claimId}
        ORDER BY received_at ASC LIMIT 1
      `));
      const firstResp = (firstResponseRes.rows ?? [])[0] as { received_at?: string | Date } | undefined;
      const firstRespAt = toDate(firstResp?.received_at);

      // Rule 2: response received BEFORE a manual denial event => accepted_loss.
      if (denialIsManual && firstRespAt && denialAt && firstRespAt.getTime() <= denialAt.getTime()) {
        claimRows.push({ id: claimId, closureReason: "accepted_loss", toWithdrawn: true, rationale: `response received at ${firstRespAt.toISOString()} preceded manual denial at ${denialAt.toISOString()} — staff accepted the loss` });
        continue;
      }

      // Rule 3: manual denial AND no response on file => not_contestable.
      // (Also covers the case where there is no audit at all but no response either.)
      if ((denialIsManual || !denialEvent) && !firstRespAt) {
        claimRows.push({ id: claimId, closureReason: "not_contestable", toWithdrawn: true, rationale: "no portal/email response was ever recorded — staff-initiated closure of an uncontestable claim" });
        continue;
      }

      // Rule 4: real payer denial.
      claimRows.push({ id: claimId, closureReason: "payer_denied", toWithdrawn: false, rationale: denialEvent ? `denial recorded by source='${denialEvent.source ?? "unknown"}' with payer response on file` : "payer response on file with no contradicting manual-closure history" });
    }

    for (const row of claimRows) {
      if (row.toWithdrawn) {
        await runWithDbWarmupRetry(`Task #74 claim ${row.id} update`, () => db.execute(sql`
          UPDATE claims
          SET outcome = 'Withdrawn', status = 'Resolved', closure_reason = ${row.closureReason}
          WHERE id = ${row.id}
        `));
      } else {
        await runWithDbWarmupRetry(`Task #74 claim ${row.id} update`, () => db.execute(sql`
          UPDATE claims SET closure_reason = ${row.closureReason} WHERE id = ${row.id}
        `));
      }
      await runWithDbWarmupRetry(`Task #74 claim ${row.id} audit`, () => db.execute(sql`
        INSERT INTO audit_logs (claim_id, action, details, metadata, user_email, user_name)
        VALUES (
          ${row.id},
          'closure_reason_backfill',
          ${`Task #74 backfill: ${row.toWithdrawn ? `outcome Denied → Withdrawn, status → Resolved, closure_reason='${row.closureReason}'` : `closure_reason='${row.closureReason}'`} — ${row.rationale}.`},
          jsonb_build_object(
            'phase', ${BACKFILL_PHASE},
            'task', 74,
            'closureReason', ${row.closureReason},
            'reclassifiedToWithdrawn', ${row.toWithdrawn},
            'rationale', ${row.rationale}
          ),
          'system@claimclear',
          'System (Task #74 backfill)'
        )
      `));
    }

    // ---- Invoice groups ----
    const groupCandidates = await runWithDbWarmupRetry("Task #74 group candidates", () => db.execute(sql`
      SELECT g.id
      FROM invoice_groups g
      WHERE g.outcome = 'Denied' AND g.closure_reason IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM audit_logs al
          WHERE al.invoice_group_id = g.id
            AND al.action = 'closure_reason_backfill'
            AND al.metadata->>'phase' = ${BACKFILL_PHASE}
        )
    `));
    const groupRows: ClassifiedRow[] = [];
    for (const r of (groupCandidates.rows ?? []) as Array<{ id: number }>) {
      const groupId = r.id;

      // Rule 1: explicit accept-as-loss action.
      const acceptLossAudit = await runWithDbWarmupRetry(`Task #74 group ${groupId} accept_loss check`, () => db.execute(sql`
        SELECT 1 FROM audit_logs
        WHERE invoice_group_id = ${groupId}
          AND metadata->>'source' = 'post_response_action'
          AND (
            details ILIKE '%Accept as Loss%'
            OR metadata->>'action' = 'accept_loss'
            OR metadata->>'reason' ILIKE '%accept as loss%'
          )
        LIMIT 1
      `));
      if (((acceptLossAudit.rows ?? []) as unknown[]).length > 0) {
        groupRows.push({ id: groupId, closureReason: "accepted_loss", toWithdrawn: true, rationale: "audit shows explicit Accept-as-Loss post-response action" });
        continue;
      }

      // Most-recent audit entry that established outcome=Denied on this group.
      const denialEventRes = await runWithDbWarmupRetry(`Task #74 group ${groupId} denial event`, () => db.execute(sql`
        SELECT timestamp AS at, metadata->>'source' AS source
        FROM audit_logs
        WHERE invoice_group_id = ${groupId}
          AND action IN ('group_outcome_changed', 'group_status_and_outcome_changed')
          AND (metadata->>'to' = 'Denied' OR metadata->>'toOutcome' = 'Denied')
        ORDER BY timestamp DESC
        LIMIT 1
      `));
      const denialEvent = (denialEventRes.rows ?? [])[0] as { at?: string | Date; source?: string } | undefined;
      const denialIsManual = !!denialEvent && MANUAL_SOURCES.has(denialEvent.source ?? "");
      const denialAt = toDate(denialEvent?.at);

      // First portal/email response on this group (direct or child-claim-linked).
      const firstResponseRes = await runWithDbWarmupRetry(`Task #74 group ${groupId} first response`, () => db.execute(sql`
        SELECT received_at FROM portal_responses
        WHERE invoice_group_id = ${groupId}
           OR claim_id IN (SELECT id FROM claims WHERE invoice_group_id = ${groupId})
        ORDER BY received_at ASC LIMIT 1
      `));
      const firstResp = (firstResponseRes.rows ?? [])[0] as { received_at?: string | Date } | undefined;
      const firstRespAt = toDate(firstResp?.received_at);

      // Rule 2: response received BEFORE a manual denial event => accepted_loss.
      if (denialIsManual && firstRespAt && denialAt && firstRespAt.getTime() <= denialAt.getTime()) {
        groupRows.push({ id: groupId, closureReason: "accepted_loss", toWithdrawn: true, rationale: `response received at ${firstRespAt.toISOString()} preceded manual denial at ${denialAt.toISOString()} — staff accepted the loss` });
        continue;
      }

      // Rule 3: manual denial AND no response on file => not_contestable.
      if ((denialIsManual || !denialEvent) && !firstRespAt) {
        groupRows.push({ id: groupId, closureReason: "not_contestable", toWithdrawn: true, rationale: "no portal/email response was ever recorded for this invoice group — staff-initiated closure of an uncontestable group" });
        continue;
      }

      // Rule 4: real payer denial.
      groupRows.push({ id: groupId, closureReason: "payer_denied", toWithdrawn: false, rationale: denialEvent ? `denial recorded by source='${denialEvent.source ?? "unknown"}' with payer response on file` : "payer response on file with no contradicting manual-closure history" });
    }

    for (const row of groupRows) {
      if (row.toWithdrawn) {
        await runWithDbWarmupRetry(`Task #74 group ${row.id} update`, () => db.execute(sql`
          UPDATE invoice_groups
          SET outcome = 'Withdrawn', status = 'Resolved', closure_reason = ${row.closureReason}
          WHERE id = ${row.id}
        `));
      } else {
        await runWithDbWarmupRetry(`Task #74 group ${row.id} update`, () => db.execute(sql`
          UPDATE invoice_groups SET closure_reason = ${row.closureReason} WHERE id = ${row.id}
        `));
      }
      await runWithDbWarmupRetry(`Task #74 group ${row.id} audit`, () => db.execute(sql`
        INSERT INTO audit_logs (invoice_group_id, action, details, metadata, user_email, user_name)
        VALUES (
          ${row.id},
          'closure_reason_backfill',
          ${`Task #74 backfill: ${row.toWithdrawn ? `outcome Denied → Withdrawn, status → Resolved, closure_reason='${row.closureReason}'` : `closure_reason='${row.closureReason}'`} — ${row.rationale}.`},
          jsonb_build_object(
            'phase', ${BACKFILL_PHASE},
            'task', 74,
            'closureReason', ${row.closureReason},
            'reclassifiedToWithdrawn', ${row.toWithdrawn},
            'rationale', ${row.rationale}
          ),
          'system@claimclear',
          'System (Task #74 backfill)'
        )
      `));
    }

    logger.info({
      claims: claimRows.map((r) => ({ id: r.id, closureReason: r.closureReason, reclassifiedToWithdrawn: r.toWithdrawn })),
      groups: groupRows.map((r) => ({ id: r.id, closureReason: r.closureReason, reclassifiedToWithdrawn: r.toWithdrawn })),
    }, "Task #74 closure_reason backfill: classified and reclassified historical Denied rows");
  } catch (err) {
    logger.warn({ err }, "Task #74 closure_reason backfill: failed");
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

  // Boot cleanup: any rows still flagged as Queued by an in-memory batch from
  // a prior process are orphaned (the batch state was lost on restart). Clear
  // them so they show as plain Pending and the next run can pick them up.
  clearOrphanedBatchClaims().catch((cleanupErr) => {
    logger.error({ err: cleanupErr }, "Boot cleanup of orphaned batch claims failed");
  });
});

cron.schedule("0 0 * * *", async () => {
  await recordCronRun("midnight_portal_processor", async () => {
    logger.info("Midnight cron: triggering on-demand worker run");
    const outcome = await triggerWorkerRun({
      triggeredBy: "Midnight Auto-Process",
      awaitCompletion: true,
      awaitTimeoutMs: WORKER_AWAIT_TIMEOUT_MS,
    });
    if (outcome.kind === "skipped") {
      const message = outcome.reason === "no_pending"
        ? "No pending submissions to process"
        : "Worker already running — midnight trigger coalesced";
      logger.info({ reason: outcome.reason }, message);
      return { message, metadata: { skipped: true, reason: outcome.reason } };
    }
    const { job, awaited } = outcome;
    if (awaited === "timeout") {
      // Watchdog tripped — record degraded so the rollup surfaces the hang
      // without leaving the cron lane blocked. The worker keeps running in
      // the background; if it never returns, the stuck-running rollup
      // detection (2x interval grace) escalates further.
      const message = `Worker run ${job.id} watchdog: still in progress after ${WORKER_AWAIT_TIMEOUT_MS / 60000}m, releasing cron lane`;
      logger.warn({ batchId: job.id }, message);
      return {
        status: "degraded",
        message,
        metadata: { batchId: job.id, watchdogTimeoutMs: WORKER_AWAIT_TIMEOUT_MS, jobStatus: job.status },
      };
    }
    const message = `Worker run ${job.id} completed: ${job.succeeded}/${job.total} succeeded, ${job.failed} failed`;
    const sev = jobToCronOutcome(job, message);
    if (sev.kind === "throw") throw new Error(sev.message);
    return {
      status: sev.status,
      message: sev.message,
      metadata: { batchId: job.id, total: job.total, succeeded: job.succeeded, failed: job.failed, jobStatus: job.status },
    };
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

// On-demand portal worker sweeper. Runs every 5 minutes; if any pending
// submissions are due (next_retry_at <= now or NULL), triggers a fresh
// worker run. The triggerWorkerRun gate ensures only one Playwright instance
// is in flight at a time, so concurrent sweeps + admin batches coalesce
// safely.
cron.schedule("*/5 * * * *", async () => {
  await recordCronRun("portal_retry_sweeper", async () => {
    const [{ value: dueCount } = { value: 0 }] = await db
      .select({ value: count() })
      .from(portalSubmissionsTable)
      .where(and(
        eq(portalSubmissionsTable.status, "pending"),
        or(
          isNull(portalSubmissionsTable.nextRetryAt),
          lte(portalSubmissionsTable.nextRetryAt, new Date()),
        ),
      ));

    if (dueCount === 0) {
      return { message: "No pending submissions due", metadata: { dueCount: 0 } };
    }

    const outcome = await triggerWorkerRun({
      triggeredBy: "Retry Sweeper",
      awaitCompletion: true,
      awaitTimeoutMs: WORKER_AWAIT_TIMEOUT_MS,
    });

    if (outcome.kind === "skipped") {
      const message = outcome.reason === "already_running"
        ? `Worker already running — sweeper coalesced (${dueCount} due)`
        : "No pending submissions to process";
      return { message, metadata: { dueCount, skipped: true, reason: outcome.reason } };
    }

    const { job, awaited } = outcome;
    if (awaited === "timeout") {
      const message = `Sweeper worker run ${job.id} watchdog: still in progress after ${WORKER_AWAIT_TIMEOUT_MS / 60000}m, releasing cron lane`;
      logger.warn({ batchId: job.id, dueCount }, message);
      return {
        status: "degraded",
        message,
        metadata: { batchId: job.id, dueCount, watchdogTimeoutMs: WORKER_AWAIT_TIMEOUT_MS, jobStatus: job.status },
      };
    }
    const message = `Sweeper worker run ${job.id} completed: ${job.succeeded}/${job.total} succeeded, ${job.failed} failed (${dueCount} were due)`;
    const sev = jobToCronOutcome(job, message);
    if (sev.kind === "throw") throw new Error(sev.message);
    return {
      status: sev.status,
      message: sev.message,
      metadata: { batchId: job.id, total: job.total, succeeded: job.succeeded, failed: job.failed, dueCount, jobStatus: job.status },
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
