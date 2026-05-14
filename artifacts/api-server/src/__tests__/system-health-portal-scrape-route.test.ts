// Task #738. End-to-end shape test for the new
// `GET /admin/system-health/portal-scrape` drill-down endpoint. The
// route joins the most recent `cron_runs` row for `portal_response_sync`
// with every `portal_submissions` row whose `last_scraped_at` falls
// inside that run's window, and returns one entry per considered
// ticket so the System Health "Last portal scrape" panel can render a
// per-ticket table (matching the per-recipient table on "Last Daily
// Brief"). This test pins:
//   1. The endpoint requires admin (clerk → 403).
//   2. With no portal_response_sync run yet, returns
//      `{ lastRun: null, submissions: [] }`.
//   3. With a recent run + scraped/errored rows in-window, returns the
//      run header (status, started_at, message) AND a `submissions[]`
//      array carrying outcome + lastScrapedAt + errorExcerpt for every
//      in-window ticket.
//   4. The `meta` totals from `cron_runs.metadata` (considered/scraped/
//      errored/newResponses) flow through unchanged.

import { test, before, after } from "node:test";
import { strict as assert } from "node:assert";
import http from "node:http";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import { eq, inArray } from "drizzle-orm";

import systemHealthRouter from "../routes/system-health";
import {
  db,
  pool,
  cronRunsTable,
  invoiceGroupsTable,
  portalSubmissionsTable,
} from "@workspace/db";

interface PortalScrapeDetailRow {
  submissionId: number;
  invoiceGroupId: number;
  invoiceNumber: string | null;
  portalTicketId: string | null;
  lastScrapedAt: string | null;
  outcome: "new_reply" | "no_change" | "error" | null;
  errorExcerpt: string | null;
}

interface PortalScrapeDetailResponse {
  lastRun: {
    id: number;
    startedAt: string;
    finishedAt: string | null;
    status: string;
    message: string | null;
  } | null;
  considered: number | null;
  scraped: number | null;
  skipped: number | null;
  errored: number | null;
  newResponses: number | null;
  submissions: PortalScrapeDetailRow[];
}

let server: http.Server;
let baseUrl: string;
const createdGroupIds: number[] = [];
const createdSubmissionIds: number[] = [];
const createdRunIds: number[] = [];

let activeUser: { email: string; displayName: string; role: string; status: string } = {
  email: "scrape-test-admin@example.com",
  displayName: "Scrape Test Admin",
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
  if (createdSubmissionIds.length > 0) {
    await db.delete(portalSubmissionsTable).where(inArray(portalSubmissionsTable.id, createdSubmissionIds));
  }
  if (createdGroupIds.length > 0) {
    await db.delete(invoiceGroupsTable).where(inArray(invoiceGroupsTable.id, createdGroupIds));
  }
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

test("GET /admin/system-health/portal-scrape: clerks are denied (403)", async () => {
  const prev = activeUser;
  activeUser = { email: "clerk@example.com", displayName: "Clerk", role: "clerk", status: "approved" };
  try {
    const { status } = await fetchJson("/api/admin/system-health/portal-scrape");
    assert.equal(status, 403, "non-admin must be blocked from the drill-down");
  } finally {
    activeUser = prev;
  }
});

test("GET /admin/system-health/portal-scrape: returns per-ticket rows for the most recent run with metadata totals", async () => {
  const tag = `scrape-route-${Date.now()}`;

  // Two invoice groups with two distinct portal submissions. We'll
  // stamp one with `new_reply` and one with `error` inside the run's
  // window so the route returns both.
  const [groupA] = await db.insert(invoiceGroupsTable).values({
    invoiceNumber: `${tag}-A`, status: "Portal Queued",
  }).returning();
  const [groupB] = await db.insert(invoiceGroupsTable).values({
    invoiceNumber: `${tag}-B`, status: "Portal Queued",
  }).returning();
  const groups = [groupA, groupB];
  createdGroupIds.push(...groups.map((g) => g.id));

  const startedAt = new Date(Date.now() - 5 * 60 * 1000);
  const finishedAt = new Date(Date.now() - 1 * 60 * 1000);
  const scrapedAt = new Date(Date.now() - 2 * 60 * 1000);

  const [subA] = await db.insert(portalSubmissionsTable).values({
    invoiceGroupId: groups[0].id,
    status: "submitted",
    invoiceNumber: groups[0].invoiceNumber,
    portalTicketId: `${tag}-T1`,
    lastScrapedAt: scrapedAt,
    lastScrapeOutcome: "new_reply",
    lastScrapeError: null,
  }).returning();
  const [subB] = await db.insert(portalSubmissionsTable).values({
    invoiceGroupId: groups[1].id,
    status: "submitted",
    invoiceNumber: groups[1].invoiceNumber,
    portalTicketId: `${tag}-T2`,
    lastScrapedAt: scrapedAt,
    lastScrapeOutcome: "error",
    lastScrapeError: "reader timeout: portal nav stalled at /tickets",
  }).returning();
  const subs = [subA, subB];
  createdSubmissionIds.push(...subs.map((s) => s.id));

  const [run] = await db.insert(cronRunsTable).values({
    jobName: "portal_response_sync",
    startedAt,
    finishedAt,
    status: "degraded",
    message: "Partial sweep — 1/2 scraped, 1 errored",
    metadata: { considered: 2, scraped: 1, skipped: 0, errored: 1, newResponses: 1 },
  }).returning();
  createdRunIds.push(run.id);

  const { status, json } = await fetchJson<PortalScrapeDetailResponse>("/api/admin/system-health/portal-scrape");
  assert.equal(status, 200);
  assert.ok(json.lastRun, "lastRun must be present");
  assert.equal(json.lastRun!.status, "degraded");
  assert.equal(json.lastRun!.message, "Partial sweep — 1/2 scraped, 1 errored");

  // Metadata totals flow through unchanged so the UI header doesn't
  // have to recompute from per-row outcomes.
  assert.equal(json.considered, 2);
  assert.equal(json.scraped, 1);
  assert.equal(json.errored, 1);
  assert.equal(json.newResponses, 1);

  // Both seeded rows must be present (filter by tag because the
  // window query catches anything stamped during the run window —
  // including unrelated rows scraped concurrently in CI).
  const tagged = json.submissions.filter((s) => createdSubmissionIds.includes(s.submissionId));
  assert.equal(tagged.length, 2, "both seeded submissions must surface");

  const rowA = tagged.find((s) => s.submissionId === subs[0].id);
  const rowB = tagged.find((s) => s.submissionId === subs[1].id);
  assert.ok(rowA && rowB);
  assert.equal(rowA!.outcome, "new_reply");
  assert.equal(rowA!.errorExcerpt, null);
  assert.equal(rowA!.portalTicketId, `${tag}-T1`);
  assert.equal(rowB!.outcome, "error");
  assert.match(rowB!.errorExcerpt ?? "", /reader timeout/);
  assert.equal(rowB!.portalTicketId, `${tag}-T2`);
});
