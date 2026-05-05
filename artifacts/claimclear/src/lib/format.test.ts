// Regression coverage for the YYYY-MM-DD off-by-one display bug.
// `claims.date` and `invoice_groups.service_date` come over the wire as
// bare calendar days (`YYYY-MM-DD`). `new Date("2026-04-06")` parses
// that as midnight UTC, which renders one day earlier in any negative-
// UTC offset (ET in April: UTC-4 → 8pm Apr 5 → "Apr 5"). The list
// then shows "Apr 5" for a row whose DB value is "Apr 6", and the
// "Must file today" / urgency math drifts a day relative to what the
// operator sees. `formatDate` must parse calendar-only inputs as
// local-midnight so the displayed day matches the stored service date.

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { formatDate, formatDateTime } from "./format";

test("formatDate renders YYYY-MM-DD as the same calendar day (no UTC shift)", () => {
  // Apr 6 2026 — the exact date from the bug report. In ET (UTC-4 in
  // April) the UTC-midnight parse used to render this as "Apr 5".
  assert.equal(formatDate("2026-04-06"), "Apr 6, 2026");
  // Jan 1 — DST-free month; locks the contract year-round.
  assert.equal(formatDate("2026-01-01"), "Jan 1, 2026");
  // End-of-year — guards against year rollover under negative offsets.
  assert.equal(formatDate("2026-12-31"), "Dec 31, 2026");
});

test("formatDate falls back gracefully for null/undefined", () => {
  assert.equal(formatDate(null), "N/A");
  assert.equal(formatDate(undefined), "N/A");
  assert.equal(formatDate(""), "N/A");
});

test("formatDateTime keeps full ISO timestamps intact (T separator path)", () => {
  // Full timestamp goes through parseISO — wall-clock formatting is
  // host-local, so we only assert the date portion is preserved.
  const out = formatDateTime("2026-04-06T15:30:00Z");
  assert.match(out, /Apr 6, 2026/);
});
