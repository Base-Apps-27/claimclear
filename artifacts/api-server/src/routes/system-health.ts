import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { cronRunsTable, connectorHealthTable, emailBouncesTable, portalSubmissionsTable } from "@workspace/db";
import { desc, gte, sql, eq, and, or, isNull, lte, count } from "drizzle-orm";
import { asyncHandler } from "../lib/asyncHandler";
import { requireAdmin } from "../middlewares/requireAdmin";
import { requireAuth } from "../middlewares/requireAuth";
import { CronExpressionParser } from "cron-parser";
import { logger } from "../lib/logger";
import {
  getLastWorkerRun,
  getRecentWorkerRuns,
  isWorkerRunInProgress,
} from "../lib/batch-processor";
import { computeRollup } from "../lib/system-health-rollup";

const router: IRouter = Router();

// Cron job names + their cron expressions, kept in sync with index.ts
const KNOWN_JOBS: { name: string; cron: string; tz: string }[] = [
  { name: "portal_batch_sweeper", cron: "0 */4 * * *", tz: "America/New_York" },
  { name: "daily_brief", cron: "0 7 * * 1-5", tz: "America/New_York" },
  { name: "response_tracker", cron: "*/30 8-18 * * 1-5", tz: "America/New_York" },
  { name: "outlook_heartbeat", cron: "*/15 * * * *", tz: "America/New_York" },
  { name: "stuck_submission_reset", cron: "*/30 * * * *", tz: "America/New_York" },
];

// How long a pending submission can sit "due" before we treat it as overdue.
const OVERDUE_THRESHOLD_MINUTES = 15;

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
  const overdueCutoff = new Date(now.getTime() - OVERDUE_THRESHOLD_MINUTES * 60 * 1000);

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

  // Overdue rule mirrors `isSubmissionOverdue`: scheduled retry past cutoff,
  // or no scheduled retry and createdAt past cutoff.
  const [{ value: overdueCount } = { value: 0 }] = await db
    .select({ value: count() })
    .from(portalSubmissionsTable)
    .where(and(
      eq(portalSubmissionsTable.status, "pending"),
      or(
        lte(portalSubmissionsTable.nextRetryAt, overdueCutoff),
        and(
          isNull(portalSubmissionsTable.nextRetryAt),
          lte(portalSubmissionsTable.createdAt, overdueCutoff),
        ),
      ),
    ));

  // Last successful submission — we treat "submitted" as success (the portal
  // accepted the row and assigned a confirmation number).
  const [lastSuccess] = await db
    .select({
      id: portalSubmissionsTable.id,
      claimId: portalSubmissionsTable.claimId,
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
      claimId: portalSubmissionsTable.claimId,
      attempts: portalSubmissionsTable.attempts,
      maxAttempts: portalSubmissionsTable.maxAttempts,
      errorMessage: portalSubmissionsTable.errorMessage,
      updatedAt: portalSubmissionsTable.updatedAt,
    })
    .from(portalSubmissionsTable)
    .where(eq(portalSubmissionsTable.status, "failed"))
    .orderBy(desc(portalSubmissionsTable.updatedAt))
    .limit(1);

  // Next scheduled retry sweeper fire — derived from the cron expression so
  // the UI can show "next sweep in 2m" without polling cron internals.
  let nextSweepAt: string | null = null;
  try {
    const sweeper = KNOWN_JOBS.find((j) => j.name === "portal_batch_sweeper");
    if (sweeper) {
      const it = CronExpressionParser.parse(sweeper.cron, { tz: sweeper.tz, currentDate: now });
      nextSweepAt = it.next().toDate().toISOString();
    }
  } catch (err) {
    logger.warn({ err }, "worker-activity: failed to compute nextSweepAt");
  }

  res.json({
    isRunning: isWorkerRunInProgress(),
    lastRun: getLastWorkerRun(),
    recentRuns: getRecentWorkerRuns(),
    pendingDueCount,
    overdueCount,
    overdueThresholdMinutes: OVERDUE_THRESHOLD_MINUTES,
    nextSweepAt,
    lastSuccessfulSubmission: lastSuccess
      ? {
          submissionId: lastSuccess.id,
          claimId: lastSuccess.claimId,
          confNumber: lastSuccess.confNumber,
          submittedAt: lastSuccess.submittedAt,
          at: lastSuccess.updatedAt.toISOString(),
        }
      : null,
    lastFailedSubmission: lastFailed
      ? {
          submissionId: lastFailed.id,
          claimId: lastFailed.claimId,
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
router.get("/admin/system-health/rollup", requireAuth, asyncHandler(async (_req, res): Promise<void> => {
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

  // Resolve each known cron's previous expected fire time once.
  const knownJobs = KNOWN_JOBS.map((known) => {
    let prevExpected: Date | null = null;
    try {
      prevExpected = CronExpressionParser.parse(known.cron, { tz: known.tz }).prev().toDate();
    } catch (err) {
      logger.warn({ err, cron: known.cron }, "Cron parse failed in rollup");
    }
    return { name: known.name, prevExpected };
  });

  // Same overdue rule as the worker-activity endpoint and dashboard tile.
  const now = new Date();
  const overdueCutoff = new Date(now.getTime() - OVERDUE_THRESHOLD_MINUTES * 60 * 1000);
  const [{ value: overdueCount } = { value: 0 }] = await db
    .select({ value: count() })
    .from(portalSubmissionsTable)
    .where(and(
      eq(portalSubmissionsTable.status, "pending"),
      or(
        lte(portalSubmissionsTable.nextRetryAt, overdueCutoff),
        and(
          isNull(portalSubmissionsTable.nextRetryAt),
          lte(portalSubmissionsTable.createdAt, overdueCutoff),
        ),
      ),
    ));

  const lastWorkerRun = getLastWorkerRun();

  const { overall, components } = computeRollup({
    now,
    connectors: connectors.map((c) => ({
      connectorName: c.connectorName,
      status: c.status,
      lastError: c.lastError,
    })),
    knownJobs,
    lastRunByJob,
    overdueCount,
    overdueThresholdMinutes: OVERDUE_THRESHOLD_MINUTES,
    lastWorkerRun: lastWorkerRun
      ? {
          status: lastWorkerRun.status,
          finishedAt: lastWorkerRun.finishedAt,
          startedAt: lastWorkerRun.startedAt,
          batchId: lastWorkerRun.batchId,
          lastError: lastWorkerRun.lastError,
        }
      : null,
  });

  res.json({
    overall,
    components,
    lastWorkerRun,
    workerRunning: isWorkerRunInProgress(),
    overdueCount,
    overdueThresholdMinutes: OVERDUE_THRESHOLD_MINUTES,
    generatedAt: now.toISOString(),
  });
}));

export default router;
