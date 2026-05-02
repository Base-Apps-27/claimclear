import { test } from "node:test";
import assert from "node:assert/strict";
import {
  serverTodayKey,
  daysRemaining,
  effectiveDaysRemaining,
  isUrgentDeadline,
  dateKeyInTz,
  normalizeServiceDate,
} from "../lib/dates";

// Task #298 — anchor "today" / urgency math on America/New_York.
//
// These tests assert the helpers stay agreed with the ET calendar
// regardless of host TZ and regardless of the UTC instant. The bug
// being prevented: a Saturday 02:00 UTC tick = Friday 22:00 ET should
// still answer "today is Friday", and a Friday-ET deadline should still
// be urgent four hours after the day-roll on a UTC host.

const ET = "America/New_York";

// ---------------------------------------------------------------------
// dateKeyInTz / serverTodayKey
// ---------------------------------------------------------------------

test("dateKeyInTz: UTC Saturday 02:00 == ET Friday 22:00", () => {
  // 2026-01-24T02:00:00Z is a Saturday in UTC. ET (EST, -05:00) is
  // 2026-01-23T21:00:00 — still Friday. The team's "today" is Friday.
  const sat02utc = new Date("2026-01-24T02:00:00Z");
  assert.equal(dateKeyInTz(sat02utc, ET), "2026-01-23");
  assert.equal(serverTodayKey(sat02utc, ET), "2026-01-23");
});

test("dateKeyInTz: ET wins over UTC for both EST and EDT", () => {
  // EST (winter) — UTC midnight Jan 15 == ET 19:00 Jan 14.
  assert.equal(dateKeyInTz(new Date("2026-01-15T00:00:00Z"), ET), "2026-01-14");
  // EDT (summer) — UTC 03:00 Jul 15 == ET 23:00 Jul 14.
  assert.equal(dateKeyInTz(new Date("2026-07-15T03:00:00Z"), ET), "2026-07-14");
});

test("serverTodayKey: spring-forward Sunday's instants all fall on the same ET day", () => {
  // 2026-03-08 is the spring-forward Sunday. Local time skips 02:00 → 03:00.
  // Take six samples spanning that window — all should still hash to "2026-03-08".
  const samples = [
    "2026-03-08T05:00:00Z", // 00:00 EST
    "2026-03-08T06:30:00Z", // 01:30 EST (still EST)
    "2026-03-08T07:00:00Z", // 03:00 EDT (skipped to 03:00)
    "2026-03-08T12:00:00Z", // 08:00 EDT
    "2026-03-08T20:00:00Z", // 16:00 EDT
    "2026-03-09T03:00:00Z", // 23:00 EDT — last hour of the same ET day
  ];
  for (const iso of samples) {
    assert.equal(serverTodayKey(new Date(iso), ET), "2026-03-08", `instant ${iso}`);
  }
});

test("serverTodayKey: fall-back Sunday's instants all fall on the same ET day", () => {
  // 2026-11-01 is the fall-back Sunday. Local time repeats 01:00–02:00.
  const samples = [
    "2026-11-01T04:00:00Z", // 00:00 EDT
    "2026-11-01T05:00:00Z", // 01:00 EDT (first instance)
    "2026-11-01T06:00:00Z", // 01:00 EST (after the rollback)
    "2026-11-01T12:00:00Z", // 07:00 EST
    "2026-11-02T04:00:00Z", // 23:00 EST — last hour of the same ET day
  ];
  for (const iso of samples) {
    assert.equal(serverTodayKey(new Date(iso), ET), "2026-11-01", `instant ${iso}`);
  }
});

// ---------------------------------------------------------------------
// isUrgentDeadline / effectiveDaysRemaining: TZ regression
// ---------------------------------------------------------------------

test("isUrgentDeadline: a Friday-ET deadline is still urgent at UTC Saturday 02:00", () => {
  // serviceDate so that raw deadline = 2026-01-23 (Fri). Service date is
  // 30 days earlier: 2025-12-24.
  const serviceDate = "2025-12-24";
  const fridayMidUtcSaturday = new Date("2026-01-24T02:00:00Z"); // ET Fri 21:00
  assert.equal(
    isUrgentDeadline(serviceDate, fridayMidUtcSaturday, ET),
    true,
    "Friday in ET — must remain urgent even though host UTC says Saturday",
  );
});

test("isUrgentDeadline: a Saturday-ET deadline shifts back to Friday and is urgent on Friday-ET", () => {
  // Raw deadline = 2026-01-24 (Sat) → shifts to 2026-01-23 (Fri).
  // Service date = 2025-12-25.
  const serviceDate = "2025-12-25";
  // Friday ET noon, expressed as UTC.
  const fridayNoonET = new Date("2026-01-23T17:00:00Z");
  assert.equal(isUrgentDeadline(serviceDate, fridayNoonET, ET), true);
});

test("effectiveDaysRemaining: stays in calendar days across spring-forward (no 23h skew)", () => {
  // Service date 2026-02-08, raw deadline 2026-03-10 (Tue, no shift).
  // From "today" = 2026-03-07 (Sat) — but the team's calendar uses the
  // weekday for messaging; here we just assert the count is exactly the
  // calendar diff regardless of the DST hop in between.
  const serviceDate = "2026-02-08";
  const today = new Date("2026-03-07T17:00:00Z"); // Sat noon ET
  // 2026-03-07 → 2026-03-10 = 3 calendar days, even though one of those
  // ET days is only 23h long.
  assert.equal(effectiveDaysRemaining(serviceDate, today, ET), 3);
});

test("effectiveDaysRemaining: stays in calendar days across fall-back (no 25h skew)", () => {
  // Service date 2026-10-02, raw deadline 2026-11-01 (Sun) → shifts to
  // 2026-10-30 (Fri).
  const serviceDate = "2026-10-02";
  // "Today" = 2026-10-29 (Thu) noon ET.
  const today = new Date("2026-10-29T16:00:00Z");
  assert.equal(effectiveDaysRemaining(serviceDate, today, ET), 1);
});

test("daysRemaining: tz-default keeps a UTC-late instant on the ET day before", () => {
  // Service date 2026-01-01, raw deadline 2026-01-31. From an instant
  // that's already 2026-02-01 in UTC but still 2026-01-31 in ET, the
  // remaining-days count must read as 0 (urgent today), not -1.
  const serviceDate = "2026-01-01";
  const utcMidnightFeb1 = new Date("2026-02-01T03:00:00Z"); // Jan 31 22:00 ET
  assert.equal(daysRemaining(serviceDate, utcMidnightFeb1, ET), 0);
});

test("isUrgentDeadline: weekday deadline three days out is NOT urgent on a UTC-late instant", () => {
  const serviceDate = "2026-01-04"; // raw deadline = 2026-02-03 (Tue)
  const lateNightUTC = new Date("2026-02-01T03:00:00Z"); // Jan 31 22:00 ET
  assert.equal(isUrgentDeadline(serviceDate, lateNightUTC, ET), false);
});

// ---------------------------------------------------------------------
// Cross-check: tz parameter and default agree
// ---------------------------------------------------------------------

// ---------------------------------------------------------------------
// Malformed input guard — production data has historically included
// empty strings, partial dates, and impossible calendar dates that used
// to crash the dashboard with `RangeError: Invalid time value`.
// ---------------------------------------------------------------------

test("daysRemaining returns null for malformed service dates", () => {
  for (const bad of ["", "2026-02", "not-a-date", "2026-02-30", "0000-00-00"]) {
    assert.equal(
      daysRemaining(bad as string),
      null,
      `expected null for ${JSON.stringify(bad)}`,
    );
  }
});

test("effectiveDaysRemaining returns null for malformed service dates", () => {
  for (const bad of ["", "2026-02", "not-a-date", "2026-02-30"]) {
    assert.equal(effectiveDaysRemaining(bad as string), null);
  }
});

test("isUrgentDeadline returns false for malformed service dates", () => {
  for (const bad of ["", "2026-02", "not-a-date", "2026-02-30"]) {
    assert.equal(isUrgentDeadline(bad as string), false);
  }
});

test("default tz parameter is America/New_York", () => {
  // If anyone changes the default constant the production behaviour
  // shifts silently — pin it explicitly.
  const sample = new Date("2026-01-24T02:00:00Z");
  assert.equal(serverTodayKey(sample), serverTodayKey(sample, ET));
  assert.equal(dateKeyInTz(sample), dateKeyInTz(sample, ET));
});

// ---------------------------------------------------------------------
// normalizeServiceDate — production data has historically been stored
// as M/D/YYYY and (later) M/D/YY text. The deadline helpers must accept
// any of these formats so a single non-ISO row can't silently fall out
// of the dashboard's "must file today" count. See migration 0020.
// ---------------------------------------------------------------------

test("normalizeServiceDate: ISO YYYY-MM-DD passes through unchanged", () => {
  assert.equal(normalizeServiceDate("2026-04-02"), "2026-04-02");
  // Trailing time component (defensive — some legacy paths used to pass
  // a full ISO timestamp).
  assert.equal(normalizeServiceDate("2026-04-02T15:30:00Z"), "2026-04-02");
});

test("normalizeServiceDate: M/D/YYYY (the dominant historical shape)", () => {
  assert.equal(normalizeServiceDate("4/2/2026"), "2026-04-02");
  assert.equal(normalizeServiceDate("4/15/2026"), "2026-04-15");
  assert.equal(normalizeServiceDate("12/31/2026"), "2026-12-31");
  // Zero-padded variants, just in case.
  assert.equal(normalizeServiceDate("04/02/2026"), "2026-04-02");
});

test("normalizeServiceDate: M/D/YY two-digit-year window", () => {
  // 00-69 -> 20YY (current decade & near future).
  assert.equal(normalizeServiceDate("4/28/26"), "2026-04-28");
  assert.equal(normalizeServiceDate("1/1/00"), "2000-01-01");
  assert.equal(normalizeServiceDate("12/31/69"), "2069-12-31");
  // 70-99 -> 19YY (defensive — should never happen for our domain).
  assert.equal(normalizeServiceDate("1/1/70"), "1970-01-01");
});

test("normalizeServiceDate: returns null for empty / unparseable / impossible dates", () => {
  for (const bad of [null, undefined, "", "   ", "not-a-date", "2026-13-01", "2026-02-30", "13/45/2026", "4/31/2026"]) {
    assert.equal(
      normalizeServiceDate(bad as string | null | undefined),
      null,
      `expected null for ${JSON.stringify(bad)}`,
    );
  }
});

test("daysRemaining accepts M/D/YYYY and M/D/YY directly", () => {
  // Production data used to silently fall out of the dashboard's
  // urgency math because the helpers required strict ISO. After the
  // dates.ts normalizer + migration 0020 backfill, M/D/YYYY values
  // must compute the same as their ISO equivalents.
  const today = new Date("2026-04-02T16:00:00Z"); // Apr 2 noon ET
  assert.equal(daysRemaining("4/2/2026", today, ET), daysRemaining("2026-04-02", today, ET));
  assert.equal(daysRemaining("4/28/26", today, ET), daysRemaining("2026-04-28", today, ET));
});

test("isUrgentDeadline flags an Apr 2 service date on May 2 (deadline today, M/D/YYYY input)", () => {
  // The exact bug the user reported: it's May 2 and Apr 2 service
  // dates have hit their 30-day deadline. The deadline helpers must
  // treat the historical M/D/YYYY string as urgent, not silently
  // ignore it.
  const may2et = new Date("2026-05-02T16:00:00Z"); // May 2 noon ET
  assert.equal(isUrgentDeadline("4/2/2026", may2et, ET), true);
  assert.equal(isUrgentDeadline("2026-04-02", may2et, ET), true);
});
