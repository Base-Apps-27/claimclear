// Task #841. End-to-end shape test for the per-bot health summary
// endpoint and the per-bot run-history drawer endpoint.
//
// Pins:
//   1. Both endpoints require admin (clerk -> 403).
//   2. `/admin/system-health/bots` returns one card per known bot
//      (submit / payor_response_scan / portal_scrape) with derived
//      status + last success/failure timestamps + a 7-day sparkline.
//   3. A bot with a recent successful run + zero failures is "healthy".
//   4. A bot whose most recent run failed is "degraded".
//   5. A bot whose last successful run is older than 24h is "down".
//   6. `/admin/system-health/bots/:botId/runs` returns the last 20
//      cron_runs for the underlying job_name.
//   7. An unknown botId returns 404.

import { test, before, after } from "node:test";
import { strict as assert } from "node:assert";
import http from "node:http";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import { inArray } from "drizzle-orm";

import systemHealthRouter from "../routes/system-health";
import { db, pool, cronRunsTable } from "@workspace/db";

interface BotHealthCard {
  id: "submit" | "payor_response_scan" | "portal_scrape";
  label: string;
  jobName: string;
  status: "healthy" | "degraded" | "down";
  statusReason: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastFailureMessage: string | null;
  queueDepth: number | null;
  queueLabel: string | null;
  avgDurationMs7d: number | null;
  runs7d: number;
  failures7d: number;
  durationSparkline: (number | null)[];
}
interface BotHealthResponse { bots: BotHealthCard[] }

interface BotRunRecord {
  id: number;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  status: string;
  message: string | null;
}
interface BotRunsResponse { botId: string; jobName: string; runs: BotRunRecord[] }

let server: http.Server;
let baseUrl: string;
const createdRunIds: number[] = [];

let activeUser: { email: string; displayName: string; role: string; status: string } = {
  email: "bots-test-admin@example.com",
  displayName: "Bots Test Admin",
  role: "admin",
  status: "approved",
};

before(async () => {
  const app: Express = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).user = { ...activeUser };
    (req as any).isAuthenticated = () => true;
    (req as any).log = { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} };
    next();
  });
  app.use("/api", systemHealthRouter);

  await new Promise<void>((resolveListen, rejectListen) => {
    server = app.listen(0, () => {
      const addr = server.address();
      if (typeof addr === "object" && addr) {
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolveListen();
      } else {
        rejectListen(new Error("Failed to obtain test server port"));
      }
    });
  });
});

after(async () => {
  if (createdRunIds.length > 0) {
    await db.delete(cronRunsTable).where(inArray(cronRunsTable.id, createdRunIds));
  }
  server.closeAllConnections?.();
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  await pool.end().catch(() => undefined);
});

async function fetchJson<T = unknown>(path: string): Promise<{ status: number; json: T }> {
  const url = new URL(`${baseUrl}${path}`);
  return new Promise((resolveReq, rejectReq) => {
    const req = http.request(
      { hostname: url.hostname, port: url.port, path: url.pathname + url.search, method: "GET" },
      (res) => {
        let raw = "";
        res.setEncoding("utf8");
        res.on("data", (c) => { raw += c; });
        res.on("end", () => {
          try {
            resolveReq({ status: res.statusCode ?? 0, json: JSON.parse(raw) as T });
          } catch (e) {
            rejectReq(e);
          }
        });
      },
    );
    req.on("error", rejectReq);
    req.end();
  });
}

test("GET /admin/system-health/bots: clerks are denied (403)", async () => {
  const prev = activeUser;
  activeUser = { email: "clerk@example.com", displayName: "Clerk", role: "clerk", status: "approved" };
  try {
    const { status } = await fetchJson("/api/admin/system-health/bots");
    assert.equal(status, 403);
    const { status: status2 } = await fetchJson("/api/admin/system-health/bots/submit/runs");
    assert.equal(status2, 403);
  } finally {
    activeUser = prev;
  }
});

test("GET /admin/system-health/bots: returns one card per known bot with derived status", async () => {
  const now = Date.now();
  // Seed:
  //   portal_batch_sweeper (submit)            -> healthy (recent success)
  //   response_tracker     (payor scan)        -> degraded (last run failed)
  //   portal_response_sync (portal scrape)     -> down (last success > 24h)
  const seeds = [
    {
      jobName: "portal_batch_sweeper",
      startedAt: new Date(now - 10 * 60 * 1000),
      finishedAt: new Date(now - 9 * 60 * 1000),
      status: "completed",
      message: "ok",
    },
    {
      jobName: "response_tracker",
      startedAt: new Date(now - 60 * 60 * 1000),
      finishedAt: new Date(now - 59 * 60 * 1000),
      status: "completed",
      message: null,
    },
    {
      jobName: "response_tracker",
      startedAt: new Date(now - 5 * 60 * 1000),
      finishedAt: new Date(now - 4 * 60 * 1000),
      status: "failed",
      message: "Graph API 503\nat fetchInbox (response-tracker.ts:42)",
    },
    {
      jobName: "portal_response_sync",
      // 30h ago — outside the 24h success window so the bot is "down".
      startedAt: new Date(now - 30 * 60 * 60 * 1000),
      finishedAt: new Date(now - 30 * 60 * 60 * 1000 + 60_000),
      status: "completed",
      message: null,
    },
  ];
  const inserted = await db.insert(cronRunsTable).values(seeds).returning();
  createdRunIds.push(...inserted.map((r) => r.id));

  const { status, json } = await fetchJson<BotHealthResponse>("/api/admin/system-health/bots");
  assert.equal(status, 200);
  assert.equal(json.bots.length, 3, "expected one card per known bot");

  const byId = Object.fromEntries(json.bots.map((b) => [b.id, b]));
  assert.ok(byId.submit && byId.payor_response_scan && byId.portal_scrape);

  // submit: healthy with a recent completed run, queue depth surfaced
  assert.equal(byId.submit.jobName, "portal_batch_sweeper");
  assert.equal(byId.submit.status, "healthy");
  assert.ok(byId.submit.lastSuccessAt);
  assert.equal(byId.submit.queueLabel, "due");
  assert.equal(typeof byId.submit.queueDepth, "number");
  assert.equal(byId.submit.durationSparkline.length, 7);

  // payor_response_scan: degraded — last run failed (excerpt truncated to first line)
  assert.equal(byId.payor_response_scan.status, "degraded");
  assert.match(byId.payor_response_scan.statusReason ?? "", /failed/i);
  assert.equal(byId.payor_response_scan.lastFailureMessage, "Graph API 503");
  assert.equal(byId.payor_response_scan.queueDepth, null);

  // portal_scrape: down — only a stale success
  assert.equal(byId.portal_scrape.status, "down");
  assert.match(byId.portal_scrape.statusReason ?? "", /24 hours/);
});

test("GET /admin/system-health/bots/:botId/runs: returns recent runs", async () => {
  const { status, json } = await fetchJson<BotRunsResponse>("/api/admin/system-health/bots/payor_response_scan/runs");
  assert.equal(status, 200);
  assert.equal(json.botId, "payor_response_scan");
  assert.equal(json.jobName, "response_tracker");
  assert.ok(json.runs.length >= 2);
  // Most recent first
  const first = json.runs[0];
  assert.ok(first.startedAt);
  assert.equal(typeof first.durationMs, "number");
});

test("GET /admin/system-health/bots/:botId/runs: unknown bot id is 404", async () => {
  const { status } = await fetchJson("/api/admin/system-health/bots/bogus/runs");
  assert.equal(status, 404);
});
