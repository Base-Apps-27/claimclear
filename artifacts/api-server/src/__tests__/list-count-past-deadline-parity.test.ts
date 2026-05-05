// Task #371 — list-count parity after the past-deadline filter move.
//
// Task #369 moved past-deadline filtering server-side so that on the
// invoice-groups and claims listings the `total`, the visible row set,
// and the "Showing A–B of N" counter all agree. Before the move the
// server returned past-deadline rows in `groups[]`/`claims[]` while a
// client-side post-fetch filter hid them, so `total` (computed from
// the unfiltered SQL count) and the visible count diverged.
//
// This test locks the server-side parity contract on three bypass
// branches:
//
//   (a) default list (no `includeExpired`, no `expiring`) — past-deadline
//       rows must be excluded from BOTH `total` and the row set, and the
//       two must agree.
//   (b) `?expiring=urgent` and `?expiring=stuck` — both intentionally
//       bypass the past-deadline guard (their whole point is to surface
//       deadline ≤ today rows). Past-deadline rows in the matching
//       status set must therefore appear.
//   (c) `?includeExpired=true` — explicit opt-in; past-deadline rows
//       in any status must appear.
//
// The seeded fixtures are scoped to a per-run `clientNumber` tag so the
// dev DB can carry unrelated rows safely (the parity assertion is over
// the seeded subset, scoped via `?search=<tag>`).

import { test, before, after } from "node:test";
import { strict as assert } from "node:assert";
import http from "node:http";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import { inArray } from "drizzle-orm";

import claimsRouter from "../routes/claims";
import invoiceGroupsRouter from "../routes/invoice-groups";
import { isUrgentDeadline } from "../lib/dates";
import {
  db,
  pool,
  claimsTable,
  invoiceGroupsTable,
  auditLogsTable,
} from "@workspace/db";

let server: http.Server;
let baseUrl: string;
const seededClaimIds: number[] = [];
const seededGroupIds: number[] = [];

// Per-run tag used as `clientNumber` on every seeded row so we can scope
// list responses to the seeded subset via the `search` filter (which is
// an ilike across clientNumber and friends on both endpoints). Keeps
// the test resilient to unrelated dev-DB rows.
const TAG = `T371-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

const TEST_USER = { email: "list-count-past-deadline@example.com", displayName: "Parity Tester" };

before(async () => {
  const app: Express = express();
  app.use(express.json());
  // Stub auth — mirrors the harness in must-file-today-parity.test.ts.
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).user = { ...TEST_USER, status: "approved" };
    (req as any).isAuthenticated = () => true;
    (req as any).log = { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} };
    next();
  });
  app.use("/api", claimsRouter);
  app.use("/api", invoiceGroupsRouter);

  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, () => {
      const addr = server.address();
      if (typeof addr === "object" && addr) {
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      } else {
        reject(new Error("Failed to obtain test server port"));
      }
    });
  });
});

after(async () => {
  if (seededClaimIds.length) {
    await db.delete(auditLogsTable).where(inArray(auditLogsTable.claimId, seededClaimIds)).catch(() => undefined);
    await db.delete(claimsTable).where(inArray(claimsTable.id, seededClaimIds)).catch(() => undefined);
  }
  if (seededGroupIds.length) {
    await db.delete(auditLogsTable).where(inArray(auditLogsTable.invoiceGroupId, seededGroupIds)).catch(() => undefined);
    await db.delete(invoiceGroupsTable).where(inArray(invoiceGroupsTable.id, seededGroupIds)).catch(() => undefined);
  }
  server.closeAllConnections?.();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end().catch(() => undefined);
});

// --- helpers --------------------------------------------------------------

function getJson(path: string): Promise<{ status: number; json: any }> {
  return new Promise((resolve, reject) => {
    const url = new URL(`${baseUrl}${path}`);
    const req = http.request(
      { hostname: url.hostname, port: Number(url.port), path: `${url.pathname}${url.search}`, method: "GET" },
      (res) => {
        let raw = "";
        res.setEncoding("utf8");
        res.on("data", (c) => { raw += c; });
        res.on("end", () => {
          try { resolve({ status: res.statusCode ?? 0, json: raw ? JSON.parse(raw) : {} }); }
          catch (e) { reject(e); }
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

// Calendar arithmetic, not timestamp — matches the rest of the deadline
// helpers and the seed pattern in urgent-today-transitions.test.ts.
function ymdDaysAgo(days: number): string {
  const ms = Date.now() - days * 24 * 60 * 60 * 1000;
  return new Date(ms).toISOString().slice(0, 10);
}

// Strict-today urgency: pick a service date whose 30-day deadline (after
// the weekend → Friday shift) lands exactly on today. Returns null on
// Sat/Sun because the shift always pulls weekend deadlines back to
// Friday — no service date can produce a "today" deadline on those
// days. Mirrors the helper in must-file-today-parity.test.ts.
function ymdServiceDateUrgentToday(): string | null {
  const now = new Date();
  for (let n = 28; n <= 34; n++) {
    const candidate = ymdDaysAgo(n);
    if (isUrgentDeadline(candidate, now)) return candidate;
  }
  return null;
}

interface SeedGroupOpts {
  status: "New" | "Needs Evidence" | "Portal Queued";
  serviceDate: string;
  label: string;
}

async function seedGroup(opts: SeedGroupOpts): Promise<number> {
  const invoiceNumber = `${TAG}-G-${opts.label}`;
  const [group] = await db.insert(invoiceGroupsTable).values({
    invoiceNumber,
    clientNumber: TAG,
    status: opts.status,
    outcome: "Pending",
    totalAmount: "100.00",
    serviceDate: opts.serviceDate,
  }).returning();
  seededGroupIds.push(group.id);
  return group.id;
}

interface SeedClaimOpts {
  status: "New" | "Needs Evidence" | "Portal Queued" | "Processed";
  date: string;
  label: string;
}

async function seedClaim(opts: SeedClaimOpts): Promise<number> {
  const confNumber = `${TAG}-C-${opts.label}`;
  const [claim] = await db.insert(claimsTable).values({
    confNumber,
    clientNumber: TAG,
    status: opts.status,
    outcome: "Pending",
    date: opts.date,
  }).returning();
  seededClaimIds.push(claim.id);
  return claim.id;
}

// --- tests ----------------------------------------------------------------

test("invoice-groups: total matches visible rows after past-deadline filter move", async () => {
  // On-deadline (well inside the 30-day window) — must appear in the
  // default list.
  const ok1 = await seedGroup({ status: "New", serviceDate: ymdDaysAgo(5), label: "ok1" });
  const ok2 = await seedGroup({ status: "Needs Evidence", serviceDate: ymdDaysAgo(10), label: "ok2" });
  // Past-deadline + actionable status — excluded by default, surfaced
  // by `?expiring=urgent` and `?includeExpired=true`.
  const pastNew1 = await seedGroup({ status: "New", serviceDate: ymdDaysAgo(60), label: "past-new-1" });
  const pastNew2 = await seedGroup({ status: "New", serviceDate: ymdDaysAgo(120), label: "past-new-2" });
  // Past-deadline + Portal Queued — excluded by default, surfaced
  // by `?expiring=stuck` and `?includeExpired=true` (NOT by
  // `?expiring=urgent`, which only matches the actionable status set).
  const pastStuck = await seedGroup({ status: "Portal Queued", serviceDate: ymdDaysAgo(90), label: "past-stuck" });

  // (a) default list — past-deadline rows must be excluded from BOTH
  // `total` and `groups[]`, and the two must agree on the visible set.
  {
    const { status, json } = await getJson(`/api/invoice-groups?search=${TAG}&limit=500`);
    assert.equal(status, 200, `default list HTTP ${status}: ${JSON.stringify(json).slice(0, 300)}`);
    const ids = (json.groups as Array<{ id: number }>).map(g => g.id);
    // limit > total → single page → groups.length must equal total.
    // This is the regression contract from Task #369: pre-fix, the
    // SQL count and the visible row set could disagree because past-
    // deadline rows were filtered client-side after the count ran.
    assert.equal(json.total, ids.length,
      `total=${json.total} disagrees with groups.length=${ids.length} (past-deadline rows must be excluded from BOTH)`);
    // Past-deadline rows must be absent.
    assert.ok(!ids.includes(pastNew1), `default list unexpectedly includes past-deadline New (id=${pastNew1})`);
    assert.ok(!ids.includes(pastNew2), `default list unexpectedly includes past-deadline New (id=${pastNew2})`);
    assert.ok(!ids.includes(pastStuck), `default list unexpectedly includes past-deadline Portal Queued (id=${pastStuck})`);
    // On-deadline rows must be present.
    assert.ok(ids.includes(ok1), `default list missing on-deadline New (id=${ok1})`);
    assert.ok(ids.includes(ok2), `default list missing on-deadline Needs Evidence (id=${ok2})`);
  }

  // (b1) `?expiring=urgent` is strict-today (deadline EXACTLY today,
  // after the weekend → Friday shift). Past-due actionable rows are
  // NOT urgent — they belong to the explicit `?includeExpired=true`
  // opt-in tier — so the SQL filter must exclude them just like the
  // dashboard's `urgentCount` scalar does. This locks the alignment
  // with `isUrgentDeadline` (lib/dates.ts) so the "Must file today"
  // filter chip can never out-count the dashboard hero. Strict-today
  // urgency cannot fire on Sat/Sun (the office-closure shift always
  // pulls weekend deadlines back to Friday), so we add the today-
  // urgent fixture only on weekdays and assert its membership only
  // when seeded.
  const urgentTodaySD = ymdServiceDateUrgentToday();
  const urgentToday = urgentTodaySD == null
    ? null
    : await seedGroup({ status: "New", serviceDate: urgentTodaySD, label: "urgent-today" });
  {
    const { status, json } = await getJson(`/api/invoice-groups?search=${TAG}&expiring=urgent&limit=500`);
    assert.equal(status, 200, `urgent list HTTP ${status}: ${JSON.stringify(json).slice(0, 300)}`);
    const ids = (json.groups as Array<{ id: number }>).map(g => g.id);
    assert.equal(json.total, ids.length, `urgent: total=${json.total} != groups.length=${ids.length}`);
    // Past-due rows must NOT appear — strict-today semantics.
    assert.ok(!ids.includes(pastNew1), `?expiring=urgent unexpectedly includes past-deadline New (id=${pastNew1}) — strict-today filter must exclude past-due`);
    assert.ok(!ids.includes(pastNew2), `?expiring=urgent unexpectedly includes past-deadline New (id=${pastNew2}) — strict-today filter must exclude past-due`);
    assert.ok(!ids.includes(pastStuck), `?expiring=urgent unexpectedly includes Portal Queued (id=${pastStuck}) — wrong status set`);
    assert.ok(!ids.includes(ok1), `?expiring=urgent unexpectedly includes future-deadline (id=${ok1})`);
    assert.ok(!ids.includes(ok2), `?expiring=urgent unexpectedly includes future-deadline (id=${ok2})`);
    if (urgentToday != null) {
      assert.ok(ids.includes(urgentToday), `?expiring=urgent missing strict-today fixture (id=${urgentToday})`);
    }
  }

  // (b2) `?expiring=stuck` bypasses the past-deadline guard for the
  // Portal Queued status set.
  {
    const { status, json } = await getJson(`/api/invoice-groups?search=${TAG}&expiring=stuck&limit=500`);
    assert.equal(status, 200, `stuck list HTTP ${status}: ${JSON.stringify(json).slice(0, 300)}`);
    const ids = (json.groups as Array<{ id: number }>).map(g => g.id);
    assert.equal(json.total, ids.length, `stuck: total=${json.total} != groups.length=${ids.length}`);
    assert.ok(ids.includes(pastStuck), `?expiring=stuck missing past-deadline Portal Queued (id=${pastStuck})`);
    assert.ok(!ids.includes(pastNew1), `?expiring=stuck unexpectedly includes New (id=${pastNew1}) — wrong status set`);
    assert.ok(!ids.includes(ok1), `?expiring=stuck unexpectedly includes future-deadline (id=${ok1})`);
  }

  // (c) `?includeExpired=true` is the explicit opt-in: every seeded
  // row (on- AND past-deadline, every status) must appear, and the
  // count must still equal the visible row set.
  {
    const { status, json } = await getJson(`/api/invoice-groups?search=${TAG}&includeExpired=true&limit=500`);
    assert.equal(status, 200, `includeExpired list HTTP ${status}: ${JSON.stringify(json).slice(0, 300)}`);
    const ids = (json.groups as Array<{ id: number }>).map(g => g.id);
    assert.equal(json.total, ids.length, `includeExpired: total=${json.total} != groups.length=${ids.length}`);
    const expected = [ok1, ok2, pastNew1, pastNew2, pastStuck];
    if (urgentToday != null) expected.push(urgentToday);
    for (const id of expected) {
      assert.ok(ids.includes(id), `?includeExpired=true missing seeded id=${id}`);
    }
  }
});

test("claims: total matches visible rows after past-deadline filter move", async () => {
  const ok1 = await seedClaim({ status: "New", date: ymdDaysAgo(5), label: "ok1" });
  const ok2 = await seedClaim({ status: "Needs Evidence", date: ymdDaysAgo(10), label: "ok2" });
  const pastNew1 = await seedClaim({ status: "New", date: ymdDaysAgo(60), label: "past-new-1" });
  const pastNew2 = await seedClaim({ status: "New", date: ymdDaysAgo(120), label: "past-new-2" });
  // Past-deadline post-submit rows for the `stuck` branch. Both
  // Portal Queued and Processed are in CLAIM_SUBMITTED_STUCK_STATUSES.
  const pastStuckQueued = await seedClaim({ status: "Portal Queued", date: ymdDaysAgo(90), label: "past-stuck-q" });
  const pastStuckProcessed = await seedClaim({ status: "Processed", date: ymdDaysAgo(90), label: "past-stuck-p" });

  // (a) default list.
  {
    const { status, json } = await getJson(`/api/claims?search=${TAG}&limit=500`);
    assert.equal(status, 200, `default list HTTP ${status}: ${JSON.stringify(json).slice(0, 300)}`);
    const ids = (json.claims as Array<{ id: number }>).map(c => c.id);
    assert.equal(json.total, ids.length,
      `claims default: total=${json.total} disagrees with claims.length=${ids.length}`);
    for (const id of [pastNew1, pastNew2, pastStuckQueued, pastStuckProcessed]) {
      assert.ok(!ids.includes(id), `claims default unexpectedly includes past-deadline id=${id}`);
    }
    for (const id of [ok1, ok2]) {
      assert.ok(ids.includes(id), `claims default missing on-deadline id=${id}`);
    }
  }

  // (b1) urgent — strict-today (deadline EXACTLY today, after the
  // weekend → Friday shift). Past-due actionable rows are NOT urgent —
  // they belong to the explicit `?includeExpired=true` opt-in tier —
  // so the SQL filter must exclude them just like the dashboard's
  // `urgentCount` scalar does. Locks the alignment with
  // `isUrgentDeadline` (lib/dates.ts) so the "Must file today"
  // filter chip on the claims list can never out-count the dashboard
  // hero. Strict-today urgency cannot fire on Sat/Sun (the office-
  // closure shift always pulls weekend deadlines back to Friday), so
  // the today fixture is added only on weekdays and asserted only
  // when seeded.
  const urgentTodaySD = ymdServiceDateUrgentToday();
  const urgentToday = urgentTodaySD == null
    ? null
    : await seedClaim({ status: "New", date: urgentTodaySD, label: "urgent-today" });
  {
    const { status, json } = await getJson(`/api/claims?search=${TAG}&expiring=urgent&limit=500`);
    assert.equal(status, 200, `urgent list HTTP ${status}: ${JSON.stringify(json).slice(0, 300)}`);
    const ids = (json.claims as Array<{ id: number }>).map(c => c.id);
    assert.equal(json.total, ids.length, `claims urgent: total=${json.total} != claims.length=${ids.length}`);
    for (const id of [pastNew1, pastNew2, pastStuckQueued, pastStuckProcessed]) {
      assert.ok(!ids.includes(id), `?expiring=urgent unexpectedly includes past-deadline id=${id} — strict-today filter must exclude past-due`);
    }
    for (const id of [ok1, ok2]) {
      assert.ok(!ids.includes(id), `?expiring=urgent unexpectedly includes future-deadline id=${id}`);
    }
    if (urgentToday != null) {
      assert.ok(ids.includes(urgentToday), `?expiring=urgent missing strict-today fixture (id=${urgentToday})`);
    }
  }

  // (b2) stuck — only Portal Queued / Processed.
  {
    const { status, json } = await getJson(`/api/claims?search=${TAG}&expiring=stuck&limit=500`);
    assert.equal(status, 200, `stuck list HTTP ${status}: ${JSON.stringify(json).slice(0, 300)}`);
    const ids = (json.claims as Array<{ id: number }>).map(c => c.id);
    assert.equal(json.total, ids.length, `claims stuck: total=${json.total} != claims.length=${ids.length}`);
    assert.ok(ids.includes(pastStuckQueued), `?expiring=stuck missing past-deadline Portal Queued (id=${pastStuckQueued})`);
    assert.ok(ids.includes(pastStuckProcessed), `?expiring=stuck missing past-deadline Processed (id=${pastStuckProcessed})`);
    for (const id of [pastNew1, pastNew2]) {
      assert.ok(!ids.includes(id), `?expiring=stuck unexpectedly includes pre-submit past-deadline id=${id}`);
    }
    for (const id of [ok1, ok2]) {
      assert.ok(!ids.includes(id), `?expiring=stuck unexpectedly includes future-deadline id=${id}`);
    }
  }

  // (c) includeExpired — everything must appear, total must agree.
  {
    const { status, json } = await getJson(`/api/claims?search=${TAG}&includeExpired=true&limit=500`);
    assert.equal(status, 200, `includeExpired list HTTP ${status}: ${JSON.stringify(json).slice(0, 300)}`);
    const ids = (json.claims as Array<{ id: number }>).map(c => c.id);
    assert.equal(json.total, ids.length, `claims includeExpired: total=${json.total} != claims.length=${ids.length}`);
    const expected = [ok1, ok2, pastNew1, pastNew2, pastStuckQueued, pastStuckProcessed];
    if (urgentToday != null) expected.push(urgentToday);
    for (const id of expected) {
      assert.ok(ids.includes(id), `?includeExpired=true missing seeded id=${id}`);
    }
  }
});
