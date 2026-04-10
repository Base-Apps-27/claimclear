import path from "path";
import fs from "fs";
import { runBatchWorker, type PortalSubmission } from "./batch-worker";

const API_BASE = process.env.API_BASE_URL || "http://localhost:8080/api";
const SESSION_DIR = path.resolve("bot-session");
const BOT_NAME = process.env.BOT_NAME || `bot-${process.pid}`;
const BOT_DRY_RUN = process.env.BOT_DRY_RUN === "true";
const BOT_TOKEN: string = process.env.BOT_SERVICE_TOKEN || "";
if (!BOT_TOKEN) {
  console.error("[BOT] FATAL: BOT_SERVICE_TOKEN environment variable is required");
  process.exit(1);
}
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL || "30000", 10);
const EMPTY_QUEUE_BACKOFF = parseInt(process.env.EMPTY_QUEUE_BACKOFF || "300000", 10);
const MAX_RETRIES = 3;
const RETRY_BACKOFF_MS = 5000;

let botInstanceId: number | null = null;
let running = true;

async function api(endpoint: string, opts: RequestInit = {}): Promise<unknown> {
  const url = `${API_BASE}${endpoint}`;
  const res = await fetch(url, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      "X-Bot-Token": BOT_TOKEN,
      ...(opts.headers as Record<string, string>),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${opts.method || "GET"} ${endpoint} failed (${res.status}): ${text}`);
  }
  return res.json();
}

async function apiWithRetry(endpoint: string, opts: RequestInit = {}, retries = MAX_RETRIES): Promise<unknown> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await api(endpoint, opts);
    } catch (err) {
      if (attempt === retries) throw err;
      const delay = RETRY_BACKOFF_MS * attempt;
      console.warn(`[BOT] API call failed (attempt ${attempt}/${retries}), retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw new Error("Unreachable");
}

async function registerBot(): Promise<number> {
  const result = await apiWithRetry("/bot/instances", {
    method: "POST",
    body: JSON.stringify({ name: BOT_NAME }),
  }) as { id: number };
  console.log(`[BOT] Registered as instance ${result.id} (${BOT_NAME})`);
  return result.id;
}

async function heartbeat() {
  if (!botInstanceId) return;
  try {
    await api(`/bot/instances/${botInstanceId}/heartbeat`, { method: "POST" });
  } catch (err) {
    console.warn(`[BOT] Heartbeat failed:`, err);
  }
}

async function pollForWork(): Promise<PortalSubmission[]> {
  return apiWithRetry("/bot/portal-submissions/poll", {
    method: "POST",
    body: JSON.stringify({ botInstanceId }),
  }) as Promise<PortalSubmission[]>;
}

async function claimSubmission(id: number): Promise<PortalSubmission> {
  return api(`/bot/portal-submissions/${id}/claim`, {
    method: "POST",
    body: JSON.stringify({ botInstanceId }),
  }) as Promise<PortalSubmission>;
}

async function completeSubmission(id: number, portalTicketId: string, screenshotPath?: string | null) {
  return api(`/bot/portal-submissions/${id}/complete`, {
    method: "POST",
    body: JSON.stringify({ portalTicketId, botInstanceId, screenshotPath }),
  });
}

async function completeDryRun(id: number, screenshotPath: string | null) {
  return api(`/bot/portal-submissions/${id}/complete-dry-run`, {
    method: "POST",
    body: JSON.stringify({ botInstanceId, screenshotPath }),
  });
}

async function failSubmission(id: number, errorMessage: string, screenshotPath?: string | null) {
  return api(`/bot/portal-submissions/${id}/fail`, {
    method: "POST",
    body: JSON.stringify({ errorMessage, botInstanceId, screenshotPath }),
  });
}

async function processSubmission(submission: PortalSubmission): Promise<void> {
  const subId = submission.id;
  console.log(`[BOT] Processing submission ${subId} (conf: ${submission.confNumber})`);

  try {
    const result = await runBatchWorker(submission, BOT_DRY_RUN);

    if (BOT_DRY_RUN) {
      console.log(`[BOT] Submission ${subId} completed as dry run`);
      await completeDryRun(subId, result.screenshotPath || null);
    } else {
      const ticketId = result.ticketId || `portal-${Date.now()}`;
      console.log(`[BOT] Submission ${subId} completed with ticket ${ticketId}`);
      await completeSubmission(subId, ticketId, result.screenshotPath);
    }
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[BOT] Submission ${subId} failed:`, errorMsg);
    await failSubmission(subId, errorMsg);
  }
}

async function mainLoop() {
  console.log("[BOT] Starting portal submission bot...");
  if (BOT_DRY_RUN) console.log("[BOT] *** DRY RUN MODE ENABLED — submissions will NOT be submitted ***");

  if (!fs.existsSync(SESSION_DIR)) {
    fs.mkdirSync(SESSION_DIR, { recursive: true });
  }

  botInstanceId = await registerBot();

  const heartbeatInterval = setInterval(heartbeat, 15000);

  while (running) {
    try {
      const submissions = await pollForWork();

      if (submissions.length > 0) {
        console.log(`[BOT] Found ${submissions.length} pending submission(s)`);

        for (const sub of submissions) {
          if (!running) break;

          try {
            const claimed = await claimSubmission(sub.id);
            if (claimed) {
              try {
                await processSubmission(claimed);
              } catch (firstErr: unknown) {
                const firstMsg = firstErr instanceof Error ? firstErr.message : String(firstErr);
                console.warn(`[BOT] Submission ${sub.id} failed on first attempt: ${firstMsg}. Retrying in 10s...`);
                try {
                  await api(`/bot/portal-submissions/${sub.id}/retry`, { method: "POST" });
                } catch {}
                await new Promise(resolve => setTimeout(resolve, 10000));
                try {
                  const reclaimed = await claimSubmission(sub.id);
                  if (reclaimed) {
                    await processSubmission(reclaimed);
                  }
                } catch (retryErr: unknown) {
                  const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
                  console.error(`[BOT] Submission ${sub.id} failed on retry: ${retryMsg}`);
                }
              }
            }
          } catch (err: unknown) {
            const errMsg = err instanceof Error ? err.message : String(err);
            console.warn(`[BOT] Could not claim submission ${sub.id}:`, errMsg);
          }
        }
        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
      } else {
        console.log(`[BOT] Queue empty, backing off for ${EMPTY_QUEUE_BACKOFF / 1000}s`);
        await new Promise(resolve => setTimeout(resolve, EMPTY_QUEUE_BACKOFF));
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error("[BOT] Poll error:", errMsg);
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
    }
  }

  clearInterval(heartbeatInterval);

  if (botInstanceId) {
    try {
      await api(`/bot/instances/${botInstanceId}/stop`, { method: "POST" });
    } catch (err) {
      console.warn("[BOT] Failed to stop bot instance:", err);
    }
  }

  console.log("[BOT] Bot stopped.");
}

process.on("SIGINT", () => {
  console.log("[BOT] Received SIGINT, shutting down...");
  running = false;
});

process.on("SIGTERM", () => {
  console.log("[BOT] Received SIGTERM, shutting down...");
  running = false;
});

mainLoop().catch(err => {
  console.error("[BOT] Fatal error:", err);
  process.exit(1);
});
