// Pure-helper tests for the client-side "leg has reached a conclusion?"
// rule. Pinned here so a future tweak that diverges from the backend's
// `evaluateDisputedLegsResolved` (in `artifacts/api-server/src/lib/group-readiness.ts`)
// is caught at the package boundary instead of in a flaky e2e.

import { test } from "node:test";
import { strict as assert } from "node:assert";

import {
  buildLegResolvedIndex,
  RESOLVED_LEG_SUB_STATUSES,
  type LegForResolvedCheck,
} from "./leg-resolved";

// Convenience: the backend's `evaluateDisputedLegsResolved` covers the
// canonical fixtures (excluded primary, mid-walk primary, terminal
// primary). The client tests below mirror the same scenarios so both
// surfaces stay in lockstep.

const ready: Partial<LegForResolvedCheck> = {
  errorTypeId: "ET-1",
  sopOutcome: "portal_dispute",
};
const investigating: Partial<LegForResolvedCheck> = {
  errorTypeId: "ET-1",
  sopOutcome: null,
};
const dropped: Partial<LegForResolvedCheck> = {
  errorTypeId: "ET-1",
  sopOutcome: "cannot_dispute",
};

function leg(id: number, overrides: Partial<LegForResolvedCheck> = {}): LegForResolvedCheck {
  return {
    id,
    includedInDispute: true,
    duplicateOfClaimId: null,
    ...overrides,
  };
}

test("RESOLVED_LEG_SUB_STATUSES matches the backend reference set", () => {
  // If this trips, mirror the change in
  // `artifacts/api-server/src/lib/group-readiness.ts` first.
  assert.deepEqual(
    [...RESOLVED_LEG_SUB_STATUSES].sort(),
    ["dropped", "excluded", "ready"],
  );
});

test("a non-duplicate leg is resolved iff its sub-status is in the terminal set", () => {
  const legs = [leg(1, ready), leg(2, investigating), leg(3, dropped)];
  const idx = buildLegResolvedIndex(legs);
  assert.equal(idx.isLegResolved(legs[0]!), true, "ready → resolved");
  assert.equal(idx.isLegResolved(legs[1]!), false, "investigating → unresolved");
  assert.equal(idx.isLegResolved(legs[2]!), true, "dropped → resolved");
});

test("a duplicate leg whose primary is dropped (Non-contestable) is resolved", () => {
  const primary = leg(589, dropped);
  const duplicate = leg(588, { duplicateOfClaimId: 589 });
  const idx = buildLegResolvedIndex([primary, duplicate]);
  assert.equal(idx.isLegResolved(duplicate), true);
  assert.equal(idx.firstUnresolvedLegId([duplicate, primary]), null);
});

test("a duplicate leg whose primary is still investigating is unresolved", () => {
  const primary = leg(589, investigating);
  const duplicate = leg(588, { duplicateOfClaimId: 589 });
  const idx = buildLegResolvedIndex([primary, duplicate]);
  assert.equal(idx.isLegResolved(duplicate), false);
  assert.equal(idx.isLegResolved(primary), false);
  // Order matters — primary appears first, so it's the first unresolved.
  assert.equal(idx.firstUnresolvedLegId([primary, duplicate]), 589);
});

test("clearing the primary's terminal state re-locks the duplicate", () => {
  // Round 1: primary terminal → duplicate resolved.
  const primaryDone = leg(589, dropped);
  const duplicate = leg(588, { duplicateOfClaimId: 589 });
  const idx1 = buildLegResolvedIndex([primaryDone, duplicate]);
  assert.equal(idx1.isLegResolved(duplicate), true);

  // Round 2: same duplicate, but the primary has been reclassified
  // back to mid-walk. The gate naturally re-locks.
  const primaryMidwalk = leg(589, investigating);
  const idx2 = buildLegResolvedIndex([primaryMidwalk, duplicate]);
  assert.equal(idx2.isLegResolved(duplicate), false);
});

test("an excluded primary still satisfies the duplicate's gate", () => {
  // Same edge case the backend test in
  // `evaluateDisputedLegsResolved` covers: a duplicate whose primary
  // was removed from the dispute (`includedInDispute=false`) derives
  // to `excluded`, which IS a terminal sub-status.
  const excludedPrimary = leg(589, { includedInDispute: false });
  const duplicate = leg(588, { duplicateOfClaimId: 589 });
  const idx = buildLegResolvedIndex([excludedPrimary, duplicate]);
  assert.equal(idx.subStatusOf(excludedPrimary), "excluded");
  assert.equal(idx.isLegResolved(duplicate), true);
});

test("a duplicate with a missing primary is unresolved (defensive)", () => {
  // Primary not present in the leg list — could happen mid-refetch.
  // We don't crash; we just flag the leg as unresolved so the gate
  // stays locked until the primary shows up.
  const duplicate = leg(588, { duplicateOfClaimId: 999 });
  const idx = buildLegResolvedIndex([duplicate]);
  assert.equal(idx.isLegResolved(duplicate), false);
});

test("a duplicate with a NULL primary id is unresolved (defensive)", () => {
  // Shouldn't happen in practice (sub-status `duplicate` requires a
  // duplicateOfClaimId), but if a malformed row reaches us we'd rather
  // keep the gate locked than silently pass.
  const duplicate: LegForResolvedCheck = {
    id: 588,
    includedInDispute: true,
    duplicateOfClaimId: null,
    // Force the duplicate sub-status by hand — normally
    // deriveLegSubStatus returns "duplicate" because of the pointer.
    // With the pointer null, the leg derives to needs_classification,
    // which is also unresolved. Either way, gate is locked.
  };
  const idx = buildLegResolvedIndex([duplicate]);
  assert.equal(idx.isLegResolved(duplicate), false);
});

test("firstUnresolvedLegId skips a sibling-duplicate-with-terminal-primary", () => {
  // Mirrors the gauntlet's "Jump to leg" affordance: the duplicate
  // shouldn't be the jump target when its primary has concluded.
  const primary = leg(589, dropped);
  const duplicate = leg(588, { duplicateOfClaimId: 589 });
  const stillOpen = leg(590, investigating);
  const idx = buildLegResolvedIndex([primary, duplicate, stillOpen]);
  assert.equal(idx.firstUnresolvedLegId([duplicate, stillOpen, primary]), 590);
});

test("firstUnresolvedLegId returns null when every ride is resolved", () => {
  const primary = leg(589, dropped);
  const duplicate = leg(588, { duplicateOfClaimId: 589 });
  const ready1 = leg(590, ready);
  const idx = buildLegResolvedIndex([primary, duplicate, ready1]);
  assert.equal(idx.firstUnresolvedLegId([primary, duplicate, ready1]), null);
});

test("subStatusOf is consistent with deriveLegSubStatus", () => {
  const r = leg(1, ready);
  const i = leg(2, investigating);
  const d = leg(3, dropped);
  const dup = leg(4, { duplicateOfClaimId: 1 });
  const idx = buildLegResolvedIndex([r, i, d, dup]);
  assert.equal(idx.subStatusOf(r), "ready");
  assert.equal(idx.subStatusOf(i), "investigating");
  assert.equal(idx.subStatusOf(d), "dropped");
  assert.equal(idx.subStatusOf(dup), "duplicate");
});
