// Unit tests for the pure pieces of the `service_date` machinery
// (Task #350). The `recomputeGroupServiceDate` wrapper itself is a
// thin executor-binding around `pickEarliestServiceDate` plus a single
// UPDATE — its DB plumbing is exercised by the e2e flow that follows
// this file in CI. Here we lock down the MIN semantics so the dashboard
// "FILE TODAY" hero, the Invoice Queue "must file today" tier, and the
// Groups list Service Date column never disagree on an edge case.

import { test } from "node:test";
import { strict as assert } from "node:assert";

import { pickEarliestServiceDate } from "../lib/group-service-date";

test("pickEarliestServiceDate: no children → null", () => {
  assert.equal(pickEarliestServiceDate([]), null);
});

test("pickEarliestServiceDate: every child is blank → null", () => {
  assert.equal(pickEarliestServiceDate([null, undefined, "", "  "]), null);
});

test("pickEarliestServiceDate: every child is unparseable → null", () => {
  // Drops obvious junk; mismatched-format inputs are also dropped (the
  // normalizer only accepts ISO and M/D/YYYY shapes — that's what
  // `import.ts` writes).
  assert.equal(
    pickEarliestServiceDate(["not a date", "2026/05/01", "May 1 2026"]),
    null,
  );
});

test("pickEarliestServiceDate: ISO inputs picked by lexical MIN", () => {
  assert.equal(
    pickEarliestServiceDate(["2026-04-15", "2026-04-02", "2026-05-01"]),
    "2026-04-02",
  );
});

test("pickEarliestServiceDate: mixed ISO + US formats, lexical MIN equals calendar MIN", () => {
  // The bug the typed column closes: the legacy code briefly considered
  // a lexical text MIN of M/D/YYYY which would have picked '4/15/...'
  // over '4/2/...' (because '1' < '2'). Routing every input through
  // `normalizeServiceDate` first means lexical MIN is calendar MIN.
  assert.equal(
    pickEarliestServiceDate(["4/15/2026", "4/2/2026", "5/1/2026"]),
    "2026-04-02",
  );
});

test("pickEarliestServiceDate: M/D/YY two-digit years normalized via Excel window", () => {
  // 26 → 2026 (window: 00-69 maps to 2000-2069). Picks April 2 2026.
  assert.equal(
    pickEarliestServiceDate(["4/15/26", "4/2/26", "5/1/26"]),
    "2026-04-02",
  );
});

test("pickEarliestServiceDate: parseable wins even when interleaved with blanks and junk", () => {
  assert.equal(
    pickEarliestServiceDate([null, "", "not a date", "2026-04-02", "  ", "5/1/2026"]),
    "2026-04-02",
  );
});

test("pickEarliestServiceDate: includes ALL children, regardless of leg state", () => {
  // The MIN is the trip date the payor billed for; whether an operator
  // later marked a leg as excluded, sibling-duplicate, or otherwise
  // resolved doesn't change the 30-day filing clock. The pure helper
  // only sees raw date strings — there's no leg-state filter — and
  // that's the contract the live recompute helper matches.
  // Even an "excluded" leg (modeled here by simply being in the input
  // list) participates in the MIN.
  const dates = ["2026-05-01", "2026-04-02" /* "excluded" */, "2026-04-15"];
  assert.equal(pickEarliestServiceDate(dates), "2026-04-02");
});

test("pickEarliestServiceDate: idempotent — same input yields same output", () => {
  const input = ["2026-04-15", "2026-04-02", "2026-05-01"];
  const a = pickEarliestServiceDate(input);
  const b = pickEarliestServiceDate(input);
  const c = pickEarliestServiceDate([...input].reverse());
  assert.equal(a, "2026-04-02");
  assert.equal(b, "2026-04-02");
  assert.equal(c, "2026-04-02");
});

test("pickEarliestServiceDate: cross-year MIN via lexical compare", () => {
  // Sanity check: lexical compare of ISO strings continues to work
  // across year boundaries.
  assert.equal(
    pickEarliestServiceDate(["2026-01-15", "2025-12-31", "2026-02-01"]),
    "2025-12-31",
  );
});
