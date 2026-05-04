import { db } from "@workspace/db";
import { cronRunsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

export interface CronRunResult {
  // status defaults to "ok". Use "degraded" for partial failures worth
  // surfacing without alerting, "failed" when the cron callee handles
  // its own errors and returns a structured failure outcome. A thrown
  // error also becomes status="failed".
  status?: "ok" | "degraded" | "failed";
  message?: string;
  metadata?: Record<string, unknown>;
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
            status: result?.status ?? "ok",
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
