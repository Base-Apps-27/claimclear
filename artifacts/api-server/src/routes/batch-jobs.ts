import { Router, type IRouter } from "express";
import { asyncHandler } from "../lib/asyncHandler";
import { startBatchJob, getBatchJob, listBatchJobs } from "../lib/batch-processor";

const router: IRouter = Router();

router.post("/portal-submissions/batch-process", asyncHandler(async (req, res): Promise<void> => {
  const { submissionIds } = req.body;

  if (!submissionIds) {
    res.status(400).json({ error: "submissionIds is required (array of IDs or 'all')" });
    return;
  }

  const triggeredBy = req.user?.displayName || req.user?.email || "Admin";

  try {
    const job = await startBatchJob(
      submissionIds === "all" ? "all" : submissionIds as number[],
      triggeredBy,
    );

    res.json({
      batchId: job.id,
      total: job.total,
      status: job.status,
      message: `Batch job started: ${job.total} submission(s) queued for processing`,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: msg });
  }
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
