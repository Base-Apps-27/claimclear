// Regression coverage for `formatServiceDate` — the backend twin of
// the frontend `formatDate` helper. Pinned to America/New_York via
// the package's test script so the assertions catch the negative-UTC
// off-by-one that started this whole thread.

import { test } from "node:test";
import assert from "node:assert/strict";
import { formatServiceDate } from "../lib/dates";

test("formatServiceDate keeps the calendar day intact in ET (no Apr 5 / Apr 6 drift)", () => {
  // April 6, 2026 stored as a bare YYYY-MM-DD (the wire shape from
  // `claims.date`). Naive `new Date("2026-04-06").toLocaleDateString`
  // would show "Apr 5" in ET. The helper must show "Apr 6".
  assert.equal(formatServiceDate("2026-04-06"), "Apr 6, 2026");
});

test("formatServiceDate accepts full ISO timestamps by truncating to the date portion", () => {
  // The brief sometimes pulls dates from joined rows where the value
  // arrives as a timestamp string. The leading 10 chars are still
  // the calendar day, and we must not let TZ math shift it.
  assert.equal(formatServiceDate("2026-04-06T00:00:00.000Z"), "Apr 6, 2026");
});

test("formatServiceDate returns the dash sentinel for null/empty/malformed input", () => {
  assert.equal(formatServiceDate(null), "—");
  assert.equal(formatServiceDate(undefined), "—");
  assert.equal(formatServiceDate(""), "—");
  assert.equal(formatServiceDate("not-a-date"), "—");
  // Custom dash for callers that prefer a different sentinel.
  assert.equal(formatServiceDate(null, "N/A"), "N/A");
});
