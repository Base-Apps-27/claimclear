// Coverage for the "File today" hardening (Task #298):
//   • computeUrgentSnapshot returns the urgent count + status breakdown
//     for the actionable invoice-groups visible at "now".
//   • GET /dashboard/urgent-today/transitions surfaces both the still-
//     urgent rows and the today-cleared activity, and pulls back the
//     last hour's `dashboard_urgent_snapshot` rows for the sparkline.
//
// The tests boot a real Express server and seed real DB rows so the
// JSON response shape is locked in end-to-end.

import { test, before, after } from "node:test";
import { strict as assert } from "node:assert";
import http from "node:http";
import express, { type Express } from "express";
import { eq, inArray } from "drizzle-orm";

import dashboardRouter, { etMidnightUtcInstant } from "../routes/dashboard";
import { computeUrgentSnapshot } from "../lib/urgent-snapshot";
import { addDaysToYMD, isUrgentDeadline, serverTodayKey } from "../lib/dates";
import {
  db,
  pool,
  claimsTable,
  invoiceGroupsTable,
  auditLogsTable,
  stateEventsTable,
} from "@workspace/db";

let server: http.Server;
let baseUrl: string;
const seededClaimIds: number[] = [];
const seededGroupIds: number[] = [];
const seededAuditIds: number[] = [];
const seededStateEventIds: bigint[] = [];

before(async () => {
  const app: Express = express();
  app.use(express.json());
  app.use("/api", dashboardRouter);

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
  if (seededAuditIds.length) {
    await db.delete(auditLogsTable).where(inArray(auditLogsTable.id, seededAuditIds)).catch(() => undefined);
  }
  if (seededStateEventIds.length) {
    await db.delete(stateEventsTable).where(inArray(stateEventsTable.id, seededStateEventIds)).catch(() => undefined);
  }
  if (seededClaimIds.length) {
    await db.delete(claimsTable).where(inArray(claimsTable.id, seededClaimIds)).catch(() => undefined);
  }
  if (seededGroupIds.length) {
    await db.delete(invoiceGroupsTable).where(inArray(invoiceGroupsTable.id, seededGroupIds)).catch(() => undefined);
  }
  server.closeAllConnections?.();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end().catch(() => undefined);
});

interface SeedGroupOpts {
  status: "New" | "Needs Evidence" | "On Hold" | "Generating Email" | "Portal Queued" | "Awaiting Response";
  // Days ago for the earliest claim's service date. With strict-today
  // urgency (see `isUrgentDeadline`), 30 means the row is urgent
  // exactly today on weekdays. Weekends shift the effective deadline
  // back to Friday — pass `urgentToday: true` to let the helper pick a
  // value that lands the effective deadline on today no matter what
  // weekday it's run.
  serviceDaysAgo?: number;
  /**
   * When true, ignores `serviceDaysAgo` and computes the service date
   * such that {@link isUrgentDeadline} returns true today. Falls back
   * to `today - 30` when no candidate matches (e.g. weekend runs where
   * no service date can produce a "today" effective deadline) so the
   * caller can still observe the seeded row even if the urgency
   * assertion has to be skipped at the test layer.
   */
  urgentToday?: boolean;
  invoiceNumber?: string;
  clientNumber?: string;
}

/**
 * Pick a YYYY-MM-DD service date whose 30-day deadline (after the
 * weekend → Friday shift) lands on today. Returns null on Sat/Sun
 * runs, where no service date can produce a "today" deadline because
 * the shift always pulls weekend deadlines back to Friday.
 */
export function pickServiceDateUrgentToday(now: Date = new Date()): string | null {
  const todayKey = serverTodayKey(now);
  for (let n = 28; n <= 34; n++) {
    const candidate = addDaysToYMD(todayKey, -n);
    if (isUrgentDeadline(candidate, now)) return candidate;
  }
  return null;
}

async function seedUrgentGroup(opts: SeedGroupOpts): Promise<{ groupId: number; claimId: number }> {
  const tag = `T298-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const [group] = await db.insert(invoiceGroupsTable).values({
    invoiceNumber: opts.invoiceNumber ?? tag,
    clientNumber: opts.clientNumber ?? "TEST-CLIENT",
    status: opts.status,
    outcome: "Pending",
    totalAmount: "100.00",
  }).returning();
  seededGroupIds.push(group.id);

  // Build a YYYY-MM-DD `serviceDaysAgo` calendar days back from today.
  // Calendar arithmetic, not timestamp arithmetic — matches the rest
  // of the deadline math. When `urgentToday` is set we delegate to
  // the picker so the seeded row lands a deadline on today under the
  // strict-equality semantics in `isUrgentDeadline` (regardless of the
  // weekday the test runs on).
  const now = new Date();
  let ymd: string;
  if (opts.urgentToday) {
    ymd = pickServiceDateUrgentToday(now) ?? addDaysToYMD(serverTodayKey(now), -30);
  } else {
    const days = opts.serviceDaysAgo ?? 30;
    const ms = now.getTime() - days * 24 * 60 * 60 * 1000;
    ymd = new Date(ms).toISOString().slice(0, 10);
  }

  const [claim] = await db.insert(claimsTable).values({
    confNumber: `${tag}-C`,
    status: opts.status,
    outcome: "Pending",
    invoiceGroupId: group.id,
    date: ymd,
  }).returning();
  seededClaimIds.push(claim.id);

  return { groupId: group.id, claimId: claim.id };
}

async function fetchTransitions(): Promise<{ status: number; json: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: "127.0.0.1", port: Number(new URL(baseUrl).port), path: "/api/dashboard/urgent-today/transitions", method: "GET" },
      (res) => {
        let raw = "";
        res.setEncoding("utf8");
        res.on("data", (c) => { raw += c; });
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode ?? 0, json: raw ? JSON.parse(raw) : {} });
          } catch (e) { reject(e); }
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

// =====================================================================
// computeUrgentSnapshot
// =====================================================================

test("computeUrgentSnapshot counts a today-deadline New group as urgent", async (t) => {
  // Strict-today urgency means "no urgent rows possible on weekends" —
  // the office is closed and the effective-deadline shift pulls every
  // raw deadline back to Friday. Skip on Sat/Sun rather than seed a
  // row we know cannot trip the predicate.
  if (pickServiceDateUrgentToday() == null) {
    t.skip("strict-today urgency cannot fire on Sat/Sun (deadlines shift back to Fri)");
    return;
  }
  const { groupId } = await seedUrgentGroup({ status: "New", urgentToday: true });
  const snap = await computeUrgentSnapshot();
  assert.ok(snap.urgentGroupIds.includes(groupId), `expected snapshot to include the seeded urgent group ${groupId}; got ${snap.urgentGroupIds.join(",")}`);
  assert.ok(snap.urgentCount >= 1);
  assert.ok((snap.byStatus["New"] ?? 0) >= 1, "byStatus should bucket the urgent New group");
  assert.match(snap.todayKey, /^\d{4}-\d{2}-\d{2}$/, "todayKey must be YYYY-MM-DD");
});

test("computeUrgentSnapshot ignores a Portal Queued group even with an old service date", async () => {
  // Portal Queued is post-submit — the filing clock is satisfied even
  // if the raw deadline has passed, so it must not be counted urgent.
  const { groupId } = await seedUrgentGroup({ status: "Portal Queued", serviceDaysAgo: 60 });
  const snap = await computeUrgentSnapshot();
  assert.equal(snap.urgentGroupIds.includes(groupId), false, "Portal Queued must not be in the urgent set");
});

// =====================================================================
// GET /dashboard/urgent-today/transitions
// =====================================================================

test("GET /dashboard/urgent-today/transitions returns the contract shape", async () => {
  const res = await fetchTransitions();
  assert.equal(res.status, 200);
  const body = res.json as {
    today: string;
    urgentCount: number;
    totalActionable: number;
    byStatus: Record<string, number>;
    currentlyUrgent: unknown[];
    clearedToday: unknown[];
    clearedSummary: { total: number; byToStatus: Record<string, number>; actors: string[] };
    snapshots: unknown[];
  };
  assert.match(body.today, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(typeof body.urgentCount, "number");
  assert.equal(typeof body.totalActionable, "number");
  assert.ok(typeof body.byStatus === "object" && body.byStatus !== null);
  assert.ok(Array.isArray(body.currentlyUrgent));
  assert.ok(Array.isArray(body.clearedToday));
  assert.ok(Array.isArray(body.snapshots));
  assert.ok(typeof body.clearedSummary === "object");
  assert.equal(typeof body.clearedSummary.total, "number");
});

test("GET /dashboard/urgent-today/transitions: clearedToday includes a today's New→Portal Queued audit row", async (t) => {
  if (pickServiceDateUrgentToday() == null) {
    t.skip("strict-today urgency cannot fire on Sat/Sun (deadlines shift back to Fri)");
    return;
  }
  // Seed a group that was urgent and then a status_change audit row
  // showing it left the actionable set today.
  const { groupId } = await seedUrgentGroup({ status: "Portal Queued", urgentToday: true });
  const [audit] = await db.insert(auditLogsTable).values({
    invoiceGroupId: groupId,
    action: "group_status_changed",
    details: "Status changed from New to Portal Queued",
    metadata: { from: "New", to: "Portal Queued", source: "operator", reason: "filed" },
    userName: "Test Operator",
    userEmail: "tester@example.com",
  }).returning({ id: auditLogsTable.id });
  seededAuditIds.push(audit.id);

  const res = await fetchTransitions();
  assert.equal(res.status, 200);
  const body = res.json as {
    clearedToday: { invoiceGroupId: number; fromStatus: string; toStatus: string; actor: string | null }[];
    clearedSummary: { total: number; byToStatus: Record<string, number>; actors: string[] };
  };
  const matching = body.clearedToday.find(r => r.invoiceGroupId === groupId);
  assert.ok(matching, `expected clearedToday to include groupId ${groupId}`);
  assert.equal(matching.fromStatus, "New");
  assert.equal(matching.toStatus, "Portal Queued");
  assert.equal(matching.actor, "Test Operator");
  assert.ok((body.clearedSummary.byToStatus["Portal Queued"] ?? 0) >= 1);
  assert.ok(body.clearedSummary.actors.includes("Test Operator"));
});

test("GET /dashboard/urgent-today/transitions: re-categorisation (New→Needs Evidence) does NOT count as cleared", async () => {
  const { groupId } = await seedUrgentGroup({ status: "Needs Evidence", serviceDaysAgo: 35 });
  const [audit] = await db.insert(auditLogsTable).values({
    invoiceGroupId: groupId,
    action: "group_status_changed",
    details: "Status changed from New to Needs Evidence",
    metadata: { from: "New", to: "Needs Evidence", source: "operator", reason: "needs evidence" },
    userName: "Test Operator 2",
    userEmail: "tester2@example.com",
  }).returning({ id: auditLogsTable.id });
  seededAuditIds.push(audit.id);

  const res = await fetchTransitions();
  const body = res.json as { clearedToday: { invoiceGroupId: number }[] };
  const matching = body.clearedToday.find(r => r.invoiceGroupId === groupId);
  assert.equal(matching, undefined, "intra-actionable transitions must not count as cleared filing-clock work");
});

test("GET /dashboard/urgent-today/transitions: snapshots reflect a freshly written state_event", async () => {
  // Drop a snapshot row directly so we don't depend on cron timing.
  const [evt] = await db.insert(stateEventsTable).values({
    eventKey: "dashboard_urgent_snapshot",
    metadata: { urgentCount: 7, totalActionable: 12, todayKey: "TEST", byStatus: { New: 7 } },
  }).returning({ id: stateEventsTable.id });
  seededStateEventIds.push(evt.id);

  const res = await fetchTransitions();
  const body = res.json as { snapshots: { urgentCount: number; totalActionable: number }[] };
  // The endpoint returns ALL snapshots that fall in the ET day window;
  // we just need to confirm at least one row matches our test value.
  const found = body.snapshots.find(s => s.urgentCount === 7 && s.totalActionable === 12);
  assert.ok(found, `expected snapshots to include the freshly written urgent_snapshot row; got ${JSON.stringify(body.snapshots)}`);
});

// =====================================================================
// Review-driven hardening (Task #298 round 2)
// =====================================================================

test("clearedToday EXCLUDES groups whose earliest service date isn't urgent today", async () => {
  // 5-day-old service date → effectiveDaysRemaining ≈ 25 days. Even
  // though we audit a New→Closed transition today, the group was
  // never on the file-today clock and must be filtered out.
  const { groupId } = await seedUrgentGroup({ status: "Portal Queued", serviceDaysAgo: 5 });
  const [audit] = await db.insert(auditLogsTable).values({
    invoiceGroupId: groupId,
    action: "group_status_changed",
    details: "Status changed from New to Portal Queued",
    metadata: { from: "New", to: "Portal Queued", source: "operator", reason: "early submit" },
    userName: "Eager Beaver",
    userEmail: "eager@example.com",
  }).returning({ id: auditLogsTable.id });
  seededAuditIds.push(audit.id);

  const res = await fetchTransitions();
  const body = res.json as { clearedToday: { invoiceGroupId: number }[] };
  const matching = body.clearedToday.find(r => r.invoiceGroupId === groupId);
  assert.equal(
    matching,
    undefined,
    "non-urgent group's status change must NOT count as a 'cleared today' file-today win",
  );
});

test("clearedToday rows expose payor (clientNumber), source, reason, and ET timestamp", async (t) => {
  if (pickServiceDateUrgentToday() == null) {
    t.skip("strict-today urgency cannot fire on Sat/Sun (deadlines shift back to Fri)");
    return;
  }
  const { groupId } = await seedUrgentGroup({
    status: "Portal Queued",
    urgentToday: true,
    clientNumber: "PAYOR-298",
  });
  const [audit] = await db.insert(auditLogsTable).values({
    invoiceGroupId: groupId,
    action: "group_status_changed",
    details: "Status changed from New to Portal Queued",
    metadata: {
      from: "New",
      to: "Portal Queued",
      source: "auto-after-classify",
      reason: "classifier moved to portal",
    },
    userName: "Bot",
    userEmail: "bot@example.com",
  }).returning({ id: auditLogsTable.id });
  seededAuditIds.push(audit.id);

  const res = await fetchTransitions();
  const body = res.json as {
    clearedToday: {
      invoiceGroupId: number;
      clientNumber: string | null;
      source: string | null;
      reason: string | null;
      timestamp: string;
      timestampET: string;
    }[];
  };
  const row = body.clearedToday.find(r => r.invoiceGroupId === groupId);
  assert.ok(row, "expected the seeded cleared row to be present");
  assert.equal(row.clientNumber, "PAYOR-298", "payor must be surfaced from invoice_groups.client_number");
  assert.equal(row.source, "auto-after-classify");
  assert.equal(row.reason, "classifier moved to portal");
  assert.match(row.timestamp, /^\d{4}-\d{2}-\d{2}T/, "raw timestamp must be ISO");
  assert.match(row.timestampET, /\d{1,2}:\d{2}\s+(AM|PM)\s+ET/, "ET timestamp must be human-formatted");
});

test("response includes wasUrgentToday and maxUrgentToday for the UI suppression guard", async () => {
  const res = await fetchTransitions();
  const body = res.json as { wasUrgentToday: boolean; maxUrgentToday: number };
  assert.equal(typeof body.wasUrgentToday, "boolean");
  assert.equal(typeof body.maxUrgentToday, "number");
  assert.ok(body.maxUrgentToday >= 0);
  // The earlier seed-tests ensure the queue is non-empty, so on this
  // suite's shared DB we expect maxUrgentToday > 0 ⇒ wasUrgentToday true.
  if (body.maxUrgentToday > 0) {
    assert.equal(body.wasUrgentToday, true, "wasUrgentToday must be true whenever maxUrgentToday > 0");
  }
});

// ---------------------------------------------------------------------
// DST boundary: the ET-day window must use next-ET-midnight, NOT
// dayStart + 24h. On spring-forward the day is 23h long, on fall-back
// 25h. Verify both endpoints round-trip via `etMidnightUtcInstant`.
// ---------------------------------------------------------------------
test("DST: ET-day window endpoints are 23h on spring-forward and 25h on fall-back", () => {
  const HOUR = 60 * 60 * 1000;

  // Spring forward 2025: ET clocks jump from 02:00 to 03:00 on
  // 2025-03-09. Result: the ET calendar day 2025-03-09 is 23 hours
  // long in UTC.
  const springStart = etMidnightUtcInstant("2025-03-09");
  const springEnd = etMidnightUtcInstant(addDaysToYMD("2025-03-09", 1));
  const springSpanH = (springEnd.getTime() - springStart.getTime()) / HOUR;
  assert.equal(springSpanH, 23, `spring-forward ET day should be 23h, got ${springSpanH}h`);

  // Fall back 2025: ET clocks roll from 02:00 back to 01:00 on
  // 2025-11-02. Result: that ET calendar day is 25 hours long.
  const fallStart = etMidnightUtcInstant("2025-11-02");
  const fallEnd = etMidnightUtcInstant(addDaysToYMD("2025-11-02", 1));
  const fallSpanH = (fallEnd.getTime() - fallStart.getTime()) / HOUR;
  assert.equal(fallSpanH, 25, `fall-back ET day should be 25h, got ${fallSpanH}h`);

  // Sanity: a non-DST day is exactly 24h.
  const normalStart = etMidnightUtcInstant("2025-06-15");
  const normalEnd = etMidnightUtcInstant(addDaysToYMD("2025-06-15", 1));
  const normalSpanH = (normalEnd.getTime() - normalStart.getTime()) / HOUR;
  assert.equal(normalSpanH, 24, `normal ET day should be 24h, got ${normalSpanH}h`);
});

// Type alias to satisfy `eq` import (used by future cleanup if needed).
const _eq = eq;
void _eq;
