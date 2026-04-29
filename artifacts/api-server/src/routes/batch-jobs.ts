import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { portalSubmissionsTable } from "@workspace/db";
import { eq, and, or, isNull, lte, count } from "drizzle-orm";
import { CronExpressionParser } from "cron-parser";
import { asyncHandler } from "../lib/asyncHandler";
import { logger } from "../lib/logger";
import {
  triggerWorkerRun,
  getBatchJob,
  listBatchJobs,
  getLastWorkerRun,
  getActiveBatchJob,
  requestBatchAbort,
  listBatchRunHistory,
  isWorkerRunInProgress,
} from "../lib/batch-processor";
import { addGlobalBatchClient } from "../lib/sse";

// Cron expression mirrors `portal_batch_sweeper` in system-health.ts. If the
// scheduler changes there, update this too — the header pill and the admin
// system-health endpoint must agree on when the next batch fires.
const PORTAL_BATCH_CRON = "0 8,11,14,18 * * 1-5";
const PORTAL_BATCH_TZ = "America/New_York";

const router: IRouter = Router();

// SSE channel that broadcasts batch lifecycle events (started, row status
// changes, progress, completed/failed/aborted) to every connected client so
// all viewers of the Portal Submissions page see the same shared run.
router.get("/portal-submissions/batch-events", (req, res) => {
  const userEmail = req.user?.email ?? null;
  const cleanup = addGlobalBatchClient(res, userEmail);
  req.on("close", cleanup);
});

// Snapshot of the currently-running batch (if any). Used by clients on
// initial page load and on reconnect to hydrate UI state without waiting for
// the next SSE event.
router.get("/portal-submissions/active-batch", asyncHandler(async (_req, res): Promise<void> => {
  const job = getActiveBatchJob();
  if (!job) {
    res.json({ active: false });
    return;
  }
  res.json({
    active: true,
    batchId: job.id,
    triggeredBy: job.triggeredBy,
    startedAt: job.startedAt,
    total: job.total,
    processed: job.processed,
    succeeded: job.succeeded,
    failed: job.failed,
    submissionIds: job.submissionIds,
  });
}));

// Admin "Process Pending" / "Process Selected" trigger. Routes through
// triggerWorkerRun so the one-worker-at-a-time gate is honored — concurrent
// admin clicks, sweeper kicks, and midnight cron can never spawn parallel
// Playwright sessions. If the body includes a non-empty `submissionIds`
// array, only those rows (filtered to pending + due) are claimed; otherwise
// the full pending queue is processed.
router.post("/portal-submissions/batch-process", asyncHandler(async (req, res): Promise<void> => {
  const triggeredBy = req.user?.displayName || req.user?.email || "Admin";
  const triggeredByEmail = req.user?.email ?? null;

  const rawIds = (req.body && Array.isArray(req.body.submissionIds))
    ? req.body.submissionIds
    : null;
  const submissionIds: number[] | "all" = rawIds && rawIds.length > 0
    ? rawIds.map((n: unknown) => Number(n)).filter((n: number) => Number.isFinite(n) && n > 0)
    : "all";

  const outcome = await triggerWorkerRun({ triggeredBy, triggeredByEmail, submissionIds });

  if (outcome.kind === "skipped") {
    if (outcome.reason === "already_running") {
      const last = getLastWorkerRun();
      res.status(202).json({
        skipped: true,
        reason: "already_running",
        message: "A worker run is already in progress; this trigger was coalesced.",
        lastRun: last,
      });
      return;
    }
    // no_pending
    res.status(200).json({
      skipped: true,
      reason: "no_pending",
      message: "No pending submissions to process.",
    });
    return;
  }

  const { job } = outcome;
  res.json({
    batchId: job.id,
    total: job.total,
    status: job.status,
    message: `Worker run started: ${job.total} submission(s) queued for processing`,
  });
}));

// User-initiated abort. Authorized for the user who triggered the run, or
// any admin (e.g. when the owner is unavailable). Flips an in-memory
// cancellation flag that processSequentially polls between rows; the worker
// then releases any still-claimed rows and broadcasts batch_aborted on the
// shared SSE channel so every viewer's UI updates.
router.post("/portal-submissions/batch-abort/:batchId", asyncHandler(async (req, res): Promise<void> => {
  const requester = {
    displayName: req.user?.displayName || req.user?.email || "",
    isAdmin: req.user?.role === "admin",
  };
  const result = requestBatchAbort(String(req.params.batchId), requester);
  if (!result.ok) {
    if (result.reason === "not_found") {
      res.status(404).json({ error: "Batch not found" });
      return;
    }
    if (result.reason === "not_running") {
      res.status(409).json({ error: "Batch is not running" });
      return;
    }
    // not_owner
    res.status(403).json({ error: "Only the user who started this batch (or an admin) can stop it." });
    return;
  }
  res.json({
    ok: true,
    batchId: result.job.id,
    abortRequestedBy: result.job.abortRequestedBy ?? null,
    message: "Stop signal sent — the batch will exit after the current row finishes.",
  });
}));

router.get("/portal-submissions/batch-status/:batchId", asyncHandler(async (req, res): Promise<void> => {
  const job = getBatchJob(String(req.params.batchId));
  if (!job) {
    res.status(404).json({ error: "Batch job not found" });
    return;
  }
  res.json(job);
}));

router.get("/portal-submissions/batch-jobs", asyncHandler(async (_req, res): Promise<void> => {
  res.json(listBatchJobs());
}));

// Recent batch run history (DB-backed). Admins see every run, regular users
// only see runs they themselves triggered (matched by their email). Default
// limit 10, capped at 50 inside the helper.
router.get("/portal-submissions/batch-history", asyncHandler(async (req, res): Promise<void> => {
  const isAdmin = req.user?.role === "admin";
  const userEmail = req.user?.email ?? null;
  const limitParam = Number(req.query.limit);
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 10;

  // Non-admins must have an email so we can scope to their own runs.
  // Without an email there is no safe way to filter, so return empty
  // rather than silently exposing every run.
  if (!isAdmin && !userEmail) {
    res.json({ runs: [] });
    return;
  }

  const runs = await listBatchRunHistory({
    filterByEmail: isAdmin ? null : userEmail,
    limit,
  });
  res.json({ runs });
}));

// Slim batch-status snapshot for the persistent header pill. Available to any
// authenticated user (not just admins). Returns just enough state for the
// pill + popover: queue counts, next/previous batch fire times, today's
// schedule, and whether a batch is currently running. Polled every ~10s by
// the client and invalidated by SSE batch lifecycle events.
router.get("/portal-submissions/queue-status", asyncHandler(async (_req, res): Promise<void> => {
  const now = new Date();

  // Compute counts in parallel.
  const [queuedCountResult, runningCountResult] = await Promise.all([
    db
      .select({ value: count() })
      .from(portalSubmissionsTable)
      .where(and(
        eq(portalSubmissionsTable.status, "pending"),
        or(
          isNull(portalSubmissionsTable.nextRetryAt),
          lte(portalSubmissionsTable.nextRetryAt, now),
        ),
      )),
    db
      .select({ value: count() })
      .from(portalSubmissionsTable)
      .where(eq(portalSubmissionsTable.status, "in_progress")),
  ]);
  const queuedCount = queuedCountResult[0]?.value ?? 0;
  const runningCount = runningCountResult[0]?.value ?? 0;

  // Compute next + previous cron firings, plus today's full schedule.
  let nextBatchAt: string | null = null;
  let prevBatchAt: string | null = null;
  type ScheduleEntry = { at: string; isPast: boolean; isNext: boolean };
  const schedule: ScheduleEntry[] = [];
  try {
    const it = CronExpressionParser.parse(PORTAL_BATCH_CRON, { tz: PORTAL_BATCH_TZ, currentDate: now });
    nextBatchAt = it.next().toDate().toISOString();
    const itPrev = CronExpressionParser.parse(PORTAL_BATCH_CRON, { tz: PORTAL_BATCH_TZ, currentDate: now });
    prevBatchAt = itPrev.prev().toDate().toISOString();

    // Today's schedule: walk forward from local-midnight in the cron timezone
    // so we get every firing scheduled for "today" (in ET). Stop once we
    // cross the next day.
    const todayStartLocal = new Date(now.toLocaleString("en-US", { timeZone: PORTAL_BATCH_TZ }));
    todayStartLocal.setHours(0, 0, 0, 0);
    const itDay = CronExpressionParser.parse(PORTAL_BATCH_CRON, {
      tz: PORTAL_BATCH_TZ,
      currentDate: todayStartLocal,
    });
    const todayDateStr = now.toLocaleDateString("en-US", { timeZone: PORTAL_BATCH_TZ });
    for (let i = 0; i < 6; i += 1) {
      const fire = itDay.next().toDate();
      const fireDateStr = fire.toLocaleDateString("en-US", { timeZone: PORTAL_BATCH_TZ });
      if (fireDateStr !== todayDateStr) break;
      schedule.push({
        at: fire.toISOString(),
        isPast: fire <= now,
        isNext: nextBatchAt !== null && fire.toISOString() === nextBatchAt,
      });
    }
  } catch (err) {
    logger.warn({ err }, "queue-status: failed to compute cron firings");
  }

  res.json({
    isRunning: isWorkerRunInProgress(),
    nextBatchAt,
    prevBatchAt,
    queuedCount,
    runningCount,
    schedule,
  });
}));

export default router;
