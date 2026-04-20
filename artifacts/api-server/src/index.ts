import app from "./app";
import { logger } from "./lib/logger";
import cron from "node-cron";
import { startBatchJob } from "./lib/batch-processor";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { recordCronRun } from "./lib/cron-runs";
import { isOutlookConnected, probeOutlook } from "./lib/outlook";
import { recordConnectorHealth } from "./lib/connector-health";

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

  try {
    await db.execute(sql`
      UPDATE portal_responses
      SET conversation_id = metadata->>'conversationId'
      WHERE conversation_id IS NULL
        AND metadata ? 'conversationId'
    `);
    logger.info("One-time migration: backfilled portal_responses.conversation_id from metadata");
  } catch (err) {
    logger.warn({ err }, "One-time migration: conversation_id backfill failed");
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
  await recordCronRun("midnight_portal_processor", async () => {
    logger.info("Midnight cron: processing all pending portal submissions");
    try {
      const job = await startBatchJob("all", "Midnight Auto-Process");
      logger.info({ batchId: job.id, total: job.total }, "Midnight batch job started");
      return { message: `Started batch ${job.id} with ${job.total} submissions`, metadata: { batchId: job.id, total: job.total } };
    } catch (err) {
      logger.info("Midnight cron: no pending submissions to process");
      return { message: "No pending submissions to process" };
    }
  });
}, { timezone: "America/New_York" });

const BOT_TOKEN = process.env.BOT_SERVICE_TOKEN;
if (!BOT_TOKEN) {
  logger.warn("BOT_SERVICE_TOKEN not set; cron jobs that call internal HTTP endpoints will fail authentication.");
}

cron.schedule("0 7 * * 1-5", async () => {
  await recordCronRun("daily_brief", async () => {
    logger.info("Daily brief cron: sending morning brief");
    const res = await fetch(`http://localhost:${port}/api/daily-brief`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-bot-token": BOT_TOKEN ?? "" },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(`Daily brief HTTP ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
    }
    logger.info({ result: data }, "Daily brief sent");
    return { message: data?.message ?? "Daily brief sent", metadata: data };
  });
}, { timezone: "America/New_York" });

cron.schedule("*/30 8-18 * * 1-5", async () => {
  await recordCronRun("response_tracker", async () => {
    logger.info("Response tracker cron: checking email inbox for responses");
    const res = await fetch(`http://localhost:${port}/api/responses/check-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-bot-token": BOT_TOKEN ?? "" },
      body: JSON.stringify({ hoursBack: 1 }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(`Response tracker HTTP ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
    }
    logger.info({ result: data }, "Email response check completed");
    return {
      message: `${data?.checked ?? 0} checked, ${data?.matched ?? 0} matched, ${data?.bounces ?? 0} bounces`,
      metadata: data,
    };
  });
}, { timezone: "America/New_York" });

cron.schedule("*/15 * * * *", async () => {
  await recordCronRun("outlook_heartbeat", async () => {
    const tokenOk = await isOutlookConnected();
    if (!tokenOk) {
      await recordConnectorHealth("outlook", "unhealthy", "No valid OAuth token / not connected");
      return { message: "Outlook unhealthy: no token" };
    }
    const probe = await probeOutlook();
    if (!probe.ok) {
      await recordConnectorHealth("outlook", "unhealthy", probe.error ?? "/me probe failed");
      return { message: `Outlook unhealthy: ${probe.error?.slice(0, 120) ?? "probe failed"}` };
    }
    await recordConnectorHealth("outlook", "healthy", null, { email: probe.email });
    return { message: `Outlook healthy (${probe.email ?? "unknown mailbox"})` };
  });
}, { timezone: "America/New_York" });

// Run an initial heartbeat shortly after boot so System Health has data immediately.
setTimeout(() => {
  recordCronRun("outlook_heartbeat", async () => {
    const tokenOk = await isOutlookConnected();
    if (!tokenOk) {
      await recordConnectorHealth("outlook", "unhealthy", "No valid OAuth token / not connected");
      return { message: "Outlook unhealthy: no token" };
    }
    const probe = await probeOutlook();
    if (!probe.ok) {
      await recordConnectorHealth("outlook", "unhealthy", probe.error ?? "/me probe failed");
      return { message: `Outlook unhealthy: ${probe.error?.slice(0, 120)}` };
    }
    await recordConnectorHealth("outlook", "healthy", null, { email: probe.email });
    return { message: `Outlook healthy (${probe.email ?? "unknown mailbox"})` };
  }).catch(() => undefined);
}, 5000);
