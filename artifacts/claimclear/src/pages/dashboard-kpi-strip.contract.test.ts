// Source-level contract test for the Dashboard top KPI strip — Task #720.
//
// We intentionally test the page source (not a mounted React tree)
// because the canonical-tile guarantee is fundamentally a wiring
// guarantee: each tile must read ONE named field from
// `/dashboard/summary.amounts`, declare its unit in the sub-label, and
// never re-introduce the retired ×1.7 driver-prepay multiplier or the
// retired tile labels. A grep over the page source catches every
// regression (wrong field, wrong testid, lost unit label, multiplier
// snuck back in) without the ~200-line mocking dance a full render
// test would require for this page.

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const dashboardSrc = await readFile(
  resolve(here, "dashboard.tsx"),
  "utf8",
);

test("Dashboard top KPI strip exposes all 5 canonical Task #720 tiles", () => {
  for (const testid of [
    "kpi-open-invoices",
    "kpi-at-risk",
    "kpi-recovered",
    "kpi-recovery-rate",
    "kpi-net-change",
  ]) {
    assert.match(
      dashboardSrc,
      new RegExp(`testid=["']${testid}["']`),
      `Dashboard must render the canonical tile testid="${testid}" so the operator surface, daily brief, and Insights stay reconciled`,
    );
  }
});

test("Dashboard KPI strip retired the pre-#720 tile labels and helpers", () => {
  // The old "Invoices pending / At risk / Already lost / Reclaimed"
  // 4-tile strip is gone. None of the retired testids should reappear
  // on this page.
  for (const retired of [
    "kpi-invoices-pending",
    "kpi-already-lost",
    "kpi-reclaimed",
  ]) {
    assert.doesNotMatch(
      dashboardSrc,
      new RegExp(`testid=["']${retired}["']`),
      `Retired tile testid="${retired}" must not reappear on the Dashboard — replaced by the canonical 5-tile strip`,
    );
  }
  // The "+ ~70% driver prepay" copy and any client-side ×1.7 / ×0.7
  // multiplier on the At-risk display must stay out — this was the
  // single biggest reconciliation bug Task #720 fixed.
  assert.doesNotMatch(
    dashboardSrc,
    /~?70% driver prepay/i,
    "Retired '~70% driver prepay' sub-label must not reappear on the Dashboard At-risk tile",
  );
  assert.doesNotMatch(
    dashboardSrc,
    /\*\s*1\.7\b/,
    "No client-side ×1.7 multiplier on the Dashboard — at-risk dollars are shown raw to match Insights",
  );
  // Counts on this page now read the server-stamped scalars directly.
  // The `getUrgentGroupCountFromSummary` helper is still legal in the
  // codebase (Queue uses it) but must not be imported or called here.
  // Strip line comments first so the prose explanation in the file's
  // header doesn't trip this guard.
  const codeOnly = dashboardSrc
    .split("\n")
    .filter(line => !/^\s*\/\//.test(line))
    .join("\n");
  assert.doesNotMatch(
    codeOnly,
    /getUrgentGroupCountFromSummary\s*\(/,
    "Dashboard must read summary.urgentCount directly, not call getUrgentGroupCountFromSummary",
  );
  assert.doesNotMatch(
    codeOnly,
    /\bgetUrgentGroupCountFromSummary\b/,
    "Dashboard must not import getUrgentGroupCountFromSummary — count comes from summary.urgentCount",
  );
  // Server-stamped scalar must be the actual source of the count.
  assert.match(
    dashboardSrc,
    /summary\.urgentCount\s*\?\?/,
    "Dashboard must read fileTodayCount from summary.urgentCount with a `??` fallback",
  );
});

test("Dashboard KPI strip declares units on every tile", () => {
  // Each canonical tile carries a sub-label that names its unit so the
  // operator never has to guess invoices vs $ vs % vs delta. The exact
  // copy can move, but the unit token must stay.
  for (const unitToken of [
    /invoices\s*·\s*snapshot now/i,         // Open invoices
    /open invoices\s*·\s*snapshot now/i,    // At risk $
    /\$\s*·\s*all time/i,                   // Recovered $ (now all-time, not windowed)
    /%\s*·\s*all time/i,                    // Recovery rate (now all-time)
    /\$\s*·\s*vs prior/i,                   // Net change (still 7d windowed)
  ]) {
    assert.match(
      dashboardSrc,
      unitToken,
      `Dashboard tile is missing its declared unit sub-label (pattern ${unitToken})`,
    );
  }
});

test("Dashboard 'Closed-out outcomes' panel exposes the canonical Insights buckets", () => {
  for (const testid of [
    "kpi-outcome-breakdown",
    "outcome-denied",
    "outcome-withdrawn",
    "outcome-expired",
  ]) {
    assert.match(
      dashboardSrc,
      new RegExp(`testid=["']${testid}["']`),
      `Outcome breakdown must render testid="${testid}" — these mirror the canonical Insights outcome buckets`,
    );
  }
});
