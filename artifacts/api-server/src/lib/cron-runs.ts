import { db } from "@workspace/db";
import { cronRunsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

export interface CronRunResult {
  // Producer-facing vocabulary (kept for backwards compatibility with
  // the existing call sites in system-health-rollup.ts and
  // batch-processor.ts that build `{status: "ok"|"degraded"}` shapes).
  // The recorder maps this onto the canonical 3-value run-state
  // {running | completed | failed} written to `cron_runs.status`:
  //   ok        → completed
  //   degraded  → failed   (surfaces as a failure in the health rollup;
  //                         partial-success metadata stays in `message`)
  //   failed    → failed
  // A thrown error from the job also becomes status="failed".
  //
  // Wave D-PR6 / state-fingerprint §G: this collapse drops the
  // `cron_drift` violation count to zero by removing the legacy
  // "ok"/"degraded" string mismatch against the {running|completed|
  // failed} contract. Existing rows are normalised in migration 0039.
  status?: "ok" | "degraded" | "failed";
  message?: string;
  metadata?: Record<string, unknown>;
}

function mapResultStatus(s: CronRunResult["status"]): "completed" | "failed" {
  if (s === "failed" || s === "degraded") return "failed";
  return "completed";
}

export async function recordCronRun(
  jobName: string,
  fn: () => Promise<CronRunResult | void>,
): Promise<void> {
  let runId: number | null = null;
  try {
    const [row] = await db
      .insert(cronRunsTable)
      .values({ jobName, status: "running" })
      .returning({ id: cronRunsTable.id });
    runId = row.id;
  } catch (err) {
    logger.error({ err, jobName }, "recordCronRun: failed to insert start row");
  }

  try {
    const result = await fn();
    if (runId != null) {
      try {
        await db
          .update(cronRunsTable)
          .set({
            status: mapResultStatus(result?.status),
            finishedAt: new Date(),
            message: result?.message ?? null,
            metadata: result?.metadata ?? null,
          })
          .where(eq(cronRunsTable.id, runId));
      } catch (e) {
        logger.error({ err: e, jobName, runId }, "recordCronRun: failed to update ok row");
      }
    }
  } catch (err: any) {
    const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    logger.error({ err, jobName }, "recordCronRun: job threw");
    if (runId != null) {
      try {
        await db
          .update(cronRunsTable)
          .set({
            status: "failed",
            finishedAt: new Date(),
            message: msg.slice(0, 1000),
          })
          .where(eq(cronRunsTable.id, runId));
      } catch (e) {
        logger.error({ err: e, jobName, runId }, "recordCronRun: failed to update failed row");
      }
    }
  }
}
