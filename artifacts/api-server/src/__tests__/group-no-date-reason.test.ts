// Branch coverage for `classifyGroupServiceDateReason` (Task #353).
//
// The helper is the single source of truth for the labeled empty state
// the Invoice Groups list and the group detail page render in place of
// the legacy em-dash. Each test below pins one enum branch — the one
// that's hardest to hit in a black-box DB test (`all_dated_legs_excluded`)
// gets explicit coverage so a regression flips this suite, not a UI
// snapshot.

import { test } from "node:test";
import { strict as assert } from "node:assert";

import {
  classifyGroupServiceDateReason,
  type ServiceDateReasonLeg,
} from "../lib/group-no-date-reason";

function leg(overrides: Partial<ServiceDateReasonLeg> = {}): ServiceDateReasonLeg {
  return {
    date: null,
    includedInDispute: true,
    duplicateOfClaimId: null,
    ...overrides,
  };
}

test("has_date: stored service_date is non-null → short-circuits regardless of leg shape", () => {
  // Even a group with zero children classifies as has_date when the
  // stored column has a value (defensive — the recompute helper should
  // have nulled it, but the row is the source of truth for the cell).
  assert.equal(
    classifyGroupServiceDateReason("2026-04-15", []),
    "has_date",
  );
  assert.equal(
    classifyGroupServiceDateReason("2026-04-15", [
      leg({ date: "2026-04-02" }),
      leg({ date: null }),
    ]),
    "has_date",
  );
});

test("no_claims: stored date is null AND zero children", () => {
  assert.equal(classifyGroupServiceDateReason(null, []), "no_claims");
  assert.equal(classifyGroupServiceDateReason(undefined, []), "no_claims");
  assert.equal(classifyGroupServiceDateReason("", []), "no_claims");
});

test("no_dated_claims: every child's `date` is blank", () => {
  assert.equal(
    classifyGroupServiceDateReason(null, [
      leg({ date: null }),
      leg({ date: "" }),
      leg({ date: "   " }),
    ]),
    "no_dated_claims",
  );
});

test("parse_failed: every dated child fails normalizeServiceDate", () => {
  // Effectively unreachable now that claims.date is a typed DATE column,
  // but the branch exists so a regression that brings TEXT back surfaces
  // as a labeled state instead of falling through to a generic dash.
  assert.equal(
    classifyGroupServiceDateReason(null, [
      leg({ date: "not a date" }),
      leg({ date: "2026/05/01" }), // wrong separator → unparseable
      leg({ date: "May 1 2026" }), // wrong shape → unparseable
    ]),
    "parse_failed",
  );
});

test("all_dated_legs_excluded: every dated, parseable leg is excluded or duplicate", () => {
  // The case the task spec calls out by name. Each leg has a real,
  // parseable date, but `includedInDispute=false` or `duplicateOfClaimId`
  // is set on every one of them. The operator-meaningful state is
  // "all dated legs are excluded" — a different action than "no claims"
  // or "no dated claims".
  assert.equal(
    classifyGroupServiceDateReason(null, [
      leg({ date: "2026-04-02", includedInDispute: false }),
      leg({ date: "2026-04-15", duplicateOfClaimId: 99 }),
      // Blank-date legs don't change the conclusion: we only consider
      // the dated ones when picking this branch.
      leg({ date: null }),
    ]),
    "all_dated_legs_excluded",
  );
});

test("all_dated_legs_excluded: mixes the two excluded paths", () => {
  // A group with one excluded leg and one duplicate-of leg, both dated:
  // still resolves to all_dated_legs_excluded.
  assert.equal(
    classifyGroupServiceDateReason(null, [
      leg({ date: "2026-04-02", includedInDispute: false }),
      leg({ date: "2026-04-15", duplicateOfClaimId: 7 }),
    ]),
    "all_dated_legs_excluded",
  );
});

test("fallback no_dated_claims: at least one parseable, included leg but stored date null (drift)", () => {
  // This shape shouldn't occur in production — the recompute helper
  // would have written a value — but if a write path skipped the
  // recompute we still want a meaningful label. Falls through to
  // no_dated_claims because that's the closest operator-actionable
  // hint (re-import / re-classify the leg).
  assert.equal(
    classifyGroupServiceDateReason(null, [
      leg({ date: "2026-04-02", includedInDispute: true }),
    ]),
    "no_dated_claims",
  );
});

test("idempotent: same input → same output, regardless of leg ordering", () => {
  const a: ServiceDateReasonLeg[] = [
    leg({ date: "2026-04-02", includedInDispute: false }),
    leg({ date: "2026-04-15", duplicateOfClaimId: 99 }),
    leg({ date: null }),
  ];
  const first = classifyGroupServiceDateReason(null, a);
  const second = classifyGroupServiceDateReason(null, a);
  const reversed = classifyGroupServiceDateReason(null, [...a].reverse());
  assert.equal(first, "all_dated_legs_excluded");
  assert.equal(second, "all_dated_legs_excluded");
  assert.equal(reversed, "all_dated_legs_excluded");
});
