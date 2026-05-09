// Day-boundary regression coverage for the cross-surface display-TZ
// module (#562). The same record was previously displaying a different
// day on Dashboard, list, detail, and chart because each helper used a
// different timezone convention. The contract is now:
//
//   - Calendar-only inputs (`YYYY-MM-DD`) render as the authored day,
//     no TZ conversion (matches stored service date in every browser).
//   - ISO timestamps render in the display TZ (the operator's app TZ).
//   - Chart axes use the same display TZ.
//   - "Today" / urgency math (server side, in `api-server/src/lib/dates.ts`)
//     uses the same display TZ.
//
// Tests run with `TZ=America/New_York` per the api-server convention;
// the time module's display TZ defaults to `America/New_York` when
// `VITE_DISPLAY_TIMEZONE` is unset (which it always is under node).

import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
  formatDate,
  formatDateTime,
  formatChartTick,
  formatRelative,
  formatWeekday,
  dayKeyInDisplayTz,
  serverNowInDisplayTz,
  absoluteTooltip,
  getDisplayTimezone,
} from "./index";

test("getDisplayTimezone defaults to America/New_York", () => {
  assert.equal(getDisplayTimezone(), "America/New_York");
});

test("getDisplayTimezone honours DISPLAY_TIMEZONE env (parity with server)", () => {
  // The deployment contract is "set DISPLAY_TIMEZONE once and both
  // surfaces follow" (#562). Confirm the client helper picks it up
  // from process.env so server `getServerDisplayTimezone()` and the
  // client `getDisplayTimezone()` cannot drift on a non-default zone.
  // The cached `Intl.DateTimeFormat`s are fine to leave in place — the
  // helpers re-read the TZ on every call.
  const prev = process.env.DISPLAY_TIMEZONE;
  process.env.DISPLAY_TIMEZONE = "America/Los_Angeles";
  try {
    assert.equal(getDisplayTimezone(), "America/Los_Angeles");
    // Same instant: 02:00 UTC Saturday is 19:00 PT Friday — so both
    // dayKeyInDisplayTz and serverNowInDisplayTz must say "Friday"
    // (parity with what api-server's `dates.ts` would return for the
    // same env value).
    assert.equal(dayKeyInDisplayTz("2026-04-04T02:00:00Z"), "2026-04-03");
  } finally {
    if (prev === undefined) delete process.env.DISPLAY_TIMEZONE;
    else process.env.DISPLAY_TIMEZONE = prev;
  }
});

test("formatDate: calendar-only YYYY-MM-DD renders the same day in every TZ", () => {
  // The exact date from the original off-by-one bug. ET is UTC-4 in
  // April; under the old `new Date("2026-04-06")` parse this rendered
  // as "Apr 5". The contract is "stored day === displayed day".
  assert.equal(formatDate("2026-04-06"), "Apr 6, 2026");
  assert.equal(formatDate("2026-01-01"), "Jan 1, 2026");
  assert.equal(formatDate("2026-12-31"), "Dec 31, 2026");
});

test("formatDate: ISO timestamps render in the display TZ", () => {
  // Apr 7 03:30 UTC is Apr 6 23:30 ET — the day a US-East operator
  // would see on the audit row.
  assert.equal(formatDate("2026-04-07T03:30:00Z"), "Apr 6, 2026");
});

test("formatDate: null/empty fall back to N/A", () => {
  assert.equal(formatDate(null), "N/A");
  assert.equal(formatDate(undefined), "N/A");
  assert.equal(formatDate(""), "N/A");
});

test("formatDateTime: ISO instant uses display TZ wall clock", () => {
  // 03:30 UTC on Apr 7 == 11:30 PM ET on Apr 6.
  const out = formatDateTime("2026-04-07T03:30:00Z");
  assert.match(out, /Apr 6, 2026/);
  assert.match(out, /11:30 PM/);
});

test("formatChartTick: YYYY-MM-DD tick renders without TZ conversion", () => {
  // Insights time-series axis. Previously the chart forced UTC and
  // the topline tile used local TZ — the same row could be plotted on
  // a different day than its tile sub-text said.
  assert.equal(formatChartTick("2026-04-06"), "Apr 6");
});

test("formatChartTick: ISO instant renders in display TZ", () => {
  // 02:00 UTC Saturday is still 10:00 PM Friday ET — chart tick must
  // agree with the day the operator actually sees.
  assert.equal(formatChartTick("2026-04-04T02:00:00Z"), "Apr 3");
});

test("formatRelative: handles the standard tiers", () => {
  const now = Date.parse("2026-04-06T12:00:00Z");
  assert.equal(formatRelative("2026-04-06T11:59:30Z", now), "just now");
  assert.equal(formatRelative("2026-04-06T11:55:00Z", now), "5m ago");
  assert.equal(formatRelative("2026-04-06T09:00:00Z", now), "3h ago");
  assert.equal(formatRelative("2026-04-04T12:00:00Z", now), "2d ago");
});

test("formatRelative: anything older than a week falls back to display-TZ date", () => {
  const now = Date.parse("2026-04-06T12:00:00Z");
  // Two-week-old timestamp: should render the display-TZ date.
  assert.equal(formatRelative("2026-03-23T12:00:00Z", now), "2w ago");
  // Two-month-old timestamp: tier exhausted, falls back to formatDate.
  const out = formatRelative("2026-02-01T12:00:00Z", now);
  assert.match(out, /Feb 1, 2026/);
});

test("dayKeyInDisplayTz: a UTC-late instant resolves to the prior ET day", () => {
  // 02:00 UTC Saturday is 10:00 PM Friday in ET.
  assert.equal(dayKeyInDisplayTz("2026-04-04T02:00:00Z"), "2026-04-03");
});

test("serverNowInDisplayTz: matches the IANA-formatted server-today key", () => {
  // Avoid constructing a Date from a YMD-prefixed literal (the
  // dates-guardrail static scan flags any `new Date("YYYY-MM-DD…")`
  // form, even when a `T…Z` suffix makes it safe).
  const sample = new Date(Date.UTC(2026, 3, 4, 2, 0, 0));
  assert.equal(serverNowInDisplayTz(sample), "2026-04-03");
});

test("formatWeekday: calendar-only YMD renders the authored day's weekday", () => {
  // 2026-04-06 is a Monday. A naive `new Date("2026-04-06")` would
  // anchor at UTC midnight and, in negative-UTC TZs, render as Sunday.
  // The contract: authored day in, authored weekday out.
  assert.equal(formatWeekday("2026-04-06"), "Mon");
  assert.equal(formatWeekday("2026-04-05"), "Sun");
});

test("formatWeekday: ISO instants render the display-TZ weekday", () => {
  // 02:00 UTC Saturday is 22:00 ET Friday — operator's "today" is Fri.
  assert.equal(formatWeekday("2026-04-04T02:00:00Z"), "Fri");
});

test("attestation queue: relativeAge label flows through formatRelative tiers", async () => {
  // Sanity-check the cross-surface contract for the attestation queue
  // sidebar: the "5m ago" label must come from the same formatter as
  // every other relative-time render, and the same iso must be carried
  // through so the row can attach `absoluteTooltip` (#562).
  const { relativeAge } = await import("../../components/attestation/utils");
  const now = new Date(Date.parse("2026-04-06T12:00:00Z"));
  const fresh = relativeAge("2026-04-06T11:55:00Z", now);
  assert.ok(fresh);
  assert.equal(fresh.label, "5m ago");
  assert.equal(fresh.isStale, false);
  assert.equal(fresh.iso, "2026-04-06T11:55:00Z");
  const stale = relativeAge("2026-03-23T12:00:00Z", now);
  assert.ok(stale);
  assert.equal(stale.isStale, true);
});

test("absoluteTooltip: includes the display-TZ name so hovers are unambiguous", () => {
  const out = absoluteTooltip("2026-04-07T03:30:00Z");
  assert.match(out, /Apr 6, 2026/);
  assert.match(out, /America\/New_York/);
});
