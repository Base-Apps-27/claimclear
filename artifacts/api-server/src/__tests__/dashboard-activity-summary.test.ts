// Regression coverage for `GET /api/dashboard/my-activity-summary`.
//
// Task #639: the per-day-counts query in this route interpolated the
// validated `tz` query param into four separate `sql\`...${tz}...\``
// templates. Drizzle bound it as four distinct parameters, and Postgres
// — which compares SELECT/GROUP BY expressions by *structural* identity
// — then raised:
//
//   column "audit_logs.timestamp" must appear in the GROUP BY clause
//   or be used in an aggregate function
//
// turning every call into a 500 and stranding the avatar hover-card on
// its loading skeleton for every user. This test seeds a few audit-log
// rows in two different user-tz days and asserts the route returns 200
// with sensibly bucketed counts for a non-UTC `tz` query param. It
// fails against the pre-fix implementation.
import { test, before, after } from "node:test";
import { strict as assert } from "node:assert";
import http from "node:http";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import { inArray } from "drizzle-orm";

import dashboardRouter from "../routes/dashboard";
import { db, pool, auditLogsTable } from "@workspace/db";

const TEST_USER_EMAIL = `activity-summary-test+${Date.now()}@example.com`;
const TEST_TZ = "America/New_York";

let server: http.Server;
let baseUrl: string;
const seededAuditIds: number[] = [];

before(async () => {
  const app: Express = express();
  app.use(express.json());
  // Stand-in for the real auth middleware: the route reads
  // `req.user.email` to scope the query to the calling operator.
  app.use((req: Request, _res: Response, next: NextFunction) => {
    // Cast through `unknown` so the test stub doesn't have to satisfy
    // the full `Express.User` shape — only `email` is read by the route.
    (req as unknown as { user: { email: string } }).user = { email: TEST_USER_EMAIL };
    next();
  });
  app.use("/api", dashboardRouter);

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
  if (seededAuditIds.length) {
    await db
      .delete(auditLogsTable)
      .where(inArray(auditLogsTable.id, seededAuditIds))
      .catch(() => undefined);
  }
  server.closeAllConnections?.();
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  await pool.end().catch(() => undefined);
});

interface ActivitySummaryResponse {
  timezone: string;
  dayKey: string;
  today: number;
  thisWeek: number;
  thisMonth: number;
  streak: number;
  dailyCounts: Array<{ date: string; count: number }>;
}

async function fetchSummary(tz: string): Promise<{ status: number; body: string; json?: ActivitySummaryResponse }> {
  const url = new URL(`${baseUrl}/api/dashboard/my-activity-summary`);
  url.searchParams.set("tz", tz);
  return new Promise((resolveReq, rejectReq) => {
    const req = http.request(
      { hostname: url.hostname, port: url.port, path: url.pathname + url.search, method: "GET" },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(Buffer.from(c)));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          let json: ActivitySummaryResponse | undefined;
          try { json = JSON.parse(body) as ActivitySummaryResponse; } catch { /* non-JSON 500 body */ }
          resolveReq({ status: res.statusCode ?? 0, body, json });
        });
      },
    );
    req.on("error", rejectReq);
    req.end();
  });
}

async function seedAudit(action: string, when: Date): Promise<void> {
  const [row] = await db
    .insert(auditLogsTable)
    .values({
      action,
      details: "test",
      metadata: { source: "manual" },
      userEmail: TEST_USER_EMAIL,
      userName: "Test User",
      timestamp: when,
    })
    .returning({ id: auditLogsTable.id });
  seededAuditIds.push(row.id);
}

test("GET /api/dashboard/my-activity-summary returns 200 and bucketed counts for a non-UTC tz", async () => {
  // Probe the route once to learn what calendar day the server has
  // resolved as "today" in America/New_York. Anchoring the seeded
  // timestamps to *that* day (rather than `now.getUTCDate()`) keeps
  // this test deterministic across UTC/NY date boundaries — early UTC
  // hours (00:00–04:59 UTC) sit on the previous NY calendar day, and
  // a naive UTC anchor would seed rows under a different bucket from
  // the one the route reports.
  const probe = await fetchSummary(TEST_TZ);
  assert.equal(probe.status, 200, `expected probe 200, got ${probe.status}: ${probe.body}`);
  assert.ok(probe.json, "expected probe JSON response body");
  const todayKey = probe.json!.dayKey; // YYYY-MM-DD in America/New_York

  // Seed at 16:00 UTC on the NY today: that's 11:00/12:00 in NY for
  // both EST and EDT, comfortably inside the NY calendar day named by
  // `todayKey`.
  const [yyyy, mm, dd] = todayKey.split("-").map(n => parseInt(n, 10));
  const today1 = new Date(Date.UTC(yyyy, mm - 1, dd, 16, 0, 0));
  const today2 = new Date(Date.UTC(yyyy, mm - 1, dd, 16, 30, 0));
  const yesterday = new Date(Date.UTC(yyyy, mm - 1, dd - 1, 16, 0, 0));

  await seedAudit("outcome_changed", today1);
  await seedAudit("group_outcome_changed", today2);
  await seedAudit("outcome_changed", yesterday);

  const res = await fetchSummary(TEST_TZ);
  assert.equal(res.status, 200, `expected 200, got ${res.status}: ${res.body}`);
  assert.ok(res.json, "expected JSON response body");
  const json = res.json!;
  assert.equal(json.timezone, TEST_TZ);
  assert.equal(json.dayKey, todayKey, "dayKey should be stable across the two probe calls");
  // Today bucket should reflect the two seeded rows.
  assert.ok(json.today >= 2, `today should include the 2 seeded rows, got ${json.today}`);
  // The 12-week dailyCounts series should include the day key the
  // route resolved as "today" (densified).
  const todayBucket = json.dailyCounts.find(d => d.date === json.dayKey);
  assert.ok(todayBucket, `expected dailyCounts to include todayKey ${json.dayKey}`);
  assert.ok((todayBucket?.count ?? 0) >= 2, `today bucket should include the 2 seeded rows, got ${todayBucket?.count}`);
});
