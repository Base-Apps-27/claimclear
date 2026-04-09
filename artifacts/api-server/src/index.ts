import app from "./app";
import { logger } from "./lib/logger";
import cron from "node-cron";
import { startBatchJob } from "./lib/batch-processor";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});

cron.schedule("0 0 * * *", async () => {
  logger.info("Midnight cron: processing all pending portal submissions");
  try {
    const job = await startBatchJob("all", "Midnight Auto-Process");
    logger.info({ batchId: job.id, total: job.total }, "Midnight batch job started");
  } catch (err) {
    logger.info("Midnight cron: no pending submissions to process");
  }
}, { timezone: "America/New_York" });
