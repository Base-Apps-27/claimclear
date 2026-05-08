// Task #541 — Classification Inbox urgency parity contract.
//
// Sibling of `must-file-today-parity.test.ts`. The cohesion audit
// (Tasks #350/#356/#358) collapsed the dashboard "must file today"
// hero, the `?expiring=urgent` list endpoint, and the urgent-snapshot
// computation onto a single source of truth. Task #541 EXTENDED that
// source of truth so unclassified Classification Inbox groups whose
// effective deadline lands today are surfaced even when their parent
// group's `phase` has advanced past `ready_to_submit` — without that
// expansion an unclassified Needs-Review row could deadline today and
// never appear in the dashboard hero (the operator-attention bug
// the celebration sweep was scoped to fix).
//
// Three surfaces must continue to agree on the new urgent set:
//
//   1. GET /api/dashboard/summary           → `urgentCount` + `expiringGroups[]`
//   2. GET /api/invoice-groups?expiring=urgent
//   3. computeUrgentSnapshot()
//
// This test seeds an unclassified group whose phase is post-submit
// (`response_received` → status `Needs Review`) with a today-deadline
// service date and asserts every surface includes it. A control
// fixture (post-submit, classified, today-deadline) asserts the
// expansion didn't accidentally widen the cohort to ALL post-submit
// rows — only the unclassified ones.

import { test, before, after } from "node:test";
import { strict as assert } from "node:assert";
import http from "node:http";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import { inArray, sql } from "drizzle-orm";

import dashboardRouter from "../routes/dashboard";
import invoiceGroupsRouter from "../routes/invoice-groups";
import { computeUrgentSnapshot } from "../lib/urgent-snapshot";
import { isUrgentDeadline } from "../lib/dates";
import {
  db,
  pool,
  invoiceGroupsTable,
  auditLogsTable,
} from "@workspace/db";

let server: http.Server;
let baseUrl: string;
const seededGroupIds: number[] = [];

const TEST_USER = { email: "operator-attention-parity@example.com", displayName: "Op Attention Tester" };

before(async () => {
  const app: Express = express();
  app.use(express.json());
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

function ymdDaysAgo(days: number): string {
  const ms = Date.now() - days * 24 * 60 * 60 * 1000;
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Pick a service-date string for which BOTH the JS `isUrgentDeadline`
 * helper AND the SQL `(deadline - CURRENT_DATE) = 0` predicate agree
 * the row should be urgent. Necessary because the JS helper anchors to
 * America/New_York while the DB session's CURRENT_DATE is read in the
 * pool's timezone (typically UTC) — during the few-hour window where
 * the two calendars disagree (late-evening ET → early-morning UTC),
 * the obvious "today − 28 days" picks fail in one or the other. We
 * iterate candidates and let the DB tell us which one lands on today.
 * Returns null if none of the candidates work (e.g. the office-closure
 * weekend shift collapses today's deadline pool).
 */
async function pickUrgentTodayServiceDate(): Promise<string | null> {
  const now = new Date();
  for (let n = 27; n <= 36; n++) {
    const candidate = ymdDaysAgo(n);
    if (!isUrgentDeadline(candidate, now)) continue;
    const r = await db.execute(sql`select (
      case extract(dow from (${candidate}::date + interval '30 days'))
        when 6 then ((${candidate}::date + interval '30 days')::date - interval '1 day')::date
        when 0 then ((${candidate}::date + interval '30 days')::date - interval '2 days')::date
        else (${candidate}::date + interval '30 days')::date
      end) - current_date as diff`);
    const diff = (r.rows?.[0] as { diff?: number } | undefined)?.diff;
    if (diff === 0) return candidate;
  }
  return null;
}

test("dashboard / list / snapshot agree that an unclassified post-submit group with a today deadline is urgent", async (t) => {
  const urgentTodaySD = await pickUrgentTodayServiceDate();
  if (urgentTodaySD == null) {
    t.skip("strict-today urgency cannot fire on Sat/Sun (deadlines shift back to Fri)");
    return;
  }

  // Seed: unclassified (errorTypeId NULL) in phase=`reviewed` — the
  // post-`ready_to_submit` window where the operator still owes
  // action (`reviewed` is NOT in OPERATOR_DONE_PHASES). Pre-#541
  // urgency only fired for `phase IN (triage, ready_to_submit)`,
  // so this row would have been silently dropped from every urgent
  // surface despite a today-deadline; #541 added the
  // `(unclassified AND needs_operator_attention)` branch so the
  // Classification Inbox cohort surfaces uniformly.
  const [unclassifiedNeedsReview] = await db.insert(invoiceGroupsTable).values({
    invoiceNumber: `T541-unclass-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    clientNumber: "OP-ATTN-CLIENT",
    status: "Needs Review",
    outcome: "Pending",
    phase: "reviewed",
    totalAmount: "100.00",
    serviceDate: urgentTodaySD,
    errorTypeId: null as unknown as string,
  }).returning();
  seededGroupIds.push(unclassifiedNeedsReview.id);

  // Control: classified post-submit row with the SAME today-deadline.
  // The expansion is scoped to UNCLASSIFIED rows only; if a classified
  // post-submit row sneaks in, the expansion is too wide.
  const [classifiedNeedsReview] = await db.insert(invoiceGroupsTable).values({
    invoiceNumber: `T541-class-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    clientNumber: "OP-ATTN-CLIENT",
    status: "Needs Review",
    outcome: "Pending",
    phase: "reviewed",
    totalAmount: "100.00",
    serviceDate: urgentTodaySD,
    errorTypeId: "et-control",
    errorTypeName: "Control Type",
  }).returning();
  seededGroupIds.push(classifiedNeedsReview.id);

  // (A "Control 2" fixture for the operator-done branch — unclassified
  // but Withdrawn — is intentionally omitted: the disposition trigger
  // requires phase=closed paired with outcome=Withdrawn, and inserting
  // a closed-phase row with default-disposition child claims fights the
  // schema validators. The badge-gating test file covers the operator-
  // done exclusion at the group level via Resolved/Withdrawn + phase=
  // closed without child claims.)

  const summaryResp = await getJson("/api/dashboard/summary");
  const listResp = await getJson("/api/invoice-groups?expiring=urgent&search=OP-ATTN-CLIENT&limit=500");
  const snap = await computeUrgentSnapshot();
  assert.equal(summaryResp.status, 200, `dashboard summary HTTP ${summaryResp.status}`);
  assert.equal(listResp.status, 200, `invoice-groups list HTTP ${listResp.status}`);

  const summaryGroups: Array<{ id: number; isUrgent?: boolean }> = (summaryResp.json.expiringGroups ?? [])
    .filter((g: { isUrgent?: boolean }) => g.isUrgent === true);
  const listBody = listResp.json as { groups?: Array<{ id: number }>; data?: Array<{ id: number }> };
  const listGroups: Array<{ id: number }> = listBody.groups ?? listBody.data ?? [];

  const summaryIds = new Set(summaryGroups.map((g) => g.id));
  const listIds = new Set(listGroups.map((g) => g.id));
  const snapshotIds = new Set(snap.urgentGroupIds);

  // Unclassified post-submit row MUST appear on every surface.
  assert.ok(summaryIds.has(unclassifiedNeedsReview.id),
    `dashboard summary missing unclassified-needs-review urgent fixture (id=${unclassifiedNeedsReview.id})`);
  assert.ok(listIds.has(unclassifiedNeedsReview.id),
    `invoice-groups?expiring=urgent missing unclassified-needs-review fixture (id=${unclassifiedNeedsReview.id})`);
  assert.ok(snapshotIds.has(unclassifiedNeedsReview.id),
    `urgent-snapshot missing unclassified-needs-review fixture (id=${unclassifiedNeedsReview.id})`);

  // Classified post-submit row MUST NOT appear (expansion is scoped to
  // unclassified only — phase advancement past ready_to_submit still
  // closes the urgency window for groups that already have an Error
  // Type assigned).
  assert.ok(!summaryIds.has(classifiedNeedsReview.id),
    `dashboard summary unexpectedly includes classified post-submit row (id=${classifiedNeedsReview.id})`);
  assert.ok(!listIds.has(classifiedNeedsReview.id),
    `invoice-groups?expiring=urgent unexpectedly includes classified post-submit row (id=${classifiedNeedsReview.id})`);
  assert.ok(!snapshotIds.has(classifiedNeedsReview.id),
    `urgent-snapshot unexpectedly includes classified post-submit row (id=${classifiedNeedsReview.id})`);

  // Three-surface parity restricted to our seeded fixtures (the test
  // DB contains many other urgent rows from other test runs / seed
  // data; pagination + scoping keep the comparison deterministic).
  // The `must-file-today-parity.test.ts` sibling locks the global
  // contract; this assertion confirms the new unclassified branch
  // joins all three sets together.
  const seededIds = new Set(seededGroupIds);
  const intersect = (s: Set<number>): number[] =>
    [...s].filter((id) => seededIds.has(id)).sort((a, b) => a - b);
  assert.deepEqual(intersect(snapshotIds), intersect(summaryIds),
    "computeUrgentSnapshot and dashboard.expiringGroups disagree on the seeded fixtures");
  assert.deepEqual(intersect(snapshotIds), intersect(listIds),
    "computeUrgentSnapshot and invoice-groups?expiring=urgent disagree on the seeded fixtures");
});
