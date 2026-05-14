// Startup-error guard MUST come first so its process-level handlers are
// registered before any other top-level module code runs. See Task #258.
import { markServerStarted } from "./lib/startup-guard";
import app from "./app";
import { logger } from "./lib/logger";
import { startReplyAttachmentStagingJanitor } from "./lib/reply-attachments";
import cron from "node-cron";
import { triggerWorkerRun, jobToCronOutcome, clearOrphanedBatchClaims, markOrphanedRunningBatchesAsFailed } from "./lib/batch-processor";
import { db } from "@workspace/db";
import { sql, eq, and, or, isNull, lte, count } from "drizzle-orm";
import { portalSubmissionsTable } from "@workspace/db";
import { recordCronRun } from "./lib/cron-runs";
import { isOutlookConnected, probeOutlook } from "./lib/outlook";
import { recordConnectorHealth } from "./lib/connector-health";
import { resetStuckSubmissions } from "./lib/stuck-submissions";
import {
  PORTAL_BATCH_SWEEPER,
  DAILY_BRIEF,
  DAILY_BRIEF_BOUNCE_RECHECK,
  WEEKLY_DIGEST,
  WEEKLY_DIGEST_BOUNCE_RECHECK,
  RESPONSE_TRACKER,
  PORTAL_RESPONSE_SYNC,
  OUTLOOK_HEARTBEAT,
  STUCK_SUBMISSION_RESET,
  URGENT_SNAPSHOT,
  EXPIRED_SWEEP,
} from "./lib/cron-schedule";
import { recheckPreviousRunBounces } from "./routes/daily-brief";
import { snapshotUrgentCounts } from "./lib/urgent-snapshot";
import { sweepExpiredGroups } from "./lib/expired-sweep";

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
  // Removed (Task #199): one-time attachment_urls backfill from claim_evidence.
  // The source column portal_submissions.claim_id was dropped during the
  // per-invoice cutover; the backfill ran in production prior to drop, so
  // this code is no longer needed and would error on every boot.

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

  // Task #273: clear stale error_message on rows that ultimately succeeded.
  // Prior to the batch-processor fix, the success path didn't null
  // error_message, so a row that failed once and then succeeded kept showing
  // a misleading red error pill on the Portal Submissions page. This is a
  // self-healing UPDATE — naturally idempotent because subsequent runs match
  // zero rows.
  try {
    const res = await runWithDbWarmupRetry("Task #273 stale errorMessage backfill", () => db.execute(sql`
      UPDATE portal_submissions
      SET error_message = NULL
      WHERE status = 'submitted'
        AND error_message IS NOT NULL
        AND error_message <> ''
    `));
    const rowCount = (res as { rowCount?: number | null }).rowCount ?? 0;
    if (rowCount > 0) {
      logger.info({ rowCount }, "Task #273: cleared stale error_message from submitted portal_submissions rows");
    }
  } catch (err) {
    logger.warn({ err }, "Task #273: stale errorMessage backfill failed");
  }

  // Task #703: HARD-DELETE orphan ghost-draft `portal_submissions`
  // rows.
  //
  // Pre-#703, /preview-generated, /draft/regenerate, and bulk-generate
  // silently inserted a `status='draft'` row alongside the real text
  // on `invoice_groups.draft*`. Those rows leaked into the Portal
  // Submissions list/queue/drawer even though the operator had not
  // submitted anything.
  //
  // First pass of this cleanup flipped them to `cancelled`. Code-review
  // (Task #703 round 2) flagged that the Portal Submissions list shows
  // every status by default, so the cancelled ghosts still surfaced in
  // the "All" view. We delete instead, which is safe because every row
  // matched here is provably untouched by the bot:
  //   - status='draft'              → never queued
  //   - attempts = 0                → never picked up by a worker
  //   - portal_ticket_id IS NULL    → never made it to MAS
  //   - claimed_by_batch_id IS NULL → not part of any in-flight batch
  // No bot activity rows reference these submissions (bot activity is
  // only written once a batch claims a row), and the canonical draft
  // text lives on `invoice_groups.draft*`, not on the row — so deleting
  // is non-destructive.
  // Idempotent — subsequent runs match zero rows.
  try {
    const res = await runWithDbWarmupRetry("Task #703 ghost-draft cleanup", () => db.execute(sql`
      DELETE FROM portal_submissions
      WHERE status = 'draft'
        AND attempts = 0
        AND portal_ticket_id IS NULL
        AND claimed_by_batch_id IS NULL
    `));
    const rowCount = (res as { rowCount?: number | null }).rowCount ?? 0;
    if (rowCount > 0) {
      logger.info({ rowCount }, "Task #703: deleted orphan ghost-draft portal_submissions rows");
    }
  } catch (err) {
    logger.warn({ err }, "Task #703: ghost-draft cleanup failed");
  }

  // Removed (Task #258): Task #64 batch-submission re-queue backfill and the
  // Apr-27 attempts-reset followup. Both queries selected/returned
  // `portal_submissions.claim_id`, which migration 0014 dropped during the
  // per-invoice cutover. Both backfills had already been applied in prior
  // production builds (audit-log gated, idempotent), so leaving them in place
  // contributed nothing but a guaranteed boot-time exception against the
  // post-0014 schema.
  // Removed (Task #512): Task #74 closure_reason backfill. The 240-line
  // boot-time block that classified historical Denied rows into
  // closure_reason was retired when the canonical terminal-state model
  // was locked down (see docs/architecture/invoice-terminal-state.md).
  // Boot-time data backfills are now forbidden by §8 of that contract.
  // The same per-row classification — extended to also handle Expired
  // and Non-Issue legacy rows — moves to
  // `src/scripts/oneshot-terminal-state-backfill-2026-05-XX.ts`, runs
  // on-demand with `--apply`, and is gated by the audit-log marker
  // `terminal_state_lockdown_backfill / phase=task-512-lockdown`. The
  // original Task #74 backfill completed in production (audit-log
  // dedupe ensured every Denied row was already classified before
  // removal); the new oneshot picks up only rows the new contract adds
  // (Expired → withdrawn/expired and Resolved/Non-Issue → withdrawn/non_issue).

  // Removed 2026-05-11: "Disputed-child sync backfill". This block ran
  // on every API boot and raw-SQL'd `claims.status` to match the parent
  // group's status, then called `refreshClaimDenormalizedCache(legId)`
  // to refresh the canonical `disposition` column. The cache helper
  // re-projects `claims.status` from `disposition` (see
  // `denormalized-cache.ts` lines 215–230 — `dispositionToStatus(...)`),
  // which for any leg whose `sopOutcome` had already advanced past the
  // group's current status would IMMEDIATELY rewrite the just-cascaded
  // status back to its pre-cascade value. Net effect:
  //   1. Backfill UPDATE leg: Awaiting Response → Portal Queued
  //   2. Audit row written ('system (backfill)')
  //   3. refreshClaimDenormalizedCache → projects Portal Queued → Awaiting Response
  //   4. Same drift re-appears on the very next boot, audit row #2 written
  // Production proof (group 774 / invoice 1865732380, 2026-05-11): two
  // identical 'Awaiting Response → Portal Queued' rows 16 minutes apart
  // across two consecutive deploys; the same 8 groups were re-touched
  // both times. Per the §8 lockdown referenced above, boot-time data
  // backfills are forbidden — this one violated that rule and only
  // produced audit-log noise. If real status drift recurs, it must be
  // fixed at the cascade source (group-transitions.ts) or addressed via
  // an on-demand oneshot script under src/scripts/.
})().catch((err) => {
  // The IIFE above already wraps each backfill in its own try/catch, but a
  // surprise throw escaping all of them would otherwise become an
  // unhandled rejection. Surface it as a FATAL line for visibility (the
  // server itself stays up — none of the backfills are required for the
  // app to serve traffic).
  logger.error({ err }, "FATAL: boot-time IIFE threw an unhandled error (server still starting)");
});

const rawPort = process.env["PORT"];

if (!rawPort) {
  // FATAL log goes through stderr via the unhandledException handler when
  // we throw — but we also surface a clear pino line first so the failure
  // mode reads cleanly in deployment runtime logs.
  logger.fatal("FATAL: server failed to start (PORT environment variable is required but was not provided)");
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  logger.fatal({ rawPort }, `FATAL: server failed to start (invalid PORT value: "${rawPort}")`);
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.fatal({ err }, "FATAL: server failed to start (error listening on port)");
    process.exit(1);
  }

  markServerStarted();
  logger.info({ port }, "Server listening");

  // Task #713 — sweep stale staged reply attachments hourly so unsent
  // picks dropped by the composer don't sit in object storage forever.
  startReplyAttachmentStagingJanitor(logger);

  // Boot cleanup: any rows still flagged as Queued by an in-memory batch from
  // a prior process are orphaned (the batch state was lost on restart). Clear
  // them so they show as plain Pending and the next run can pick them up.
  clearOrphanedBatchClaims().catch((cleanupErr) => {
    logger.error({ err: cleanupErr }, "Boot cleanup of orphaned batch claims failed");
  });

  // Boot cleanup: any portal_batch_runs row still marked "running" was left
  // behind by a prior process. Mark it failed so the Recent Runs panel never
  // displays a stale "running" entry.
  markOrphanedRunningBatchesAsFailed().catch((cleanupErr) => {
    logger.error({ err: cleanupErr }, "Boot cleanup of orphaned running batch runs failed");
  });
});

if (!process.env.BOT_SERVICE_TOKEN) {
  logger.warn("BOT_SERVICE_TOKEN not set; cron jobs that call internal HTTP endpoints will fail authentication.");
}

// Hourly "File today" snapshot. Records the urgent-count + status
// breakdown into state_events so the Dashboard hero and the Queue
// urgency hero can render an inline sparkline of how the count moved
// today. See Task #298 + lib/urgent-snapshot.ts.
cron.schedule(URGENT_SNAPSHOT.cron, async () => {
  await recordCronRun(URGENT_SNAPSHOT.name, async () => {
    const snap = await snapshotUrgentCounts();
    if (!snap) {
      return { status: "degraded" as const, message: "Urgent snapshot returned null (write failed)" };
    }
    return {
      message: `Urgent snapshot: ${snap.urgentCount}/${snap.totalActionable} on ${snap.todayKey}`,
      metadata: { urgentCount: snap.urgentCount, totalActionable: snap.totalActionable, todayKey: snap.todayKey, byStatus: snap.byStatus },
    };
  });
}, { timezone: URGENT_SNAPSHOT.tz });

cron.schedule(DAILY_BRIEF.cron, async () => {
  // Drop a snapshot before the brief sends so the morning email and the
  // dashboard sparkline both anchor on the same day-start count.
  await snapshotUrgentCounts();
  await recordCronRun(DAILY_BRIEF.name, async () => {
    logger.info("Daily brief cron: sending morning brief");
    const res = await fetch(`http://localhost:${port}/api/daily-brief`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-bot-token": process.env.BOT_SERVICE_TOKEN ?? "" },
    });
    const data = await res.json().catch(() => ({}));
    // The route always returns 200 with a structured outcome
    // ("ok" | "degraded" | "failed").
    // We only synthesize "failed" here when the response itself is
    // non-2xx (transport-level failure).
    if (!res.ok) {
      return {
        status: "failed" as const,
        message: `Daily brief HTTP ${res.status}: ${JSON.stringify(data).slice(0, 300)}`,
        metadata: { httpStatus: res.status, body: data },
      };
    }
    const outcome: "ok" | "degraded" | "failed" =
      data?.outcome === "failed" ? "failed"
      : data?.outcome === "degraded" ? "degraded"
      : "ok";
    logger.info({ result: data, outcome }, "Daily brief sent");
    return {
      status: outcome,
      message: data?.message ?? "Daily brief sent",
      metadata: data,
    };
  });
}, { timezone: DAILY_BRIEF.tz });

// Deterministic post-brief bounce recheck. Fires 15m after DAILY_BRIEF
// so bounce-backs have time to land. recheckPreviousRunBounces looks up the latest
// daily_brief cron_run by briefRunId in metadata and downgrades it
// from "ok" → "degraded" when the spike thresholds trip. Independent
// of the next brief invocation, so a once-per-day cron no longer
// leaves a 24h gap where the recheck would be skipped.
cron.schedule(DAILY_BRIEF_BOUNCE_RECHECK.cron, async () => {
  await recordCronRun(DAILY_BRIEF_BOUNCE_RECHECK.name, async () => {
    const result = await recheckPreviousRunBounces();
    if (!result) {
      return { message: "No daily_brief run eligible for recheck" };
    }
    return {
      status: result.downgrade === "degraded" ? "degraded" as const : "ok" as const,
      message: result.downgrade === "degraded"
        ? `Downgraded daily_brief run #${result.runId} after bounce spike`
        : `Daily_brief run #${result.runId} still healthy after recheck`,
      metadata: { downgradedRunId: result.runId, outcome: result.downgrade },
    };
  });
}, { timezone: DAILY_BRIEF_BOUNCE_RECHECK.tz });

// Task #721: Weekly executive digest. Mondays 07:00 ET. Separate cron
// + separate route from the daily ops brief — a Monday daily-brief
// degradation no longer also takes down the exec digest. The
// `/api/daily-brief/weekly` route returns the same structured outcome
// shape as the daily route, so this handler is a near-mirror.
cron.schedule(WEEKLY_DIGEST.cron, async () => {
  await recordCronRun(WEEKLY_DIGEST.name, async () => {
    logger.info("Weekly digest cron: sending executive digest");
    const res = await fetch(`http://localhost:${port}/api/daily-brief/weekly`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-bot-token": process.env.BOT_SERVICE_TOKEN ?? "" },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        status: "failed" as const,
        message: `Weekly digest HTTP ${res.status}: ${JSON.stringify(data).slice(0, 300)}`,
        metadata: { httpStatus: res.status, body: data },
      };
    }
    const outcome: "ok" | "degraded" | "failed" =
      data?.outcome === "failed" ? "failed"
      : data?.outcome === "degraded" ? "degraded"
      : "ok";
    logger.info({ result: data, outcome }, "Weekly digest sent");
    return {
      status: outcome,
      message: data?.message ?? "Weekly digest sent",
      metadata: data,
    };
  });
}, { timezone: WEEKLY_DIGEST.tz });

// Mirror of DAILY_BRIEF_BOUNCE_RECHECK for the weekly job. 15m after
// WEEKLY_DIGEST so bounce-backs land before the recheck fires.
cron.schedule(WEEKLY_DIGEST_BOUNCE_RECHECK.cron, async () => {
  await recordCronRun(WEEKLY_DIGEST_BOUNCE_RECHECK.name, async () => {
    const result = await recheckPreviousRunBounces("weekly_digest");
    if (!result) {
      return { message: "No weekly_digest run eligible for recheck" };
    }
    return {
      status: result.downgrade === "degraded" ? "degraded" as const : "ok" as const,
      message: result.downgrade === "degraded"
        ? `Downgraded weekly_digest run #${result.runId} after bounce spike`
        : `Weekly_digest run #${result.runId} still healthy after recheck`,
      metadata: { downgradedRunId: result.runId, outcome: result.downgrade },
    };
  });
}, { timezone: WEEKLY_DIGEST_BOUNCE_RECHECK.tz });

cron.schedule(RESPONSE_TRACKER.cron, async () => {
  await recordCronRun(RESPONSE_TRACKER.name, async () => {
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
}, { timezone: RESPONSE_TRACKER.tz });

// Task #725: portal-side response scraper. Walks every 'submitted'
// portal_submission whose group is still Awaiting Response, opens its
// MAS Freshdesk ticket via the shared portal-browser-gate, and POSTs
// any new conversation entries through the same /responses/record-portal
// route operators see. Rate-limited internally with a per-ticket jitter.
cron.schedule(PORTAL_RESPONSE_SYNC.cron, async () => {
  await recordCronRun(PORTAL_RESPONSE_SYNC.name, async () => {
    const { findDuePortalSyncSubmissions, syncDuePortalSubmissions, derivePortalSyncCronStatus } = await import("./lib/portal-response-sync");
    const due = await findDuePortalSyncSubmissions({ limit: 25 });
    if (due.length === 0) {
      // Task #738. Zero-due ticks share the same `derivePortalSyncCronStatus`
      // decision as a real sweep — they surface as "degraded" so a quiet
      // cron is visually distinct from a successful 25/25 sweep on the
      // System Health rollup tile.
      return {
        status: derivePortalSyncCronStatus({ considered: 0, scraped: 0, errored: 0 }),
        message: "Portal response sync: no due submissions",
        metadata: { considered: 0, scraped: 0, skipped: 0, errored: 0, newResponses: 0 },
      };
    }
    logger.info({ count: due.length }, "Portal response sync: starting sweep");
    const result = await syncDuePortalSubmissions(due);
    // Task #738. The 3-way status decision lives in
    // `derivePortalSyncCronStatus` so the cron caller and the
    // regression tests can't drift.
    return {
      status: derivePortalSyncCronStatus(result),
      message: `Scraped ${result.scraped}/${result.considered} (${result.newResponses} new, ${result.errored} errors)`,
      metadata: {
        considered: result.considered,
        scraped: result.scraped,
        skipped: result.skipped,
        errored: result.errored,
        newResponses: result.newResponses,
      },
    };
  });
}, { timezone: PORTAL_RESPONSE_SYNC.tz });

cron.schedule(OUTLOOK_HEARTBEAT.cron, async () => {
  await recordCronRun(OUTLOOK_HEARTBEAT.name, async () => {
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
}, { timezone: OUTLOOK_HEARTBEAT.tz });

// Nightly Expired sweep (1 AM ET). Retires every invoice group whose
// 30-day filing deadline has slipped while still in a pre-submit
// status, so the morning queue does not lead with corpses. Operators
// can also trigger this on demand via `POST /api/admin/expired-sweep`.
// The sweep is idempotent and safe to re-run.
cron.schedule(EXPIRED_SWEEP.cron, async () => {
  await recordCronRun(EXPIRED_SWEEP.name, async () => {
    const result = await sweepExpiredGroups({
      actor: { userEmail: null, userName: "Expired sweep cron" },
      source: "expired_sweep_cron",
    });
    const breakdown = Object.entries(result.byStatus)
      .map(([s, n]) => `${s}=${n}`)
      .join(", ");
    return {
      message: result.expired === 0
        ? "No invoice groups eligible for Expired retirement"
        : `Retired ${result.expired} invoice group${result.expired === 1 ? "" : "s"} to Expired${breakdown ? ` (${breakdown})` : ""}${result.skipped > 0 ? `; skipped ${result.skipped}` : ""}`,
      metadata: {
        expired: result.expired,
        skipped: result.skipped,
        byStatus: result.byStatus,
        sampleGroupIds: result.sampleGroupIds,
      },
      ...(result.skipped > 0 ? { status: "degraded" as const } : {}),
    };
  });
}, { timezone: EXPIRED_SWEEP.tz });

cron.schedule(STUCK_SUBMISSION_RESET.cron, async () => {
  await recordCronRun(STUCK_SUBMISSION_RESET.name, async () => {
    const result = await resetStuckSubmissions();
    return {
      message: result.reset === 0
        ? "No stuck portal submissions found"
        : `Reset ${result.reset} stuck portal submission${result.reset === 1 ? "" : "s"}`,
      metadata: { reset: result.reset, ids: result.ids },
    };
  });
}, { timezone: STUCK_SUBMISSION_RESET.tz });

// Scheduled portal batch sweeper. Runs five times each business day at
// 8am, 11am, 2pm, 6pm, and 10pm America/New_York, Monday through Friday.
// The 10pm fire is an after-hours sweep that catches anything queued late
// in the evening so it still goes out before the next morning's deadline
// cutoff. If any pending submissions are due (next_retry_at <= now or NULL), triggers a
// worker run that drains the queue. Admins can also fire a batch on demand
// from the Portal Submissions page via "Process Pending" / "Process
// Selected" — that path uses the same triggerWorkerRun gate, so concurrent
// sweeps + admin batches coalesce into one in-flight Playwright session.
//
// The cron expression + timezone live in `lib/cron-schedule.ts` so the
// system-health rollup, the cycle-aware overdue check, and the Portal
// Submissions queue-status pill all reason about the exact same schedule
// that actually fires here.
cron.schedule(PORTAL_BATCH_SWEEPER.cron, async () => {
  // Snapshot before the sweep so we get a "before" data point — the
  // sparkline then visualises whether the sweep moved the urgent count.
  await snapshotUrgentCounts();
  await recordCronRun(PORTAL_BATCH_SWEEPER.name, async () => {
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
      triggeredBy: "Scheduled Batch Sweep",
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
}, { timezone: PORTAL_BATCH_SWEEPER.tz });

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
