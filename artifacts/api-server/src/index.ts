// Startup-error guard MUST come first so its process-level handlers are
// registered before any other top-level module code runs. See Task #258.
import { markServerStarted } from "./lib/startup-guard";
import app from "./app";
import { logger } from "./lib/logger";
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
  RESPONSE_TRACKER,
  OUTLOOK_HEARTBEAT,
  STUCK_SUBMISSION_RESET,
  URGENT_SNAPSHOT,
} from "./lib/cron-schedule";
import { snapshotUrgentCounts } from "./lib/urgent-snapshot";

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

  // Removed (Task #258): Task #64 batch-submission re-queue backfill and the
  // Apr-27 attempts-reset followup. Both queries selected/returned
  // `portal_submissions.claim_id`, which migration 0014 dropped during the
  // per-invoice cutover. Both backfills had already been applied in prior
  // production builds (audit-log gated, idempotent), so leaving them in place
  // contributed nothing but a guaranteed boot-time exception against the
  // post-0014 schema.
  const isProduction = process.env.NODE_ENV === "production" || process.env.REPLIT_DEPLOYMENT === "1";

  // Task #74 closure_reason backfill (production only, idempotent via
  // audit-log marker). Per-row classification of historical Denied rows
  // applied in priority order. Updated for Task #160 reason consolidation:
  //   1. Explicit "Accept as Loss" / "Mark as Denied by Payor" post-response audit -> stays Denied + denied_by_payor
  //   2. response_received audit BEFORE the manual denial event                    -> stays Denied + denied_by_payor
  //   3. manual denial event AND no portal_response on file                        -> Withdrawn + cannot_dispute + Resolved
  //   4. otherwise (auto-denial from response_received / response_reassign,
  //      i.e. real payer denial)                                                   -> stays Denied + denied_by_payor
  if (!isProduction) {
    logger.info({ nodeEnv: process.env.NODE_ENV, replitDeployment: process.env.REPLIT_DEPLOYMENT }, "Task #74 closure_reason backfill: skipping (not production)");
  } else try {
    type ClassifiedRow = { id: number; closureReason: "denied_by_payor" | "cannot_dispute"; toWithdrawn: boolean; rationale: string };
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

      // Rule 1: explicit accept-as-loss / mark-denied-by-payor action.
      const acceptLossAudit = await runWithDbWarmupRetry(`Task #74 claim ${claimId} accept_loss check`, () => db.execute(sql`
        SELECT 1 FROM audit_logs
        WHERE claim_id = ${claimId}
          AND metadata->>'source' = 'post_response_action'
          AND (
            details ILIKE '%Accept as Loss%'
            OR details ILIKE '%Denied by Payor%'
            OR metadata->>'action' = 'accept_loss'
            OR metadata->>'action' = 'mark_denied_by_payor'
            OR metadata->>'reason' ILIKE '%accept as loss%'
            OR metadata->>'reason' ILIKE '%denied by payor%'
          )
        LIMIT 1
      `));
      if (((acceptLossAudit.rows ?? []) as unknown[]).length > 0) {
        claimRows.push({ id: claimId, closureReason: "denied_by_payor", toWithdrawn: false, rationale: "audit shows explicit Accept-as-Loss / Denied-by-Payor post-response action" });
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

      // Rule 2: response received BEFORE a manual denial event => denied_by_payor.
      if (denialIsManual && firstRespAt && denialAt && firstRespAt.getTime() <= denialAt.getTime()) {
        claimRows.push({ id: claimId, closureReason: "denied_by_payor", toWithdrawn: false, rationale: `response received at ${firstRespAt.toISOString()} preceded manual denial at ${denialAt.toISOString()} — staff accepted the loss after payor response` });
        continue;
      }

      // Rule 3: manual denial AND no response on file => cannot_dispute.
      // (Also covers the case where there is no audit at all but no response either.)
      if ((denialIsManual || !denialEvent) && !firstRespAt) {
        claimRows.push({ id: claimId, closureReason: "cannot_dispute", toWithdrawn: true, rationale: "no portal/email response was ever recorded — staff-initiated closure of an uncontestable claim" });
        continue;
      }

      // Rule 4: real payer denial.
      claimRows.push({ id: claimId, closureReason: "denied_by_payor", toWithdrawn: false, rationale: denialEvent ? `denial recorded by source='${denialEvent.source ?? "unknown"}' with payer response on file` : "payer response on file with no contradicting manual-closure history" });
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

      // Rule 1: explicit accept-as-loss / mark-denied-by-payor action.
      const acceptLossAudit = await runWithDbWarmupRetry(`Task #74 group ${groupId} accept_loss check`, () => db.execute(sql`
        SELECT 1 FROM audit_logs
        WHERE invoice_group_id = ${groupId}
          AND metadata->>'source' = 'post_response_action'
          AND (
            details ILIKE '%Accept as Loss%'
            OR details ILIKE '%Denied by Payor%'
            OR metadata->>'action' = 'accept_loss'
            OR metadata->>'action' = 'mark_denied_by_payor'
            OR metadata->>'reason' ILIKE '%accept as loss%'
            OR metadata->>'reason' ILIKE '%denied by payor%'
          )
        LIMIT 1
      `));
      if (((acceptLossAudit.rows ?? []) as unknown[]).length > 0) {
        groupRows.push({ id: groupId, closureReason: "denied_by_payor", toWithdrawn: false, rationale: "audit shows explicit Accept-as-Loss / Denied-by-Payor post-response action" });
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

      // Rule 2: response received BEFORE a manual denial event => denied_by_payor.
      if (denialIsManual && firstRespAt && denialAt && firstRespAt.getTime() <= denialAt.getTime()) {
        groupRows.push({ id: groupId, closureReason: "denied_by_payor", toWithdrawn: false, rationale: `response received at ${firstRespAt.toISOString()} preceded manual denial at ${denialAt.toISOString()} — staff accepted the loss after payor response` });
        continue;
      }

      // Rule 3: manual denial AND no response on file => cannot_dispute.
      if ((denialIsManual || !denialEvent) && !firstRespAt) {
        groupRows.push({ id: groupId, closureReason: "cannot_dispute", toWithdrawn: true, rationale: "no portal/email response was ever recorded for this invoice group — staff-initiated closure of an uncontestable group" });
        continue;
      }

      // Rule 4: real payer denial.
      groupRows.push({ id: groupId, closureReason: "denied_by_payor", toWithdrawn: false, rationale: denialEvent ? `denial recorded by source='${denialEvent.source ?? "unknown"}' with payer response on file` : "payer response on file with no contradicting manual-closure history" });
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

  // Disputed-child sync backfill (production only, idempotent).
  // Heals claims whose status drifted from their invoice group's status because
  // of the old `syncChildRides` terminal-only guard. A leg is "disputed" iff it
  // has an error_type_id; clean legs are never touched. Held legs are never
  // touched. Per-row audit entry written so the claim timeline reflects the
  // backfilled change.
  if (!isProduction) {
    logger.info({ nodeEnv: process.env.NODE_ENV, replitDeployment: process.env.REPLIT_DEPLOYMENT }, "Disputed-child sync backfill: skipping (not production)");
  } else try {
    // "Needs Review" was missing here even though disputed legs can land in
    // it after a payer response is auto-classified — without it, a leg in
    // Needs Review on a group whose status is also Needs Review wouldn't
    // be detected as drifted (no diff) but a *group* moved to Needs Review
    // by the auto-classifier wouldn't pull its disputed legs along.
    const SYNCABLE = ["Needs Review", "Portal Queued", "Generating Email", "Awaiting Response", "Ready to Review", "Resolved", "Denied"];
    // Drizzle interpolates a JS array as a row literal ($1,$2,...) which
    // Postgres rejects in ANY(). Use ARRAY[$1, $2, ...] instead so each
    // element is passed as a separate parameter and the whole thing is a
    // proper text array.
    const SYNCABLE_SQL = sql.join(SYNCABLE.map((s) => sql`${s}`), sql`, `);
    const drifted = await runWithDbWarmupRetry("Disputed-child sync backfill scan", () => db.execute(sql`
      SELECT c.id            AS claim_id,
             c.conf_number   AS conf_number,
             c.status::text  AS claim_status,
             c.outcome::text AS claim_outcome,
             ig.id           AS group_id,
             ig.invoice_number AS invoice_number,
             ig.status::text AS group_status,
             ig.outcome::text AS group_outcome
      FROM claims c
      INNER JOIN invoice_groups ig ON ig.id = c.invoice_group_id
      WHERE c.error_type_id IS NOT NULL
        AND c.status::text != 'On Hold'
        AND ig.status::text = ANY(ARRAY[${SYNCABLE_SQL}])
        AND c.status::text != ig.status::text
    `));
    const rows = (drifted.rows ?? []) as Array<{
      claim_id: number; conf_number: string | null;
      claim_status: string; claim_outcome: string;
      group_id: number; invoice_number: string;
      group_status: string; group_outcome: string;
    }>;
    if (rows.length === 0) {
      logger.info("Disputed-child sync backfill: nothing to do (no drifted legs)");
    } else {
      for (const row of rows) {
        await runWithDbWarmupRetry(`Disputed-child sync backfill claim ${row.claim_id}`, async () => {
          await db.execute(sql`
            UPDATE claims
            SET status = ${row.group_status}::claim_status,
                outcome = ${row.group_outcome}::claim_outcome
            WHERE id = ${row.claim_id}
          `);
          await db.execute(sql`
            INSERT INTO audit_logs (claim_id, invoice_group_id, action, details, metadata, user_email, user_name)
            VALUES (
              ${row.claim_id},
              ${row.group_id},
              'claim_status_changed',
              ${`Status changed from ${row.claim_status} to ${row.group_status} (backfill: cascaded from invoice group)`},
              ${JSON.stringify({
                from: row.claim_status,
                to: row.group_status,
                previousOutcome: row.claim_outcome,
                newOutcome: row.group_outcome,
                source: "group_cascade:backfill",
                cascadedFromGroupId: row.group_id,
              })}::jsonb,
              NULL,
              'system (backfill)'
            )
          `);
        });
      }
      logger.info({
        count: rows.length,
        legs: rows.map((r) => ({ claimId: r.claim_id, conf: r.conf_number, invoice: r.invoice_number, from: r.claim_status, to: r.group_status })),
      }, "Disputed-child sync backfill: re-synced drifted disputed legs with their groups");
    }
  } catch (err) {
    logger.warn({ err }, "Disputed-child sync backfill: failed");
  }
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
    if (!res.ok) {
      throw new Error(`Daily brief HTTP ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
    }
    logger.info({ result: data }, "Daily brief sent");
    return { message: data?.message ?? "Daily brief sent", metadata: data };
  });
}, { timezone: DAILY_BRIEF.tz });

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

// Scheduled portal batch sweeper. Runs four times each business day at
// 8am, 11am, 2pm, and 6pm America/New_York, Monday through Friday; if any
// pending submissions are due (next_retry_at <= now or NULL), triggers a
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
