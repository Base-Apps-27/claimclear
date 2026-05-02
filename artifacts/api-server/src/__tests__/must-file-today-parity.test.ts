// Task #358 — "Must file today" parity contract.
//
// The cohesion audit (Tasks #350/#351/#356/#357) collapsed three
// formerly-independent computations of "groups that must be filed
// today" onto a single source of truth: the typed, indexed
// `invoice_groups.service_date` column maintained by
// `recomputeGroupServiceDate`. Three surfaces consume that column:
//
//   1. GET /api/dashboard/summary           → `urgentCount` + `expiringGroups[]`
//   2. GET /api/invoice-groups?expiring=urgent → list of groups whose
//                                              effective deadline ≤ today
//   3. computeUrgentSnapshot()              → snapshot used by the cron
//                                              and by the dashboard hero
//
// Before the audit, each surface re-derived the deadline from a
// correlated `MIN(claims.date)` subquery with subtly different NULL
// handling, status filters, and weekend-shift wrappers — and they
// could disagree on edge cases ("M/D/YY", all-blank children,
// excluded-leg-only groups, NULL service_date). After the audit they
// must agree exactly. This test locks that contract: for any seeded
// fixture, the three surfaces must return the *same set* of urgent
// invoice-group IDs and the same urgent count.
//
// Bootstrap mirrors `urgent-today-transitions.test.ts`: a tiny express
// app with the dashboard and invoice-groups routers mounted, the dev
// DB pool, and per-test cleanup keyed on tagged invoice numbers so
// parallel tests can share the dev DB safely.

import { test, before, after } from "node:test";
import { strict as assert } from "node:assert";
import http from "node:http";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import { inArray } from "drizzle-orm";

import dashboardRouter from "../routes/dashboard";
import invoiceGroupsRouter from "../routes/invoice-groups";
import { computeUrgentSnapshot } from "../lib/urgent-snapshot";
import {
  db,
  pool,
  invoiceGroupsTable,
  auditLogsTable,
} from "@workspace/db";

let server: http.Server;
let baseUrl: string;
const seededGroupIds: number[] = [];

const TEST_USER = { email: "must-file-today-parity@example.com", displayName: "Parity Tester" };

before(async () => {
  const app: Express = express();
  app.use(express.json());
  // Stub the auth middleware so the secured invoice-groups router will
  // serve requests; mirrors the harness in typed-claims-date.test.ts.
  // requireAuth in production gates on `req.isAuthenticated()` AND the
  // user's status — supplying a "approved" user satisfies both.
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).user = { ...TEST_USER, status: "approved" };
    (req as any).isAuthenticated = () => true;
    (req as any).log = { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} };
    next();
  });
  app.use("/api", dashboardRouter);
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

// Calendar arithmetic (not timestamp): mirrors the rest of the deadline
// helpers and the seed pattern in urgent-today-transitions.test.ts.
function ymdDaysAgo(days: number): string {
  const ms = Date.now() - days * 24 * 60 * 60 * 1000;
  return new Date(ms).toISOString().slice(0, 10);
}

interface SeedOpts {
  status:
    | "New"
    | "Needs Evidence"
    | "On Hold"
    | "Generating Email"
    | "Portal Queued"
    | "Awaiting Response"
    | "Resolved";
  // The claim_outcome enum (lib/db/src/schema/claims.ts) is the
  // shared outcome enum reused by invoice_groups.outcome — its members
  // are Pending / Approved / Denied / Partially Approved / Non-Issue /
  // Withdrawn (no "Resolved"; Resolved is a *status*, not an outcome).
  // The seed always lands `outcome: "Pending"` because the parity
  // contract under test only depends on `status` + `service_date` —
  // none of the three surfaces consult `outcome` for the urgent set.
  // The value to write directly into invoice_groups.service_date. Pass
  // `null` to seed the "no claim has a usable date" case. Otherwise an
  // ISO YYYY-MM-DD string written verbatim — bypasses `recomputeGroup-
  // ServiceDate` so the test can exercise edge cases without leaning
  // on the importer's normaliser. The point of this test is the read-
  // path parity, not the write-path normaliser (which has its own unit
  // coverage in group-service-date.test.ts and typed-claims-date.test.ts).
  serviceDate: string | null;
  tag: string;
}

async function seedGroup(opts: SeedOpts): Promise<number> {
  const tag = `T358-${opts.tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const [group] = await db.insert(invoiceGroupsTable).values({
    invoiceNumber: tag,
    clientNumber: "PARITY-CLIENT",
    status: opts.status,
    outcome: "Pending",
    totalAmount: "100.00",
    serviceDate: opts.serviceDate ?? undefined,
  }).returning();
  // serviceDate may need a follow-up update if drizzle's typing rejects
  // null on the values literal — use a plain UPDATE for the null case
  // so the column lands as SQL NULL, not the column default.
  if (opts.serviceDate === null) {
    await db.update(invoiceGroupsTable)
      .set({ serviceDate: null as unknown as string })
      .where(inArray(invoiceGroupsTable.id, [group.id]));
  }
  seededGroupIds.push(group.id);
  return group.id;
}

// --- test ----------------------------------------------------------------

test("dashboard, invoice-groups list, and urgent-snapshot agree on the urgent group set", async () => {
  // Seed a battery of fixtures spanning every edge the cohesion audit
  // had to collapse onto one source of truth. Each fixture is labelled
  // with the contract it pins down, and we assert membership/non-
  // membership in the consensus set per fixture rather than asserting
  // a global cardinality (the dev DB may carry unrelated rows that
  // every surface should agree on; the parity contract is about
  // *agreement*, not absolute counts).

  // (a) actionable + clearly-old service date → MUST be urgent on all surfaces.
  const urgentNew = await seedGroup({
    status: "New",
    serviceDate: ymdDaysAgo(45),
    tag: "urgent-new",
  });

  // (b) actionable + service date that lands the deadline in the past
  // even after the weekend shift back to Friday → MUST be urgent.
  const urgentNeedsEvidence = await seedGroup({
    status: "Needs Evidence",
    serviceDate: ymdDaysAgo(60),
    tag: "urgent-needs-evidence",
  });

  // (c) actionable + service date that sits well inside the dispute
  // window (deadline ~25 days away) → MUST NOT be urgent.
  const futureNew = await seedGroup({
    status: "New",
    serviceDate: ymdDaysAgo(5),
    tag: "future-new",
  });

  // (d) actionable + NULL service_date → MUST NOT be urgent on any
  // surface (they all guard with `service_date IS NOT NULL`). Pre-
  // audit, the queue used to count this row as "deadline today"
  // because MIN(NULL) coalesced to today via a stale fallback.
  const nullDateActionable = await seedGroup({
    status: "New",
    serviceDate: null,
    tag: "null-date-actionable",
  });

  // (e) post-submit "Portal Queued" + ancient service date → urgent
  // dashboard/snapshot tier MUST exclude it (it belongs to the parallel
  // `submittedStuckGroups` tier surfaced separately in #352). The
  // invoice-groups list with `expiring=urgent` likewise excludes it.
  const portalQueuedAncient = await seedGroup({
    status: "Portal Queued",
    serviceDate: ymdDaysAgo(90),
    tag: "portal-queued-ancient",
  });

  // (f) Resolved + ancient service date → MUST NOT be urgent.
  // Closed-status filter on every surface.
  const resolvedAncient = await seedGroup({
    status: "Resolved",
    serviceDate: ymdDaysAgo(90),
    tag: "resolved-ancient",
  });

  // --- gather: hit every surface -----------------------------------------

  const [summaryResp, listResp, snap] = await Promise.all([
    getJson("/api/dashboard/summary"),
    getJson("/api/invoice-groups?expiring=urgent&limit=500"),
    computeUrgentSnapshot(),
  ]);

  assert.equal(summaryResp.status, 200, `dashboard summary HTTP ${summaryResp.status}: ${JSON.stringify(summaryResp.json).slice(0, 300)}`);
  assert.equal(listResp.status, 200, `invoice-groups list HTTP ${listResp.status}: ${JSON.stringify(listResp.json).slice(0, 300)}`);

  // Pull the three urgent ID sets from their respective response shapes.
  // The dashboard response carries `expiringGroups[]`; the invoice-
  // groups list returns `groups[]` (or `data[]` — guard for both). The
  // snapshot returns the raw ID array directly.
  const summaryGroups: Array<{ id: number }> = summaryResp.json.expiringGroups ?? [];
  const listBody = listResp.json as { groups?: Array<{ id: number }>; data?: Array<{ id: number }> };
  const listGroups: Array<{ id: number }> = listBody.groups ?? listBody.data ?? [];

  const summaryIds = new Set(summaryGroups.map((g) => g.id));
  const listIds = new Set(listGroups.map((g) => g.id));
  const snapshotIds = new Set(snap.urgentGroupIds);

  // (1) Per-fixture membership: each fixture is in or out of *all three*
  // sets the same way. Asserting per-fixture (rather than globally)
  // keeps the test resilient to unrelated dev-DB rows while still
  // proving the parity contract on every edge case we care about.
  const expectUrgent = [
    { id: urgentNew, label: "actionable + 45-day-old service_date" },
    { id: urgentNeedsEvidence, label: "actionable + 60-day-old service_date" },
  ];
  const expectNotUrgent = [
    { id: futureNew, label: "actionable + 5-day-old service_date (future deadline)" },
    { id: nullDateActionable, label: "actionable + NULL service_date" },
    { id: portalQueuedAncient, label: "Portal Queued (post-submit) + ancient service_date" },
    { id: resolvedAncient, label: "Resolved (closed) + ancient service_date" },
  ];

  for (const f of expectUrgent) {
    assert.ok(summaryIds.has(f.id), `dashboard summary missing urgent fixture ${f.label} (id=${f.id})`);
    assert.ok(listIds.has(f.id), `invoice-groups?expiring=urgent missing fixture ${f.label} (id=${f.id})`);
    assert.ok(snapshotIds.has(f.id), `computeUrgentSnapshot missing fixture ${f.label} (id=${f.id})`);
  }
  for (const f of expectNotUrgent) {
    assert.ok(!summaryIds.has(f.id), `dashboard summary unexpectedly urgent: ${f.label} (id=${f.id})`);
    assert.ok(!listIds.has(f.id), `invoice-groups?expiring=urgent unexpectedly includes: ${f.label} (id=${f.id})`);
    assert.ok(!snapshotIds.has(f.id), `computeUrgentSnapshot unexpectedly includes: ${f.label} (id=${f.id})`);
  }

  // (2) Global parity: across the *entire* response, the three sets
  // must be identical. This is the contract the cohesion audit was
  // closed to enforce: any divergence here means a future code change
  // re-introduced a parallel deadline computation.
  assert.deepEqual(
    [...snapshotIds].sort((a, b) => a - b),
    [...summaryIds].sort((a, b) => a - b),
    "computeUrgentSnapshot and dashboard.expiringGroups disagree on the urgent set",
  );
  assert.deepEqual(
    [...snapshotIds].sort((a, b) => a - b),
    [...listIds].sort((a, b) => a - b),
    "computeUrgentSnapshot and invoice-groups?expiring=urgent disagree on the urgent set",
  );

  // (3) The dashboard's scalar `urgentCount` must match the size of
  // its own `expiringGroups[]` AND the snapshot count. Pre-audit the
  // count was computed in a separate query that could drift from the
  // list when a row was excluded by the list's status filter but
  // counted by the count's looser filter.
  assert.equal(summaryResp.json.urgentCount, summaryIds.size,
    `dashboard.urgentCount=${summaryResp.json.urgentCount} disagrees with len(expiringGroups)=${summaryIds.size}`);
  assert.equal(summaryResp.json.urgentCount, snap.urgentCount,
    `dashboard.urgentCount=${summaryResp.json.urgentCount} disagrees with snapshot.urgentCount=${snap.urgentCount}`);
});
