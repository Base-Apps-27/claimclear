import { test } from "node:test";
import { strict as assert } from "node:assert";

import {
  effectiveDaysRemaining,
  isUrgentDeadline,
  shiftDeadlineForOfficeClosure,
  nextBusinessDay,
} from "../lib/dates";
import { EXPIRING_ACTIONABLE_STATUSES } from "../routes/dashboard";

// Helpers ---------------------------------------------------------------

// Build a local-time Date at midnight so it matches `setHours(0, 0, 0, 0)`
// arithmetic used inside the helpers, regardless of the host timezone.
function localDay(year: number, monthIndex: number, day: number): Date {
  return new Date(year, monthIndex, day, 0, 0, 0, 0);
}

// Returns a service date string (YYYY-MM-DD) such that serviceDate + 30 days
// lands on the requested deadline date.
function serviceDateForDeadline(deadline: Date): string {
  const d = new Date(deadline);
  d.setDate(d.getDate() - 30);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// Calendar reference: January 2026.
//   Mon Jan 19, Tue Jan 20, Wed Jan 21, Thu Jan 22, Fri Jan 23,
//   Sat Jan 24, Sun Jan 25, Mon Jan 26, Tue Jan 27.
const FRIDAY = localDay(2026, 0, 23);
const THURSDAY = localDay(2026, 0, 22);
const MONDAY = localDay(2026, 0, 19);
const SATURDAY = localDay(2026, 0, 24);
const SUNDAY = localDay(2026, 0, 25);
const NEXT_MONDAY = localDay(2026, 0, 26);
const NEXT_TUESDAY = localDay(2026, 0, 27);
const FRIDAY_PLUS_TUE = localDay(2026, 0, 27); // Tue after the FRIDAY

// shiftDeadlineForOfficeClosure ----------------------------------------

test("Saturday deadlines shift back to the prior Friday", () => {
  const shifted = shiftDeadlineForOfficeClosure(SATURDAY);
  assert.equal(shifted.getDay(), 5, "expected Friday (dow 5)");
  assert.equal(shifted.getDate(), 23);
});

test("Sunday deadlines shift back to the prior Friday", () => {
  const shifted = shiftDeadlineForOfficeClosure(SUNDAY);
  assert.equal(shifted.getDay(), 5);
  assert.equal(shifted.getDate(), 23);
});

test("weekday deadlines pass through unchanged", () => {
  for (const d of [MONDAY, THURSDAY, FRIDAY, NEXT_MONDAY]) {
    const shifted = shiftDeadlineForOfficeClosure(d);
    assert.equal(shifted.getTime(), d.getTime());
  }
});

// nextBusinessDay -------------------------------------------------------

test("nextBusinessDay from Friday is the following Monday", () => {
  const nbd = nextBusinessDay(FRIDAY);
  assert.equal(nbd.getDay(), 1);
  assert.equal(nbd.getDate(), 26);
});

test("nextBusinessDay from Thursday is the following Friday", () => {
  const nbd = nextBusinessDay(THURSDAY);
  assert.equal(nbd.getDay(), 5);
  assert.equal(nbd.getDate(), 23);
});

test("nextBusinessDay from Monday is the following Tuesday", () => {
  const nbd = nextBusinessDay(MONDAY);
  assert.equal(nbd.getDay(), 2);
  assert.equal(nbd.getDate(), 20);
});

// effectiveDaysRemaining ------------------------------------------------

test("Friday + Saturday deadline shifts to 0 effective days", () => {
  const sd = serviceDateForDeadline(SATURDAY);
  assert.equal(effectiveDaysRemaining(sd, FRIDAY), 0);
});

test("Friday + Sunday deadline shifts to 0 effective days", () => {
  const sd = serviceDateForDeadline(SUNDAY);
  assert.equal(effectiveDaysRemaining(sd, FRIDAY), 0);
});

test("Friday + Monday deadline gives 3 calendar effective days", () => {
  const sd = serviceDateForDeadline(NEXT_MONDAY);
  assert.equal(effectiveDaysRemaining(sd, FRIDAY), 3);
});

test("Thursday + Saturday deadline shifts to 1 effective day", () => {
  const sd = serviceDateForDeadline(SATURDAY);
  assert.equal(effectiveDaysRemaining(sd, THURSDAY), 1);
});

test("Monday + Tuesday deadline gives 1 effective day", () => {
  const sd = serviceDateForDeadline(NEXT_TUESDAY);
  // Today is Mon Jan 19, deadline Tue Jan 27 = 8 days later (no weekend in
  // the deadline itself), so this is mostly checking the helper against
  // ordinary weekday math rather than the shift.
  assert.equal(effectiveDaysRemaining(sd, MONDAY), 8);
});

test("null service date yields null effective days", () => {
  assert.equal(effectiveDaysRemaining(null, FRIDAY), null);
});

// isUrgentDeadline ------------------------------------------------------

test("isUrgent: Friday + Saturday deadline is urgent (shifts to today)", () => {
  const sd = serviceDateForDeadline(SATURDAY);
  assert.equal(isUrgentDeadline(sd, FRIDAY), true);
});

test("isUrgent: Friday + Sunday deadline is urgent (shifts to today)", () => {
  const sd = serviceDateForDeadline(SUNDAY);
  assert.equal(isUrgentDeadline(sd, FRIDAY), true);
});

test("isUrgent: Friday + Monday deadline is NOT urgent (Mon can still be filed Mon)", () => {
  const sd = serviceDateForDeadline(NEXT_MONDAY);
  assert.equal(isUrgentDeadline(sd, FRIDAY), false);
});

test("isUrgent: Friday + Tuesday deadline is NOT urgent", () => {
  const sd = serviceDateForDeadline(FRIDAY_PLUS_TUE);
  assert.equal(isUrgentDeadline(sd, FRIDAY), false);
});

test("isUrgent: Thursday + Saturday deadline is NOT urgent (effective deadline = Fri = tomorrow)", () => {
  const sd = serviceDateForDeadline(SATURDAY);
  assert.equal(isUrgentDeadline(sd, THURSDAY), false);
});

test("isUrgent: Thursday + Sunday deadline is NOT urgent (effective deadline = Fri = tomorrow)", () => {
  const sd = serviceDateForDeadline(SUNDAY);
  assert.equal(isUrgentDeadline(sd, THURSDAY), false);
});

test("isUrgent: Thursday + Monday deadline is NOT urgent", () => {
  const sd = serviceDateForDeadline(NEXT_MONDAY);
  assert.equal(isUrgentDeadline(sd, THURSDAY), false);
});

test("isUrgent: Monday + Tuesday deadline is NOT urgent (Tue can still be filed Tue)", () => {
  // Use a Tuesday that's exactly +1 day from MONDAY.
  const tuesdayJan20 = localDay(2026, 0, 20);
  const sd = serviceDateForDeadline(tuesdayJan20);
  assert.equal(isUrgentDeadline(sd, MONDAY), false);
});

test("isUrgent: Monday + Monday deadline is urgent (today)", () => {
  const sd = serviceDateForDeadline(MONDAY);
  assert.equal(isUrgentDeadline(sd, MONDAY), true);
});

test("isUrgent: Monday + Wednesday deadline is NOT urgent", () => {
  const wednesdayJan21 = localDay(2026, 0, 21);
  const sd = serviceDateForDeadline(wednesdayJan21);
  assert.equal(isUrgentDeadline(sd, MONDAY), false);
});

test("isUrgent: a deadline already in the past counts as urgent", () => {
  // Service date well in the past so deadline < today.
  const pastService = serviceDateForDeadline(localDay(2025, 11, 1)); // Dec 1 2025
  assert.equal(isUrgentDeadline(pastService, FRIDAY), true);
});

// Status filter ---------------------------------------------------------

test("EXPIRING_ACTIONABLE_STATUSES excludes 'Awaiting Response' (already filed; clock satisfied)", () => {
  assert.ok(
    !EXPIRING_ACTIONABLE_STATUSES.includes("Awaiting Response" as never),
    "Awaiting Response must not be in actionable statuses — once we've filed, the 30-day rule is met",
  );
});

test("EXPIRING_ACTIONABLE_STATUSES includes 'On Hold' (the filing clock keeps running while paused)", () => {
  assert.ok(
    EXPIRING_ACTIONABLE_STATUSES.includes("On Hold" as never),
    "On Hold must be in actionable statuses — pausing internally does not pause the 30-day deadline",
  );
});

test("EXPIRING_ACTIONABLE_STATUSES still includes the team-action statuses", () => {
  for (const s of [
    "New",
    "Needs Evidence",
    "Portal Queued",
    "Generating Email",
    "Ready to Review",
  ] as const) {
    assert.ok(
      EXPIRING_ACTIONABLE_STATUSES.includes(s),
      `expected '${s}' to remain in the actionable status set`,
    );
  }
});
