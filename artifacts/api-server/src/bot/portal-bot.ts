/**
 * Manual one-shot trigger for the in-process portal worker.
 *
 *     pnpm --filter @workspace/api-server run bot:run
 *
 * Calls the same `triggerWorkerRun` used by the cron and waits up to 20
 * minutes for completion before exiting.
 */
import { triggerWorkerRun } from "../lib/batch-processor";
import { logger } from "../lib/logger";

const WATCHDOG_MS = 20 * 60 * 1000;

async function main(): Promise<void> {
  logger.info("Manual portal worker run starting (triggeredBy=manual:bot:run)");
  const outcome = await triggerWorkerRun({
    triggeredBy: "manual:bot:run",
    awaitCompletion: true,
    awaitTimeoutMs: WATCHDOG_MS,
  });

  if (outcome.kind === "skipped") {
    logger.warn({ reason: outcome.reason }, "Manual worker run skipped");
    process.exit(0);
  }

  if (outcome.awaited === "timeout") {
    logger.warn(
      { jobId: outcome.job.id, watchdogMs: WATCHDOG_MS },
      "Manual worker run still in progress at watchdog timeout — exiting; the run will continue in this process until it completes or the process exits.",
    );
    process.exit(0);
  }

  logger.info(
    {
      jobId: outcome.job.id,
      total: outcome.job.total,
      succeeded: outcome.job.succeeded,
      failed: outcome.job.failed,
      status: outcome.job.status,
    },
    "Manual worker run completed",
  );
  process.exit(outcome.job.failed > 0 ? 1 : 0);
}

main().catch((err) => {
  logger.error({ err }, "Manual worker run failed");
  process.exit(1);
});
