import app from "./app";
import { logger } from "./lib/logger";
import cron from "node-cron";
import { startBatchJob } from "./lib/batch-processor";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

(async () => {
  try {
    await db.execute(sql`
      UPDATE portal_submissions ps
      SET attachment_urls = (
        SELECT COALESCE(json_agg(ce.image_url), '[]'::json)
        FROM claim_evidence ce
        WHERE ce.claim_id = ps.claim_id
          AND ce.image_url IS NOT NULL
          AND ce.image_url != ''
      )
      WHERE (ps.attachment_urls IS NULL OR ps.attachment_urls::text = '[]' OR ps.attachment_urls::text = 'null')
        AND ps.claim_id IS NOT NULL
    `);
    logger.info("One-time migration: backfilled attachment_urls from claim_evidence");
  } catch (err) {
    logger.warn({ err }, "One-time migration: attachment_urls backfill failed");
  }
})();

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

const BOT_TOKEN = process.env.BOT_SERVICE_TOKEN;
if (!BOT_TOKEN) {
  logger.warn("BOT_SERVICE_TOKEN not set; cron jobs that call internal HTTP endpoints will fail authentication.");
}

cron.schedule("0 7 * * 1-5", async () => {
  logger.info("Daily brief cron: sending morning brief");
  try {
    const res = await fetch(`http://localhost:${port}/api/daily-brief`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-bot-token": BOT_TOKEN ?? "" },
    });
    const data = await res.json();
    if (!res.ok) {
      logger.error({ status: res.status, data }, "Daily brief cron returned non-OK");
    } else {
      logger.info({ result: data }, "Daily brief sent");
    }
  } catch (err) {
    logger.error({ err }, "Daily brief cron failed");
  }
}, { timezone: "America/New_York" });

cron.schedule("*/30 8-18 * * 1-5", async () => {
  logger.info("Response tracker cron: checking email inbox for responses");
  try {
    const res = await fetch(`http://localhost:${port}/api/responses/check-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-bot-token": BOT_TOKEN ?? "" },
      body: JSON.stringify({ hoursBack: 1 }),
    });
    const data = await res.json();
    if (!res.ok) {
      logger.error({ status: res.status, data }, "Response tracker cron returned non-OK");
    } else {
      logger.info({ result: data }, "Email response check completed");
    }
  } catch (err) {
    logger.error({ err }, "Response tracker cron failed");
  }
}, { timezone: "America/New_York" });
