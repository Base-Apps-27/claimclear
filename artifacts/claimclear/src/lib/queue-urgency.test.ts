import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
  parseExpiringParam,
  matchesExpiringFilter,
  filterByExpiringParam,
  computeDeadlineTier,
  formatDeadlineLabel,
  formatTabBadge,
  addDays,
  formatShortMonthDay,
  computeAggregateUrgentCount,
  emptyStateCopy,
} from "./queue-urgency";

test("parseExpiringParam validates the URL token", () => {
  assert.equal(parseExpiringParam("urgent"), "urgent");
  assert.equal(parseExpiringParam("soon"), "soon");
  assert.equal(parseExpiringParam(""), null);
  assert.equal(parseExpiringParam(null), null);
  assert.equal(parseExpiringParam(undefined), null);
  assert.equal(parseExpiringParam("URGENT"), null, "case-sensitive: bogus tokens drop");
  assert.equal(parseExpiringParam("nope"), null);
});

test("matchesExpiringFilter — urgent matches isUrgent only", () => {
  assert.equal(matchesExpiringFilter({ isUrgent: true, effectiveDaysLeft: 0 }, "urgent"), true);
  assert.equal(matchesExpiringFilter({ isUrgent: false, effectiveDaysLeft: 0 }, "urgent"), false);
  assert.equal(matchesExpiringFilter({ isUrgent: false, effectiveDaysLeft: null }, "urgent"), false);
});

test("matchesExpiringFilter — soon matches 1..3 days, never urgent rows", () => {
  assert.equal(matchesExpiringFilter({ isUrgent: false, effectiveDaysLeft: 1 }, "soon"), true);
  assert.equal(matchesExpiringFilter({ isUrgent: false, effectiveDaysLeft: 3 }, "soon"), true);
  assert.equal(matchesExpiringFilter({ isUrgent: false, effectiveDaysLeft: 4 }, "soon"), false);
  assert.equal(matchesExpiringFilter({ isUrgent: false, effectiveDaysLeft: 0 }, "soon"), false);
  assert.equal(matchesExpiringFilter({ isUrgent: true, effectiveDaysLeft: 1 }, "soon"), false,
    "urgent rows are excluded from the soon set even if days fall in range");
  assert.equal(matchesExpiringFilter({ isUrgent: false, effectiveDaysLeft: null }, "soon"), false);
});

test("matchesExpiringFilter — null filter is a passthrough", () => {
  assert.equal(matchesExpiringFilter({ isUrgent: true, effectiveDaysLeft: 0 }, null), true);
  assert.equal(matchesExpiringFilter({ isUrgent: false, effectiveDaysLeft: 99 }, null), true);
});

test("filterByExpiringParam narrows arrays for both tones", () => {
  const rows = [
    { id: 1, isUrgent: true, effectiveDaysLeft: 0 },
    { id: 2, isUrgent: false, effectiveDaysLeft: 1 },
    { id: 3, isUrgent: false, effectiveDaysLeft: 5 },
    { id: 4, isUrgent: false, effectiveDaysLeft: null },
    { id: 5, isUrgent: true, effectiveDaysLeft: 2 },
  ];
  assert.deepEqual(filterByExpiringParam(rows, "urgent").map(r => r.id), [1, 5]);
  assert.deepEqual(filterByExpiringParam(rows, "soon").map(r => r.id), [2]);
  assert.deepEqual(filterByExpiringParam(rows, null).map(r => r.id), [1, 2, 3, 4, 5]);
});

test("computeDeadlineTier covers every on-clock row, including past a week", () => {
  // Urgent always wins over the days-based bucket so the row treatment stays consistent.
  assert.equal(computeDeadlineTier({ isUrgent: true, effectiveDaysLeft: 0 }), "today");
  assert.equal(computeDeadlineTier({ isUrgent: true, effectiveDaysLeft: -3 }), "today");
  assert.equal(computeDeadlineTier({ isUrgent: false, effectiveDaysLeft: -1 }), "overdue");
  assert.equal(computeDeadlineTier({ isUrgent: false, effectiveDaysLeft: 1 }), "soon");
  assert.equal(computeDeadlineTier({ isUrgent: false, effectiveDaysLeft: 2 }), "soon");
  assert.equal(computeDeadlineTier({ isUrgent: false, effectiveDaysLeft: 3 }), "week");
  assert.equal(computeDeadlineTier({ isUrgent: false, effectiveDaysLeft: 7 }), "week");
  assert.equal(
    computeDeadlineTier({ isUrgent: false, effectiveDaysLeft: 30 }),
    "later",
    "rows past a week still get a tier — fixes the silent-row bug from Task #274",
  );
  assert.equal(computeDeadlineTier({ isUrgent: false, effectiveDaysLeft: null }), null);
});

test("addDays + formatShortMonthDay produce the deadline-date stamp", () => {
  const base = new Date(2026, 4, 1); // 2026-05-01 local
  assert.equal(formatShortMonthDay(addDays(base, 0)), "5/1");
  assert.equal(formatShortMonthDay(addDays(base, 12)), "5/13");
  assert.equal(formatShortMonthDay(addDays(base, 31)), "6/1");
});

test("formatDeadlineLabel surfaces the date alongside the tier word", () => {
  const now = new Date(2026, 4, 1); // 2026-05-01

  const todayLbl = formatDeadlineLabel({ isUrgent: true, effectiveDaysLeft: 0 }, now);
  assert.equal(todayLbl?.tier, "today");
  assert.equal(todayLbl?.label, "Today · 5/1");

  const soonLbl = formatDeadlineLabel({ isUrgent: false, effectiveDaysLeft: 2 }, now);
  assert.equal(soonLbl?.tier, "soon");
  assert.equal(soonLbl?.label, "≤2d · 5/3");

  const weekLbl = formatDeadlineLabel({ isUrgent: false, effectiveDaysLeft: 7 }, now);
  assert.equal(weekLbl?.tier, "week");
  assert.equal(weekLbl?.label, "≤7d · 5/8");

  const laterLbl = formatDeadlineLabel({ isUrgent: false, effectiveDaysLeft: 12 }, now);
  assert.equal(laterLbl?.tier, "later");
  assert.equal(laterLbl?.label, "12d · 5/13");

  const overdueLbl = formatDeadlineLabel({ isUrgent: false, effectiveDaysLeft: -3 }, now);
  assert.equal(overdueLbl?.tier, "overdue");
  assert.ok(overdueLbl?.label.startsWith("Overdue"));

  assert.equal(formatDeadlineLabel({ isUrgent: false, effectiveDaysLeft: null }, now), null);
});

test("formatTabBadge — split shown when urgent items exist (no filter)", () => {
  assert.deepEqual(
    formatTabBadge(852, 62, null),
    { total: "852", urgent: "62 urgent", soon: null },
  );
});

test("formatTabBadge — urgent filter collapses to just the urgent count", () => {
  assert.deepEqual(
    formatTabBadge(852, 62, "urgent"),
    { total: null, urgent: "62", soon: null },
  );
});

test("formatTabBadge — soon filter shows soon count for the lane, never urgent", () => {
  // Critical: under the soon filter the visible rows are non-urgent by
  // definition, so showing an urgent split here would mismatch the rows
  // the operator sees. The badge reflects the filtered count instead.
  assert.deepEqual(
    formatTabBadge(852, 62, "soon", 28),
    { total: null, urgent: null, soon: "28" },
  );
});

test("formatTabBadge — soon filter with zero matches drops to nothing", () => {
  assert.deepEqual(
    formatTabBadge(852, 62, "soon", 0),
    { total: null, urgent: null, soon: null },
  );
});

test("formatTabBadge — falls back to plain total when nothing urgent", () => {
  assert.deepEqual(
    formatTabBadge(120, 0, null),
    { total: "120", urgent: null, soon: null },
  );
});

test("formatTabBadge — empty tab returns no text at all", () => {
  assert.deepEqual(
    formatTabBadge(0, 0, null),
    { total: null, urgent: null, soon: null },
  );
});

test("formatTabBadge — urgent filter, tab has zero urgent → no badge at all", () => {
  // When the urgent filter narrows a tab to nothing urgent, we don't
  // want a dangling "120" total to suggest the tab still has work
  // matching the filter. All slots drop, callers render the empty-state
  // copy instead.
  assert.deepEqual(
    formatTabBadge(120, 0, "urgent"),
    { total: null, urgent: null, soon: null },
  );
});

// --- Page-level behavior, exercised through helpers used by queue.tsx ---

test("Dashboard ↔ Queue agreement: hero count = sum of urgent across the on-clock lanes", () => {
  // Mirrors what dashboard.tsx counts (`expiringGroups.filter(g => g.effectiveDaysLeft === 0)`)
  // and what queue.tsx shows in the hero (`computeAggregateUrgentCount(...)`).
  // Same fixture rows must produce the same number on both pages.
  const dashboardExpiring = [
    { effectiveDaysLeft: 0, isUrgent: true },
    { effectiveDaysLeft: 0, isUrgent: true },
    { effectiveDaysLeft: 1, isUrgent: false },
    { effectiveDaysLeft: 2, isUrgent: false },
  ];
  const dashboardCount = dashboardExpiring.filter(g => g.effectiveDaysLeft === 0).length;
  // Same urgent rows distributed across the queue's on-clock lanes:
  const actionable = [{ isUrgent: true, effectiveDaysLeft: 0 }];
  const portalQueued = [{ isUrgent: true, effectiveDaysLeft: 0 }];
  const onHold: Array<{ isUrgent: boolean; effectiveDaysLeft: number }> = [];
  const heroCount = computeAggregateUrgentCount(actionable, portalQueued, onHold);
  assert.equal(heroCount, dashboardCount, "hero count must match Dashboard for the same data");
  assert.equal(heroCount, 2);
});

test("computeAggregateUrgentCount handles empty lanes and missing isUrgent flags", () => {
  assert.equal(computeAggregateUrgentCount(), 0);
  assert.equal(computeAggregateUrgentCount([], [], []), 0);
  assert.equal(
    computeAggregateUrgentCount(
      [{ isUrgent: undefined }, { isUrgent: null }, { isUrgent: false }],
    ),
    0,
  );
});

test("?expiring=urgent narrows every on-clock lane to urgent rows only", () => {
  const actionable = [
    { id: 1, isUrgent: true, effectiveDaysLeft: 0 },
    { id: 2, isUrgent: false, effectiveDaysLeft: 5 },
  ];
  const portalQueued = [
    { id: 3, isUrgent: false, effectiveDaysLeft: 1 },
    { id: 4, isUrgent: true, effectiveDaysLeft: 0 },
  ];
  const onHold = [{ id: 5, isUrgent: false, effectiveDaysLeft: 14 }];
  const lanes = [actionable, portalQueued, onHold].map(l =>
    filterByExpiringParam(l, "urgent"),
  );
  assert.deepEqual(lanes[0]!.map(r => r.id), [1]);
  assert.deepEqual(lanes[1]!.map(r => r.id), [4]);
  assert.deepEqual(lanes[2]!.map(r => r.id), []);
  // Only urgent rows survive; nothing non-urgent slips through.
  for (const lane of lanes) for (const row of lane) assert.equal(row.isUrgent, true);
});

test("?expiring=soon narrows every on-clock lane to non-urgent 1..3 day rows", () => {
  const actionable = [
    { id: 1, isUrgent: true, effectiveDaysLeft: 0 },
    { id: 2, isUrgent: false, effectiveDaysLeft: 1 },
    { id: 3, isUrgent: false, effectiveDaysLeft: 4 },
  ];
  const portalQueued = [
    { id: 4, isUrgent: false, effectiveDaysLeft: 3 },
    { id: 5, isUrgent: false, effectiveDaysLeft: 14 },
  ];
  const lanes = [actionable, portalQueued].map(l => filterByExpiringParam(l, "soon"));
  assert.deepEqual(lanes[0]!.map(r => r.id), [2]);
  assert.deepEqual(lanes[1]!.map(r => r.id), [4]);
});

test("clearing the filter restores the full unfiltered set", () => {
  const rows = [
    { id: 1, isUrgent: true, effectiveDaysLeft: 0 },
    { id: 2, isUrgent: false, effectiveDaysLeft: 5 },
    { id: 3, isUrgent: false, effectiveDaysLeft: 30 },
  ];
  const filtered = filterByExpiringParam(rows, "urgent");
  assert.equal(filtered.length, 1);
  // What "Clear filter" does: re-parse with empty param, then filter
  // through `filterByExpiringParam` which is a passthrough on null.
  const cleared = filterByExpiringParam(rows, parseExpiringParam(""));
  assert.equal(cleared.length, rows.length, "clearing returns to the unfiltered list");
});

test("every on-clock row with a known deadline gets a tier — including past a week", () => {
  // Regression for the "legend lies" bug. Before Task #274 anything
  // beyond the 7-day window rendered no pill, so the legend described
  // tiers the operator never saw.
  const rows = [
    { isUrgent: true, effectiveDaysLeft: 0 },     // today
    { isUrgent: false, effectiveDaysLeft: 1 },    // soon
    { isUrgent: false, effectiveDaysLeft: 2 },    // soon
    { isUrgent: false, effectiveDaysLeft: 5 },    // week
    { isUrgent: false, effectiveDaysLeft: 12 },   // later — used to be silent
    { isUrgent: false, effectiveDaysLeft: 30 },   // later — used to be silent
    { isUrgent: false, effectiveDaysLeft: -1 },   // overdue
  ];
  for (const r of rows) {
    const tier = computeDeadlineTier(r);
    assert.ok(tier != null, `row ${JSON.stringify(r)} must produce a tier`);
  }
  // Only rows with no deadline at all (effectiveDaysLeft === null) drop out.
  assert.equal(computeDeadlineTier({ isUrgent: false, effectiveDaysLeft: null }), null);
});

test("emptyStateCopy reflects the active filter on every lane", () => {
  // Default (no filter) — generic copy.
  assert.equal(emptyStateCopy("actionable", null), "No invoice groups need action right now.");
  assert.equal(emptyStateCopy("portal-queued", null), "No invoice groups queued for portal submission.");
  assert.equal(emptyStateCopy("on-hold", null), "No invoice groups on hold.");

  // Urgent filter — copy must mention "file-today" so the operator
  // doesn't think the lane is genuinely empty.
  for (const lane of ["actionable", "portal-queued", "on-hold"] as const) {
    assert.match(emptyStateCopy(lane, "urgent"), /file-today/);
  }
  // Soon filter — copy must mention "due-within-3-days".
  for (const lane of ["actionable", "portal-queued", "on-hold"] as const) {
    assert.match(emptyStateCopy(lane, "soon"), /due-within-3-days/);
  }
});

// Mobile row layout (Task #290) ----------------------------------------
//
// The per-row deadline pill in the Queue (rendered by `renderDeadlineHint`
// inside `pages/queue.tsx`) silently disappeared at narrow widths
// (≈375–430 px) before this task. Root cause: the row wrapped the left
// cluster (badge / invoice# / status / pill) in `shrink-0` while the
// right cluster (currency / chevron) used `flex-1`, so on a viewport
// narrower than the combined natural width the left cluster pushed the
// right cluster — and with it the pill — off-screen instead of allowing
// either side to wrap.
//
// We can't render the React tree from a node-only test, so this is a
// source-level lock: the queue row layout MUST NOT use `shrink-0` next
// to `flex-1` for these clusters. The fix is structural (`flex-col`
// stacking + `flex-wrap` on the top line), and the regression pattern
// is exactly what we forbid.
test("queue row layout — row clusters must not combine `shrink-0` (left) with `flex-1` (right)", async () => {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const url = await import("node:url");
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const queueSrc = await fs.readFile(path.join(here, "..", "pages", "queue.tsx"), "utf8");

  // The legacy regression layout combined `min-w-0 shrink-0` on the
  // left cluster with `min-w-0 flex-1 justify-end` on the right cluster
  // inside the same row — which is what pushed the deadline pill off
  // screen on mobile. Forbid the exact pairing.
  const regressionPattern =
    /min-w-0 shrink-0[\s\S]{0,400}min-w-0 flex-1 justify-end/;
  assert.doesNotMatch(
    queueSrc,
    regressionPattern,
    "queue.tsx row layout regressed to the pre-Task-#290 shrink-0 / flex-1 pairing — the per-row deadline pill will disappear on viewports around 375–430 px. Restore the wrapping layout (`flex-col` + `flex-wrap` on the top line) so the pill stays visible.",
  );

  // And require the wrapping layout that keeps the pill visible.
  // Stacking the two row lines (`flex-col`) plus wrapping the badge /
  // status / pill cluster (`flex-wrap`) is the structural fix; if either
  // is removed the regression returns.
  assert.match(
    queueSrc,
    /flex flex-col gap-2/,
    "queue.tsx must keep the two-line row layout that lets the deadline pill stay visible on narrow widths",
  );
  assert.match(
    queueSrc,
    /flex flex-wrap items-center gap-x-3 gap-y-2 min-w-0/,
    "queue.tsx must keep the wrapping top-line cluster so the badge / status / deadline pill always fit",
  );
});

// Mobile row layout (cont.) — the per-row deadline pill itself must
// keep `whitespace-nowrap` so its label doesn't wrap mid-pill at narrow
// widths (which would defeat the purpose of the pill being a single
// readable token like "Today · 5/1").
test("queue row layout — deadline pill keeps whitespace-nowrap", async () => {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const url = await import("node:url");
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const queueSrc = await fs.readFile(path.join(here, "..", "pages", "queue.tsx"), "utf8");
  // The pill is the `<span data-testid={`deadline-hint-...`}>` element
  // inside `renderDeadlineHint`. We assert the tailwind class set keeps
  // `whitespace-nowrap`; without it the pill text wraps mid-token on
  // narrow widths and the operator-reported regression effectively
  // returns in a different shape.
  const pillClassRegex =
    /data-testid={`deadline-hint-\$\{group\.invoiceNumber\}`}[\s\S]{0,200}whitespace-nowrap/;
  assert.match(
    queueSrc,
    pillClassRegex,
    "the per-row deadline pill must keep `whitespace-nowrap` so its single-token label doesn't break mid-pill on mobile",
  );
});
