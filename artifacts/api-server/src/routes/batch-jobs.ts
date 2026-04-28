import { Router, type IRouter } from "express";
import { asyncHandler } from "../lib/asyncHandler";
import {
  triggerWorkerRun,
  getBatchJob,
  listBatchJobs,
  getLastWorkerRun,
  getActiveBatchJob,
} from "../lib/batch-processor";
import { addGlobalBatchClient } from "../lib/sse";

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

  const rawIds = (req.body && Array.isArray(req.body.submissionIds))
    ? req.body.submissionIds
    : null;
  const submissionIds: number[] | "all" = rawIds && rawIds.length > 0
    ? rawIds.map((n: unknown) => Number(n)).filter((n: number) => Number.isFinite(n) && n > 0)
    : "all";

  const outcome = await triggerWorkerRun({ triggeredBy, submissionIds });

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

export default router;
