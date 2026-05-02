// Unit tests for the pure portion of the portal-submission "all legs
// resolved" gate (`evaluateDisputedLegsResolved`). The thing that's easy
// to get wrong here is the duplicate→excluded-primary case: an excluded
// primary has `includedInDispute=false`, so a naive "only look at
// disputed legs" map will lose the primary entirely and falsely treat
// the duplicate as unresolved. These tests pin that contract.

import { test } from "node:test";
import { strict as assert } from "node:assert";

import { evaluateDisputedLegsResolved } from "../lib/group-readiness";

// Minimal row shape — only the fields the function reads. We extend
// loosely so the test rows satisfy the structural type.
type Row = {
  id: number;
  includedInDispute: boolean | null;
  duplicateOfClaimId: number | null;
  errorTypeId?: string | null;
  holdReason?: string | null;
  sopOutcome?: string | null;
};

function legRow(overrides: Partial<Row> & { id: number }): Row {
  return {
    includedInDispute: true,
    duplicateOfClaimId: null,
    errorTypeId: "ET-1",
    holdReason: null,
    sopOutcome: "portal_dispute",
    ...overrides,
  };
}

test("happy path: every disputed leg terminal → ok", () => {
  const r = evaluateDisputedLegsResolved([
    legRow({ id: 1, sopOutcome: "portal_dispute" }),
    legRow({ id: 2, sopOutcome: "dispute" }),
  ]);
  assert.deepEqual(r, { ok: true, unresolved: 0 });
});

test("a disputed leg mid-walk → not ok", () => {
  const r = evaluateDisputedLegsResolved([
    legRow({ id: 1, sopOutcome: "portal_dispute" }),
    legRow({ id: 2, sopOutcome: null }), // investigating
  ]);
  assert.equal(r.ok, false);
  assert.equal(r.unresolved, 1);
});

test("zero disputed legs → not ok (nothing to submit)", () => {
  const r = evaluateDisputedLegsResolved([
    legRow({ id: 1, includedInDispute: false, sopOutcome: "cannot_dispute" }),
  ]);
  assert.equal(r.ok, false);
});

// --- The duplicate-resolution regression -------------------------------

test("duplicate is RESOLVED when its primary is excluded (regression)", () => {
  // Primary is excluded → `includedInDispute=false`. A naive "build map
  // from disputed only" implementation drops the primary and counts the
  // duplicate as unresolved. We expect ok=true here.
  const r = evaluateDisputedLegsResolved([
    legRow({ id: 1, includedInDispute: false, sopOutcome: "cannot_dispute" }),
    legRow({ id: 2, duplicateOfClaimId: 1, sopOutcome: null }),
  ]);
  assert.deepEqual(r, { ok: true, unresolved: 0 });
});

test("duplicate is RESOLVED when primary is dropped (cannot_dispute, in-dispute)", () => {
  const r = evaluateDisputedLegsResolved([
    legRow({ id: 1, sopOutcome: "cannot_dispute" }), // dropped, still in dispute
    legRow({ id: 2, duplicateOfClaimId: 1 }),
  ]);
  assert.deepEqual(r, { ok: true, unresolved: 0 });
});

test("duplicate is UNRESOLVED when its primary is mid-walk", () => {
  const r = evaluateDisputedLegsResolved([
    legRow({ id: 1, sopOutcome: null }), // investigating
    legRow({ id: 2, duplicateOfClaimId: 1 }),
  ]);
  assert.equal(r.ok, false);
  assert.equal(r.unresolved, 2, "primary AND duplicate are both unresolved");
});

test("duplicate pointing at a non-existent primary id → unresolved (defensive)", () => {
  const r = evaluateDisputedLegsResolved([
    legRow({ id: 2, duplicateOfClaimId: 999 }),
  ]);
  assert.equal(r.ok, false);
  assert.equal(r.unresolved, 1);
});

test("excluded leg never counts toward 'unresolved'", () => {
  const r = evaluateDisputedLegsResolved([
    legRow({ id: 1, sopOutcome: "portal_dispute" }), // resolved
    legRow({ id: 2, includedInDispute: false, sopOutcome: null }), // excluded mid-walk — fine
  ]);
  assert.deepEqual(r, { ok: true, unresolved: 0 });
});
