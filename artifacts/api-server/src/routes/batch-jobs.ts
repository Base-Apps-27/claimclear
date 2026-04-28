import { Router, type IRouter } from "express";
import { asyncHandler } from "../lib/asyncHandler";
import {
  triggerWorkerRun,
  getBatchJob,
  listBatchJobs,
  getLastWorkerRun,
} from "../lib/batch-processor";

const router: IRouter = Router();

// Admin "Process Pending" trigger. Routes through triggerWorkerRun so the
// one-worker-at-a-time gate is honored — concurrent admin clicks, sweeper
// kicks, and midnight cron can never spawn parallel Playwright sessions.
// We intentionally drop the legacy "submissionIds" array filter: the worker
// now always processes the full pending queue, and per-submission retry has
// its own dedicated endpoint in routes/portal-submissions.ts.
router.post("/portal-submissions/batch-process", asyncHandler(async (req, res): Promise<void> => {
  const triggeredBy = req.user?.displayName || req.user?.email || "Admin";

  const outcome = await triggerWorkerRun({ triggeredBy });

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
