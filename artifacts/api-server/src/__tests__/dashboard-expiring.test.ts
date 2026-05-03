import { test } from "node:test";
import { strict as assert } from "node:assert";

import {
  effectiveDaysRemaining,
  isUrgentDeadline,
  shiftDeadlineForOfficeClosure,
  nextBusinessDay,
} from "../lib/dates";
import {
  CLAIM_EXPIRING_ACTIONABLE_STATUSES,
  CLAIM_SUBMITTED_STUCK_STATUSES,
  GROUP_EXPIRING_ACTIONABLE_STATUSES,
  GROUP_SUBMITTED_STUCK_STATUSES,
} from "../routes/dashboard";

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

test("isUrgent: a deadline already in the past does NOT count as urgent (strict today-only)", () => {
  // Strict-equality semantics (see `isUrgentDeadline`): operationally
  // we never carry past-due unsubmitted invoices, so flagging older
  // slips as "Today" inflated counts and labelled future deadlines
  // incorrectly. Past-due chase work belongs to the `submittedStuck`
  // tier, computed via `isAtOrPastEffectiveDeadline`.
  const pastService = serviceDateForDeadline(localDay(2025, 11, 1)); // Dec 1 2025
  assert.equal(isUrgentDeadline(pastService, FRIDAY), false);
});

// Status filter (Task #290) --------------------------------------------
//
// Group-level and claim-level "actionable" status sets diverge by design.
// See the rule and rationale spelled out in `routes/dashboard.ts`.

// --- Group-level set ---------------------------------------------------

test("GROUP_EXPIRING_ACTIONABLE_STATUSES is exactly { New, Needs Evidence, On Hold, Generating Email }", () => {
  // Lock the membership *and* the size — adding or removing a status
  // here moves the Dashboard's must-file-today count, so it should be a
  // deliberate, reviewed change rather than a drive-by.
  assert.deepEqual(
    [...GROUP_EXPIRING_ACTIONABLE_STATUSES].sort(),
    ["Generating Email", "Needs Evidence", "New", "On Hold"],
    "group-level urgency set drifted",
  );
});

test("GROUP_EXPIRING_ACTIONABLE_STATUSES excludes post-submit and concluded statuses", () => {
  // Post-submit: clock satisfied (Portal Queued = operator already
  // submitted via the portal); response timing lives elsewhere.
  // Concluded: nothing left to file.
  // Processed: claim-only state, never lands on invoice_groups.status.
  for (const s of [
    "Portal Queued",
    "Awaiting Response",
    "Needs Review",
    "Ready to Review",
    "Resolved",
    "Denied",
    "Processed",
  ] as const) {
    assert.ok(
      !GROUP_EXPIRING_ACTIONABLE_STATUSES.includes(s as never),
      `'${s}' must not be in the group-level actionable status set`,
    );
  }
});

test("GROUP_EXPIRING_ACTIONABLE_STATUSES includes 'Generating Email' (pre-submit, on-clock)", () => {
  assert.ok(
    GROUP_EXPIRING_ACTIONABLE_STATUSES.includes("Generating Email" as never),
    "Generating Email is set when the operator clicks 'Ready to package' — it must be in the actionable set so the Dashboard hero and the Queue's Action Required lane stay in sync",
  );
});

// --- Claim-level set ---------------------------------------------------

test("CLAIM_EXPIRING_ACTIONABLE_STATUSES retains 'Portal Queued' and 'Processed' (stuck-leg escalations)", () => {
  // The 30-day clock keeps running on individual claims in these
  // states even after their parent group has moved on. The daily brief
  // and claim list use these to surface stuck legs.
  assert.ok(
    CLAIM_EXPIRING_ACTIONABLE_STATUSES.includes("Portal Queued" as never),
    "Portal Queued must remain in the claim-level actionable set",
  );
  assert.ok(
    CLAIM_EXPIRING_ACTIONABLE_STATUSES.includes("Processed" as never),
    "Processed must remain in the claim-level actionable set",
  );
});

test("CLAIM_EXPIRING_ACTIONABLE_STATUSES excludes 'Awaiting Response' (already filed; clock satisfied)", () => {
  assert.ok(
    !CLAIM_EXPIRING_ACTIONABLE_STATUSES.includes("Awaiting Response" as never),
    "Awaiting Response must not be in actionable statuses — once we've filed, the 30-day rule is met",
  );
});

test("CLAIM_EXPIRING_ACTIONABLE_STATUSES includes 'On Hold' (the filing clock keeps running while paused)", () => {
  assert.ok(
    CLAIM_EXPIRING_ACTIONABLE_STATUSES.includes("On Hold" as never),
    "On Hold must be in actionable statuses — pausing internally does not pause the 30-day deadline",
  );
});

test("CLAIM_EXPIRING_ACTIONABLE_STATUSES still includes the team-action statuses", () => {
  for (const s of [
    "New",
    "Needs Evidence",
    "Portal Queued",
    "Generating Email",
  ] as const) {
    assert.ok(
      CLAIM_EXPIRING_ACTIONABLE_STATUSES.includes(s),
      `expected '${s}' to remain in the actionable status set`,
    );
  }
});

// `Ready to Review` and `Needs Review` are post-submit response triage,
// not filing-clock urgency. Task #290 removed both from every urgency
// surface — lock that out at the claim level too so a future change can't
// silently re-add them.
test("CLAIM_EXPIRING_ACTIONABLE_STATUSES excludes 'Ready to Review' and 'Needs Review' (post-submit, not on the filing clock)", () => {
  for (const s of ["Ready to Review", "Needs Review"] as const) {
    assert.ok(
      !CLAIM_EXPIRING_ACTIONABLE_STATUSES.includes(s as never),
      `'${s}' must not be in the claim-level actionable set — it's post-submit response triage, not filing-clock urgency`,
    );
  }
});

// --- Group-level isUrgent decision (mirrors invoice-groups.ts row math)

// The endpoint computes `isUrgent` as
//   GROUP_ON_CLOCK_STATUSES.has(status) && isUrgentDeadline(date, now)
// (see routes/invoice-groups.ts). Lock that combined behaviour here so
// future regressions surface even without an HTTP-level test.
function computeGroupIsUrgent(status: string, serviceDate: string, now: Date): boolean {
  const onClock = (GROUP_EXPIRING_ACTIONABLE_STATUSES as readonly string[]).includes(status);
  return onClock && isUrgentDeadline(serviceDate, now);
}

test("a Portal Queued group with a today deadline is NOT urgent at the group level", () => {
  // Service date such that the raw 30-day deadline lands on FRIDAY (today).
  const sd = serviceDateForDeadline(FRIDAY);
  assert.equal(
    computeGroupIsUrgent("Portal Queued", sd, FRIDAY),
    false,
    "Portal Queued = operator already submitted; group-level urgency must not fire",
  );
});

test("a Generating Email group with a today deadline IS urgent at the group level", () => {
  const sd = serviceDateForDeadline(FRIDAY);
  assert.equal(
    computeGroupIsUrgent("Generating Email", sd, FRIDAY),
    true,
    "Generating Email = packaged but not yet submitted; group-level urgency must fire",
  );
});

test("an Awaiting Response group with a today deadline is NOT urgent at the group level", () => {
  const sd = serviceDateForDeadline(FRIDAY);
  assert.equal(
    computeGroupIsUrgent("Awaiting Response", sd, FRIDAY),
    false,
    "Awaiting Response = filed; the 30-day rule is satisfied, group-level urgency must not fire",
  );
});

test("a New group with a today deadline IS urgent at the group level", () => {
  const sd = serviceDateForDeadline(FRIDAY);
  assert.equal(computeGroupIsUrgent("New", sd, FRIDAY), true);
});

test("a Needs Evidence group with a today deadline IS urgent at the group level", () => {
  const sd = serviceDateForDeadline(FRIDAY);
  assert.equal(computeGroupIsUrgent("Needs Evidence", sd, FRIDAY), true);
});

test("an On Hold group with a today deadline IS urgent at the group level", () => {
  const sd = serviceDateForDeadline(FRIDAY);
  assert.equal(
    computeGroupIsUrgent("On Hold", sd, FRIDAY),
    true,
    "the filing clock keeps running while paused",
  );
});

// ============================================================
// Task #352 — "Submitted but unconfirmed" tier snapshot tests
// ============================================================
//
// These tests lock down the explicit status-set membership rules so
// future contributors can see at a glance exactly which statuses live
// in each tier and why, and so any accidental membership change causes
// a test failure rather than a silent dashboard discrepancy.

// --- Status-set disjointness

test("GROUP_SUBMITTED_STUCK_STATUSES and GROUP_EXPIRING_ACTIONABLE_STATUSES are disjoint (Task #352)", () => {
  const actionableSet = new Set<string>(GROUP_EXPIRING_ACTIONABLE_STATUSES);
  for (const s of GROUP_SUBMITTED_STUCK_STATUSES) {
    assert.ok(
      !actionableSet.has(s),
      `'${s}' must NOT appear in both GROUP_EXPIRING_ACTIONABLE_STATUSES and GROUP_SUBMITTED_STUCK_STATUSES — ` +
        "the two sets are the 'file now' vs 'chase confirmation' tiers and must be disjoint at the group level",
    );
  }
});

test("CLAIM_SUBMITTED_STUCK_STATUSES is a strict subset of CLAIM_EXPIRING_ACTIONABLE_STATUSES (Task #352)", () => {
  const actionableSet = new Set(CLAIM_EXPIRING_ACTIONABLE_STATUSES);
  for (const s of CLAIM_SUBMITTED_STUCK_STATUSES) {
    assert.ok(
      actionableSet.has(s),
      `'${s}' in CLAIM_SUBMITTED_STUCK_STATUSES must also appear in CLAIM_EXPIRING_ACTIONABLE_STATUSES — ` +
        "stuck claim statuses are a subset of the broader on-clock set",
    );
  }
});

test("GROUP_SUBMITTED_STUCK_STATUSES contains exactly 'Portal Queued' (Task #352)", () => {
  assert.deepEqual(
    [...GROUP_SUBMITTED_STUCK_STATUSES].sort(),
    ["Portal Queued"],
    "Only 'Portal Queued' can appear at the group level — 'Processed' is claim-only and never lands on invoice_groups.status",
  );
});

test("CLAIM_SUBMITTED_STUCK_STATUSES contains exactly 'Portal Queued' and 'Processed' (Task #352)", () => {
  assert.deepEqual(
    [...CLAIM_SUBMITTED_STUCK_STATUSES].sort(),
    ["Portal Queued", "Processed"].sort(),
    "Both post-submit claim statuses qualify: Portal Queued (submitted, awaiting portal ack) and Processed (leg done, parent not yet packaged)",
  );
});

// --- Per-row submittedStuck decision (mirrors routes logic)
//   group: `GROUP_STUCK_STATUSES.has(status) && isUrgentDeadline(date, now)`
//   (mutually exclusive with isUrgent because GROUP_ON_CLOCK_STATUSES
//    and GROUP_SUBMITTED_STUCK_STATUSES don't overlap)

function computeGroupSubmittedStuck(status: string, serviceDate: string, now: Date): boolean {
  const isStuckStatus = (GROUP_SUBMITTED_STUCK_STATUSES as readonly string[]).includes(status);
  return isStuckStatus && isUrgentDeadline(serviceDate, now);
}

test("a Portal Queued group with today deadline IS submittedStuck (Task #352)", () => {
  const sd = serviceDateForDeadline(FRIDAY);
  assert.equal(
    computeGroupSubmittedStuck("Portal Queued", sd, FRIDAY),
    true,
    "Portal Queued past deadline = submitted but unconfirmed, needs a chase",
  );
});

test("a Portal Queued group with a future deadline is NOT submittedStuck (Task #352)", () => {
  const sd = serviceDateForDeadline(NEXT_MONDAY);
  assert.equal(
    computeGroupSubmittedStuck("Portal Queued", sd, FRIDAY),
    false,
    "Portal Queued with a healthy deadline is not stuck — the payor still has time to confirm",
  );
});

test("a New group with today deadline is NOT submittedStuck (Task #352)", () => {
  const sd = serviceDateForDeadline(FRIDAY);
  assert.equal(
    computeGroupSubmittedStuck("New", sd, FRIDAY),
    false,
    "New = pre-submit, goes into isUrgent tier not submittedStuck",
  );
});

// --- The two tiers are mutually exclusive at the group level

test("isUrgent and submittedStuck are mutually exclusive at the group level (Task #352)", () => {
  // All statuses that could ever have a date set:
  const allGroupStatuses = [
    ...GROUP_EXPIRING_ACTIONABLE_STATUSES,
    ...GROUP_SUBMITTED_STUCK_STATUSES,
    "Awaiting Response", "Resolved", "Denied", "Withdrawn",
  ] as const;
  const sd = serviceDateForDeadline(FRIDAY);
  for (const status of allGroupStatuses) {
    const urgent = computeGroupIsUrgent(status, sd, FRIDAY);
    const stuck = computeGroupSubmittedStuck(status, sd, FRIDAY);
    assert.ok(
      !(urgent && stuck),
      `status '${status}' cannot have both isUrgent=true and submittedStuck=true at the group level — ` +
        "the two status sets are disjoint by construction",
    );
  }
});
