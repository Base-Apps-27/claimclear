// Lock the contract that every client surface counts urgency the same
// way: `isUrgent === true`, no other filter, no fallback to
// `effectiveDaysLeft`. Pre-fix, the Dashboard counted
// `effectiveDaysLeft === 0` and silently zeroed out a backlog of
// past-due urgent rows, while the Queue (and the server) correctly
// counted the same backlog as urgent. The helpers under test funnel
// every surface through the same predicate so a future divergence is
// impossible without deleting these tests.

import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
  countUrgentRows,
  getUrgentGroupCountFromSummary,
  selectUrgentRows,
} from "./urgent-count";

test("countUrgentRows counts isUrgent across any number of lanes", () => {
  assert.equal(countUrgentRows(), 0);
  assert.equal(countUrgentRows([], []), 0);
  assert.equal(
    countUrgentRows(
      [{ isUrgent: true }, { isUrgent: false }],
      [{ isUrgent: true }],
      [{ isUrgent: null }, { isUrgent: undefined }, { isUrgent: true }],
    ),
    3,
  );
});

test("countUrgentRows includes past-due urgent rows (the regression that started Task #358)", () => {
  // Service date Mar 29, today May 2 → effectiveDaysLeft = -4 but
  // isUrgent = true. The pre-fix Dashboard filter `=== 0` would
  // miss every one of these; this helper must not.
  const lane = [
    { isUrgent: true, effectiveDaysLeft: -4 },
    { isUrgent: true, effectiveDaysLeft: -1 },
    { isUrgent: true, effectiveDaysLeft: 0 },
    { isUrgent: false, effectiveDaysLeft: 1 },
  ];
  assert.equal(countUrgentRows(lane), 3);
});

test("getUrgentGroupCountFromSummary prefers the server-stamped scalar", () => {
  // Even if the embedded array would compute differently (truncated
  // server-side payload, etc.), the scalar is authoritative.
  const summary = {
    urgentCount: 71,
    expiringGroups: [{ isUrgent: true }, { isUrgent: true }],
  };
  assert.equal(getUrgentGroupCountFromSummary(summary), 71);
});

test("getUrgentGroupCountFromSummary falls back to recounting when scalar is missing", () => {
  // Older server build that didn't stamp the scalar — we still want a
  // correct count, not a silent zero.
  const summary = {
    expiringGroups: [
      { isUrgent: true },
      { isUrgent: true },
      { isUrgent: false },
    ],
  };
  assert.equal(getUrgentGroupCountFromSummary(summary), 2);
});

test("getUrgentGroupCountFromSummary returns 0 for null/undefined/empty inputs", () => {
  assert.equal(getUrgentGroupCountFromSummary(null), 0);
  assert.equal(getUrgentGroupCountFromSummary(undefined), 0);
  assert.equal(getUrgentGroupCountFromSummary({}), 0);
  assert.equal(getUrgentGroupCountFromSummary({ expiringGroups: [] }), 0);
});

test("Dashboard ↔ Queue parity: same fixture → same count on both surfaces", () => {
  // The Dashboard reads the summary's urgentCount; the Queue counts
  // isUrgent across its loaded lanes. For any real dataset the
  // server stamps both consistently, so the two helpers must agree.
  const expiringGroups = [
    { id: 1, isUrgent: true, effectiveDaysLeft: -4, status: "New" },
    { id: 2, isUrgent: true, effectiveDaysLeft: -1, status: "Needs Evidence" },
    { id: 3, isUrgent: true, effectiveDaysLeft: 0, status: "Generating Email" },
    { id: 4, isUrgent: true, effectiveDaysLeft: 0, status: "On Hold" },
    { id: 5, isUrgent: false, effectiveDaysLeft: 2, status: "New" },
  ];
  const summary = { urgentCount: 4, expiringGroups };

  // Same rows distributed across the queue's on-clock lanes.
  const actionable = expiringGroups.filter(g =>
    ["New", "Needs Evidence", "Generating Email"].includes(g.status),
  );
  const onHold = expiringGroups.filter(g => g.status === "On Hold");
  const portalQueued: typeof expiringGroups = [];

  const dashboardCount = getUrgentGroupCountFromSummary(summary);
  const queueCount = countUrgentRows(actionable, portalQueued, onHold);

  assert.equal(dashboardCount, queueCount, "Dashboard and Queue must agree");
  assert.equal(dashboardCount, 4);
});

test("selectUrgentRows surfaces every urgent row, including past-due", () => {
  const rows = [
    { id: 1, isUrgent: true, effectiveDaysLeft: -4 },
    { id: 2, isUrgent: false, effectiveDaysLeft: 1 },
    { id: 3, isUrgent: true, effectiveDaysLeft: 0 },
  ];
  const selected = selectUrgentRows(rows);
  assert.deepEqual(selected.map(r => r.id), [1, 3]);
});

test("selectUrgentRows handles null/undefined input", () => {
  assert.deepEqual(selectUrgentRows(null), []);
  assert.deepEqual(selectUrgentRows(undefined), []);
  assert.deepEqual(selectUrgentRows([]), []);
});
