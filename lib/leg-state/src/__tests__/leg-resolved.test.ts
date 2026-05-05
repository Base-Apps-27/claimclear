// Pure-helper tests for the shared "is this leg concluded?" rule. Both
// the React client (queue per-leg row + submission gauntlet) and the
// api-server's portal-submission gate consume this same module, so a
// regression here trips the package-level CI before either surface
// gets a chance to drift. (Companion fixture coverage:
// `artifacts/api-server/src/__tests__/disputed-legs-resolved.test.ts`,
// which exercises the gate aggregator built on top of this helper.)

import { test } from "node:test";
import { strict as assert } from "node:assert";

import {
  buildLegResolvedIndex,
  RESOLVED_LEG_SUB_STATUSES,
  type LegForResolvedCheck,
} from "../leg-resolved";

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

test("RESOLVED_LEG_SUB_STATUSES is exactly {ready, dropped, excluded}", () => {
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
  // A duplicate whose primary was removed from the dispute
  // (`includedInDispute=false`) derives to `excluded`, which IS a
  // terminal sub-status. The companion api-server test
  // (`disputed-legs-resolved.test.ts`) pins the same regression.
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
