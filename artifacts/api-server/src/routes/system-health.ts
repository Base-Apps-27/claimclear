import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { cronRunsTable, connectorHealthTable, emailBouncesTable, portalSubmissionsTable, portalResponsesTable } from "@workspace/db";
import { desc, gte, sql, eq, and, or, isNull, lte, count } from "drizzle-orm";
import {
  computeClassifierStats,
  type ClassifierStatsRow,
} from "../lib/classifier-stats";
import type { ClassifiedDecision } from "../lib/inbound-email-classifier";
import { asyncHandler } from "../lib/asyncHandler";
import { requireAdmin } from "../middlewares/requireAdmin";
import { requireAuth } from "../middlewares/requireAuth";
import { denyClerk } from "../middlewares/denyClerk";
import { CronExpressionParser } from "cron-parser";
import { logger } from "../lib/logger";
import {
  getLastWorkerRun,
  getRecentWorkerRuns,
  isWorkerRunInProgress,
} from "../lib/batch-processor";
import { computeRollup } from "../lib/system-health-rollup";
import { safeRunServiceDateDriftCheck } from "../lib/group-service-date";
import { getBootTime } from "../lib/boot-time";
import { enumerateExpectedFiresSinceBoot } from "../lib/cron-fire-enumeration";
import {
  KNOWN_CRON_JOBS,
  PORTAL_BATCH_SWEEPER,
  getSweepBoundaries,
} from "../lib/cron-schedule";
import {
  OVERDUE_GRACE_MINUTES,
  resolveOverdueQueryInputs,
  countOverdueRows,
} from "../lib/overdue-submissions";

const router: IRouter = Router();

// Locked cron schedules — imported from the shared module that the actual
// `cron.schedule(...)` registrations in index.ts also use, so the rollup
// can never reason about a cron string that drifted from what's running.
const KNOWN_JOBS = KNOWN_CRON_JOBS;

router.get("/admin/system-health/cron-runs", requireAdmin, asyncHandler(async (_req, res): Promise<void> => {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const runs = await db
    .select()
    .from(cronRunsTable)
    .where(gte(cronRunsTable.startedAt, sevenDaysAgo))
    .orderBy(desc(cronRunsTable.startedAt))
    .limit(500);

  const jobMap = new Map<string, {
    jobName: string;
    cron: string | null;
    nextRunAt: string | null;
    lastRun: { startedAt: string; finishedAt: string | null; status: string; message: string | null } | null;
    successRate7d: number;
    runs7d: number;
    failures7d: number;
    recent: { id: number; startedAt: string; finishedAt: string | null; status: string; message: string | null }[];
  }>();

  const computeNext = (cron: string, tz: string): string | null => {
    try {
      const i = CronExpressionParser.parse(cron, { tz });
      return i.next().toDate().toISOString();
    } catch (err) {
      logger.warn({ err, cron, tz }, "Failed to parse cron expression");
      return null;
    }
  };

  for (const known of KNOWN_JOBS) {
    jobMap.set(known.name, {
      jobName: known.name,
      cron: known.cron,
      nextRunAt: computeNext(known.cron, known.tz),
      lastRun: null,
      successRate7d: 0,
      runs7d: 0,
      failures7d: 0,
      recent: [],
    });
  }

  for (const r of runs) {
    if (!jobMap.has(r.jobName)) {
      jobMap.set(r.jobName, {
        jobName: r.jobName,
        cron: null,
        nextRunAt: null,
        lastRun: null,
        successRate7d: 0,
        runs7d: 0,
        failures7d: 0,
        recent: [],
      });
    }
    const entry = jobMap.get(r.jobName)!;
    entry.runs7d++;
    if (r.status === "failed") entry.failures7d++;
    if (entry.recent.length < 20) {
      entry.recent.push({
        id: r.id,
        startedAt: r.startedAt.toISOString(),
        finishedAt: r.finishedAt?.toISOString() ?? null,
        status: r.status,
        message: r.message,
      });
    }
    if (!entry.lastRun) {
      entry.lastRun = {
        startedAt: r.startedAt.toISOString(),
        finishedAt: r.finishedAt?.toISOString() ?? null,
        status: r.status,
        message: r.message,
      };
    }
  }

  const jobs = Array.from(jobMap.values()).map((j) => ({
    ...j,
    successRate7d: j.runs7d > 0 ? Math.round(((j.runs7d - j.failures7d) / j.runs7d) * 100) : 0,
  }));

  res.json({ jobs });
}));

router.get("/admin/system-health/connectors", requireAdmin, asyncHandler(async (_req, res): Promise<void> => {
  const rows = await db.select().from(connectorHealthTable);
  res.json({
    connectors: rows.map((r) => ({
      connectorName: r.connectorName,
      status: r.status,
      lastCheckedAt: r.lastCheckedAt.toISOString(),
      lastError: r.lastError,
    })),
  });
}));

router.get("/admin/system-health/bounces", requireAdmin, asyncHandler(async (req, res): Promise<void> => {
  const limit = Math.min(parseInt(String(req.query?.limit || "50"), 10) || 50, 200);
  const onlyUnmatched = req.query?.onlyUnmatched === "true";

  let q = db.select().from(emailBouncesTable).orderBy(desc(emailBouncesTable.receivedAt)).limit(limit).$dynamic();
  if (onlyUnmatched) {
    q = q.where(sql`${emailBouncesTable.matchedClaimId} IS NULL AND ${emailBouncesTable.matchedInvoiceGroupId} IS NULL`);
  }
  const rows = await q;

  res.json({
    bounces: rows.map((r) => ({
      id: r.id,
      recipientEmail: r.recipientEmail,
      subject: r.subject,
      receivedAt: r.receivedAt.toISOString(),
      rawExcerpt: r.rawExcerpt,
      matchedClaimId: r.matchedClaimId,
      matchedInvoiceGroupId: r.matchedInvoiceGroupId,
      matchedOutboundId: r.matchedOutboundId,
    })),
  });
}));

router.get("/admin/system-health/worker-activity", requireAdmin, asyncHandler(async (_req, res): Promise<void> => {
  const now = new Date();
  // Cycle-aware overdue cutoff: the most recent scheduled sweep that
  // already had its grace window to run. Rows whose ready time is at or
  // before this point should have been drained; if they're still pending,
  // they've missed a cycle.
  const overdueInputs = await resolveOverdueQueryInputs(now);
  const overdueCount = overdueInputs.canFlag
    ? await countOverdueRows(overdueInputs.cutoff!)
    : 0;

  const [{ value: pendingDueCount } = { value: 0 }] = await db
    .select({ value: count() })
    .from(portalSubmissionsTable)
    .where(and(
      eq(portalSubmissionsTable.status, "pending"),
      or(
        isNull(portalSubmissionsTable.nextRetryAt),
        lte(portalSubmissionsTable.nextRetryAt, now),
      ),
    ));

  // Last successful submission — we treat "submitted" as success (the portal
  // accepted the row and assigned a confirmation number).
  const [lastSuccess] = await db
    .select({
      id: portalSubmissionsTable.id,
      invoiceGroupId: portalSubmissionsTable.invoiceGroupId,
      submittedAt: portalSubmissionsTable.submittedAt,
      updatedAt: portalSubmissionsTable.updatedAt,
      confNumber: portalSubmissionsTable.confNumber,
    })
    .from(portalSubmissionsTable)
    .where(eq(portalSubmissionsTable.status, "submitted"))
    .orderBy(desc(portalSubmissionsTable.updatedAt))
    .limit(1);

  // Last failed submission — exhausted retries, error preserved on the row.
  const [lastFailed] = await db
    .select({
      id: portalSubmissionsTable.id,
      invoiceGroupId: portalSubmissionsTable.invoiceGroupId,
      attempts: portalSubmissionsTable.attempts,
      maxAttempts: portalSubmissionsTable.maxAttempts,
      errorMessage: portalSubmissionsTable.errorMessage,
      updatedAt: portalSubmissionsTable.updatedAt,
    })
    .from(portalSubmissionsTable)
    .where(eq(portalSubmissionsTable.status, "failed"))
    .orderBy(desc(portalSubmissionsTable.updatedAt))
    .limit(1);

  // Next + previous scheduled sweeper fires — derived from the locked
  // schedule so the UI can render "next sweep in 2m" / "last sweep was
  // 18m ago" without polling cron internals.
  const { prev: prevSweepFire, next: nextSweepFire } = getSweepBoundaries(now, PORTAL_BATCH_SWEEPER);
  if (nextSweepFire === null) {
    logger.warn("worker-activity: failed to compute nextSweepAt");
  }

  res.json({
    isRunning: isWorkerRunInProgress(),
    lastRun: getLastWorkerRun(),
    recentRuns: getRecentWorkerRuns(),
    pendingDueCount,
    overdueCount,
    overdueGraceMinutes: OVERDUE_GRACE_MINUTES,
    nextSweepAt: nextSweepFire?.toISOString() ?? null,
    lastSweepAt: prevSweepFire?.toISOString() ?? null,
    lastSuccessfulSubmission: lastSuccess
      ? {
          submissionId: lastSuccess.id,
          invoiceGroupId: lastSuccess.invoiceGroupId,
          confNumber: lastSuccess.confNumber,
          submittedAt: lastSuccess.submittedAt,
          at: lastSuccess.updatedAt.toISOString(),
        }
      : null,
    lastFailedSubmission: lastFailed
      ? {
          submissionId: lastFailed.id,
          invoiceGroupId: lastFailed.invoiceGroupId,
          attempts: lastFailed.attempts,
          maxAttempts: lastFailed.maxAttempts,
          errorMessage: lastFailed.errorMessage,
          at: lastFailed.updatedAt.toISOString(),
        }
      : null,
  });
}));

// Rollup is intentionally available to any authenticated user (not requireAdmin).
// Non-admin users see WorkerHealthBanner on Dashboard / Portal Submissions; if
// this endpoint required admin, the banner would silently disappear for them
// (the rollup query would 401 and React Query would just return undefined).
// The payload is summarized component health — no PII, no secrets, no per-row
// data — so widening read access is safe. Per-component detail endpoints
// (/admin/system-health/cron-runs, /worker-activity, /connectors, /bounces)
// remain admin-only.
router.get("/admin/system-health/rollup", requireAuth, denyClerk, asyncHandler(async (_req, res): Promise<void> => {
  // Connector health
  const connectors = await db.select().from(connectorHealthTable);

  // Recent cron runs (last 7d) → most-recent per job
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const recentRuns = await db
    .select()
    .from(cronRunsTable)
    .where(gte(cronRunsTable.startedAt, sevenDaysAgo))
    .orderBy(desc(cronRunsTable.startedAt))
    .limit(500);

  const lastRunByJob = new Map<string, typeof recentRuns[number]>();
  for (const r of recentRuns) {
    if (!lastRunByJob.has(r.jobName)) lastRunByJob.set(r.jobName, r);
  }

  // Server boot time gates the missed-tick math: any expected fire that
  // landed before this process started is silently ignored, so a fresh
  // deploy doesn't look like a degraded job until the next tick lands.
  const bootTime = getBootTime();
  const nowForCron = new Date();

  // Resolve each known cron's previous expected fire time + the list of
  // expected fires since boot. Enumeration is bounded by the same 7-day
  // window we use for pulling lastRun, so the list always contains the
  // most recent ticks (not just the oldest ones after long uptime).
  const knownJobs = KNOWN_JOBS.map((known) => {
    let prevExpected: Date | null = null;
    try {
      prevExpected = CronExpressionParser.parse(known.cron, { tz: known.tz }).prev().toDate();
    } catch (err) {
      logger.warn({ err, cron: known.cron }, "Cron parse failed in rollup");
    }
    let expectedFiresSinceBoot: Date[] = [];
    try {
      expectedFiresSinceBoot = enumerateExpectedFiresSinceBoot({
        cron: known.cron,
        tz: known.tz,
        bootTime,
        now: nowForCron,
      });
    } catch (err) {
      logger.warn({ err, cron: known.cron }, "Cron parse failed enumerating fires since boot");
    }
    return {
      name: known.name,
      prevExpected,
      expectedFiresSinceBoot,
      // Pass per-job override through so low-frequency sweeps can opt
      // out of the global "tolerate one missed tick" behavior.
      missedTickThreshold: known.missedTickThreshold,
    };
  });

  // Same cycle-aware overdue rule as the worker-activity endpoint and the
  // dashboard tile. When the most recent scheduled sweep didn't actually
  // run, we deliberately leave overdueCount at 0 — the cron tile already
  // flags the missed sweep, and double-counting on the worker tile just
  // duplicates the alert.
  const now = new Date();
  const overdueInputs = await resolveOverdueQueryInputs(now);
  const overdueCount = overdueInputs.canFlag
    ? await countOverdueRows(overdueInputs.cutoff!)
    : 0;
  const { prev: prevSweepFire, next: nextSweepFire } = getSweepBoundaries(now, PORTAL_BATCH_SWEEPER);

  const lastWorkerRun = getLastWorkerRun();

  // Task #350: cheap JS-side recompute of `invoice_groups.service_date`
  // for every group. Two flat reads + a Map merge — well within the
  // health-rollup budget. `safeRunServiceDateDriftCheck` swallows its
  // own errors and returns `null` so a transient DB hiccup never kills
  // the rollup; `computeRollup` then surfaces that as an informational
  // note instead of a hard alert.
  const driftReport = await safeRunServiceDateDriftCheck();

  const { overall, components } = computeRollup({
    now,
    bootTime,
    connectors: connectors.map((c) => ({
      connectorName: c.connectorName,
      status: c.status,
      lastError: c.lastError,
    })),
    knownJobs,
    lastRunByJob,
    overdueCount,
    overdueGraceMinutes: OVERDUE_GRACE_MINUTES,
    lastWorkerRun: lastWorkerRun
      ? {
          status: lastWorkerRun.status,
          finishedAt: lastWorkerRun.finishedAt,
          startedAt: lastWorkerRun.startedAt,
          batchId: lastWorkerRun.batchId,
          lastError: lastWorkerRun.lastError,
        }
      : null,
    serviceDateDrift: driftReport === null
      ? null
      : { totalGroups: driftReport.totalGroups, driftCount: driftReport.driftCount },
  });

  res.json({
    overall,
    components,
    lastWorkerRun,
    workerRunning: isWorkerRunInProgress(),
    overdueCount,
    overdueGraceMinutes: OVERDUE_GRACE_MINUTES,
    nextSweepAt: nextSweepFire?.toISOString() ?? null,
    lastSweepAt: prevSweepFire?.toISOString() ?? null,
    generatedAt: now.toISOString(),
    bootedAt: bootTime.toISOString(),
  });
}));

// LLM email-classifier monitoring (Task #320). Filters portal_responses to
// the LLM-first cohort (rows stamped `metadata.classifierVersion` of
// 'llm-first-v1' or 'llm-first-v2' by `response-matcher.ts` — v2 was
// introduced by Task #321 when the AI hint output gained
// `newInvoiceNumber` + `suggestedPayorDenialReason`; the dashboard
// unions both versions so spend continues to roll up across the
// version bump) and rolls them up by day so
// the System Health page can show verdict mix, daily Anthropic spend, and
// alert when the most recent complete day's "other"/"abstain" rate
// spikes vs the trailing baseline.
//
// Pure aggregation lives in `classifier-stats.ts` (covered by unit tests);
// this handler is just the SQL fetch + projection into the rollup input.
router.get("/admin/system-health/classifier-stats", requireAdmin, asyncHandler(async (req, res): Promise<void> => {
  const rawDays = Number(req.query.days);
  // Clamp to a sensible window: 1..90 days, default 14. Anything beyond
  // 90 days is both expensive to scan and not useful for a "yesterday vs
  // baseline" alert — operators want an at-a-glance view, not a long
  // tail.
  const windowDays = Number.isFinite(rawDays)
    ? Math.min(90, Math.max(1, Math.floor(rawDays)))
    : 14;

  const now = new Date();
  // Pull from (windowDays - 1) days ago, midnight UTC, so the bucket
  // builder has a complete first day to anchor on.
  const sinceUtc = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() - (windowDays - 1),
  ));

  // Project just the columns the rollup needs. Filtering by the
  // classifierVersion stamp keeps the cohort honest — historical rows
  // from earlier classifier generations are excluded from spend +
  // verdict math even though they share the same table.
  const rows = await db
    .select({
      receivedAt: portalResponsesTable.receivedAt,
      classifierSource: portalResponsesTable.classifierSource,
      responseType: portalResponsesTable.responseType,
      // Numeric coercion happens server-side so the rollup math doesn't
      // have to defensively parse strings out of the metadata blob.
      costUsd: sql<number | null>`(${portalResponsesTable.metadata}->'classifierUsage'->>'costUsd')::numeric`,
      inputTokens: sql<number | null>`(${portalResponsesTable.metadata}->'classifierUsage'->>'inputTokens')::int`,
      outputTokens: sql<number | null>`(${portalResponsesTable.metadata}->'classifierUsage'->>'outputTokens')::int`,
    })
    .from(portalResponsesTable)
    .where(and(
      gte(portalResponsesTable.receivedAt, sinceUtc),
      sql`${portalResponsesTable.metadata}->>'classifierVersion' IN ('llm-first-v1', 'llm-first-v2')`,
    ));

  const projected: ClassifierStatsRow[] = rows.map((r) => ({
    receivedAt: r.receivedAt,
    classifierSource: r.classifierSource,
    // responseType is the DB enum; the rollup keys by ClassifiedDecision
    // which is the same string set.
    responseType: r.responseType as ClassifiedDecision,
    costUsd: r.costUsd === null ? null : Number(r.costUsd),
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
  }));

  const stats = computeClassifierStats({ windowDays, now, rows: projected });

  if (stats.alerts.length > 0) {
    // Log alerts so an outage shows up in the worker logs even if no one
    // is looking at the dashboard. Operators get the human-readable
    // message; structured fields stay queryable.
    for (const alert of stats.alerts) {
      logger.warn({
        kind: alert.kind,
        recentRate: alert.recentRate,
        baselineRate: alert.baselineRate,
        recentSample: alert.recentSample,
      }, `Classifier alert: ${alert.message}`);
    }
  }

  res.json({
    ...stats,
    generatedAt: now.toISOString(),
  });
}));

export default router;
