import { db } from "@workspace/db";
import { cronRunsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

export interface CronRunResult {
  // Producer-facing vocabulary the cron callers in
  // system-health-rollup.ts, batch-processor.ts, and
  // portal-response-sync.ts already build. The recorder maps this
  // onto the run-state column written to `cron_runs.status`:
  //   ok        → completed
  //   degraded  → degraded   (Task #738: partial-failure runs — e.g.
  //                           a portal scrape sweep where 19/25 tickets
  //                           succeeded and 6 errored — must be visible
  //                           as amber on the health rollup, not red.
  //                           Wave D-PR6's original collapse to "failed"
  //                           lost that signal; the rollup tile then
  //                           said "failed" for an in-tolerance
  //                           partial-success run, which trained
  //                           operators to ignore the dot.)
  //   failed    → failed
  // A thrown error from the job also becomes status="failed".
  status?: "ok" | "degraded" | "failed";
  message?: string;
  metadata?: Record<string, unknown>;
}

// Exported for tests so the producer→column mapping is exercised
// against the real implementation rather than a mirror. The function
// is also used internally by `recordCronRun` below.
export function mapResultStatus(s: CronRunResult["status"]): "completed" | "degraded" | "failed" {
  if (s === "failed") return "failed";
  if (s === "degraded") return "degraded";
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
