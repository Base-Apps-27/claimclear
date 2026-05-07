// Unit tests for `computeGroupReadiness` introduced in Task #231.
//
// The pure helper used to back both the "Ready to package" CTA and the
// `POST /invoice-groups/:id/package` endpoint; both have been retired.
// The helper survives because its output is still attached to the group
// detail response as a passive `packagingReadiness` summary (every-leg
// worktree-done signal). These tests cover every gate (status, empty,
// unprocessed, no-contestable, ready) plus the count fields.

import { test } from "node:test";
import { strict as assert } from "node:assert";

import { computeGroupReadiness } from "../lib/group-packaging";

type LegInput = Parameters<typeof computeGroupReadiness>[1][number];

function leg(overrides: Partial<LegInput> = {}): LegInput {
  return {
    sopOutcome: null,
    holdReason: null,
    status: "Needs Evidence",
    ...overrides,
  };
}

// Helper for duplicate-flow tests: gives the leg an id so it can be a
// primary, and sets the duplicate pointer when `duplicateOf` is supplied.
function legWithId(id: number, overrides: Partial<LegInput> = {}): LegInput {
  return { ...leg(overrides), id };
}

// --- Gate 1: group status -----------------------------------------------

test("non pre-submit group → ready=false with informative reason", () => {
  for (const groupStatus of [
    "Generating Email",
    "Portal Queued",
    "Awaiting Response",
    "Ready to Review",
    "Resolved",
    "Denied",
    "On Hold",
  ]) {
    const r = computeGroupReadiness(
      { status: groupStatus },
      [leg({ sopOutcome: "portal_dispute" })],
    );
    assert.equal(r.ready, false, `status=${groupStatus} should not be packageable`);
    assert.match(r.reason, /pre-submit/i, `reason should explain why for ${groupStatus}`);
  }
});

// --- Gate 2: empty group ------------------------------------------------

test("group with zero legs → ready=false (empty invoice)", () => {
  const r = computeGroupReadiness({ status: "Needs Evidence" }, []);
  assert.equal(r.ready, false);
  assert.match(r.reason, /no legs/i);
  assert.equal(r.totalLegCount, 0);
});

// --- Gate 3: unprocessed legs -------------------------------------------

test("any unprocessed leg → ready=false with count in reason (singular)", () => {
  const r = computeGroupReadiness(
    { status: "Needs Evidence" },
    [leg({ sopOutcome: "portal_dispute" }), leg({ sopOutcome: null })],
  );
  assert.equal(r.ready, false);
  assert.match(r.reason, /1 leg/);
  assert.match(r.reason, /needs/);
  assert.equal(r.unprocessedLegCount, 1);
});

test("multiple unprocessed legs → reason uses plural form", () => {
  const r = computeGroupReadiness(
    { status: "New" },
    [leg(), leg(), leg({ sopOutcome: "portal_dispute" })],
  );
  assert.equal(r.ready, false);
  assert.match(r.reason, /2 legs/);
  assert.match(r.reason, /need/);
  assert.equal(r.unprocessedLegCount, 2);
});

// --- Gate 4: no contestable legs ----------------------------------------

test("all excluded → ready=false (nothing to dispute)", () => {
  const r = computeGroupReadiness(
    { status: "Needs Evidence" },
    [
      leg({ sopOutcome: "cannot_dispute" }),
      leg({ sopOutcome: "non_issue" }),
    ],
  );
  assert.equal(r.ready, false);
  assert.match(r.reason, /contestable/i);
  assert.equal(r.processedLegCount, 0);
  assert.equal(r.excludedLegCount, 2);
});

test("all held → ready=false (held legs are not contestable on their own)", () => {
  const r = computeGroupReadiness(
    { status: "Needs Evidence" },
    [
      leg({ holdReason: "missing_invoice" }),
      leg({ sopOutcome: "hold" }),
    ],
  );
  assert.equal(r.ready, false);
  // Held legs short-circuit before sopOutcome inspection so they are
  // not unprocessed; the failure mode is "no contestable" not "needs review".
  assert.match(r.reason, /contestable/i);
  assert.equal(r.unprocessedLegCount, 0);
  assert.equal(r.heldLegCount, 2);
});

// --- Happy path ---------------------------------------------------------

test("at least one disputed leg + everything else processed/excluded → ready", () => {
  const r = computeGroupReadiness(
    { status: "Needs Evidence" },
    [
      leg({ sopOutcome: "portal_dispute" }),
      leg({ sopOutcome: "dispute" }),
      leg({ sopOutcome: "cannot_dispute" }),
    ],
  );
  assert.equal(r.ready, true);
  assert.equal(r.reason, "Ready to package");
  assert.equal(r.processedLegCount, 2);
  assert.equal(r.excludedLegCount, 1);
  assert.equal(r.unprocessedLegCount, 0);
  assert.equal(r.heldLegCount, 0);
  assert.equal(r.totalLegCount, 3);
});

test("held legs do not block packaging when other legs are contestable", () => {
  // Critical product rule: held legs ride along, they don't block
  // the dispute. They show up in the held count but the CTA stays
  // enabled as long as there's at least one disputed leg.
  const r = computeGroupReadiness(
    { status: "New" },
    [
      leg({ sopOutcome: "portal_dispute" }),
      leg({ holdReason: "ask_payor" }),
      leg({ sopOutcome: "hold" }),
    ],
  );
  assert.equal(r.ready, true);
  assert.equal(r.heldLegCount, 2);
  assert.equal(r.processedLegCount, 1);
  assert.equal(r.unprocessedLegCount, 0);
});

test("count fields are populated even on the unhappy paths", () => {
  // Sanity: every return path should fill the count fields so the
  // UI badges always have something to render.
  const r = computeGroupReadiness(
    { status: "Awaiting Response" },
    [
      leg({ sopOutcome: "portal_dispute" }),
      leg({ sopOutcome: "cannot_dispute" }),
      leg({ holdReason: "x" }),
    ],
  );
  assert.equal(r.ready, false);
  assert.equal(r.processedLegCount, 1);
  assert.equal(r.excludedLegCount, 1);
  assert.equal(r.heldLegCount, 1);
  assert.equal(r.totalLegCount, 3);
  assert.equal(r.duplicateLegCount, 0);
  assert.equal(r.unresolvedDuplicateLegCount, 0);
});

// --- Sibling-duplicate flow ---------------------------------------------

test("duplicate blocks the gate when its primary is mid-walk", () => {
  // Primary still needs SOP review → duplicate cannot satisfy the gate
  // even though everything else (the other two legs) is processed.
  const r = computeGroupReadiness(
    { status: "Needs Evidence" },
    [
      legWithId(1, { sopOutcome: null }), // primary, mid-walk
      legWithId(2, { sopOutcome: "portal_dispute" }),
      legWithId(3, { duplicateOfClaimId: 1 }), // sibling pointing at #1
    ],
  );
  // The unprocessed primary trips Gate 3 first — the message must blame
  // worktree review, not the duplicate.
  assert.equal(r.ready, false);
  assert.match(r.reason, /worktree/i);
  assert.equal(r.unprocessedLegCount, 1, "duplicate must NOT be counted as unprocessed");
  assert.equal(r.duplicateLegCount, 1);
  assert.equal(r.unresolvedDuplicateLegCount, 1);
});

test("duplicate satisfies the gate once its primary reaches a terminal", () => {
  // Primary is processed → the sibling duplicate inherits its resolution
  // and the group is ready to package.
  const r = computeGroupReadiness(
    { status: "Needs Evidence" },
    [
      legWithId(1, { sopOutcome: "portal_dispute" }), // primary terminal
      legWithId(2, { duplicateOfClaimId: 1 }), // sibling
    ],
  );
  assert.equal(r.ready, true);
  assert.equal(r.reason, "Ready to package");
  assert.equal(r.processedLegCount, 1);
  assert.equal(r.duplicateLegCount, 1);
  assert.equal(r.unresolvedDuplicateLegCount, 0);
  // Duplicates do NOT inflate `processedLegCount` — only the primary is
  // counted as contestable; the duplicate just rides along in the rollup.
});

test("duplicate also satisfies the gate when the primary is excluded", () => {
  // Edge case: an operator marks a sibling as duplicate, then the primary
  // gets dropped (cannot_dispute). Per spec the duplicate's gate is iff
  // primary ∈ {ready, dropped, excluded} so dropped counts. But the gate
  // still fails Gate 4 because there are zero contestable legs.
  const r = computeGroupReadiness(
    { status: "Needs Evidence" },
    [
      legWithId(1, { sopOutcome: "cannot_dispute" }),
      legWithId(2, { duplicateOfClaimId: 1 }),
    ],
  );
  assert.equal(r.unresolvedDuplicateLegCount, 0, "duplicate is resolved (primary is excluded)");
  assert.equal(r.ready, false, "but Gate 4 fails — nothing to dispute");
  assert.match(r.reason, /contestable/i);
});

test("gate re-locks if the primary is reclassified back to mid-walk", () => {
  // Initial state: primary terminal, dup resolved, ready=true.
  const initial = computeGroupReadiness(
    { status: "Needs Evidence" },
    [
      legWithId(1, { sopOutcome: "portal_dispute" }),
      legWithId(2, { duplicateOfClaimId: 1 }),
    ],
  );
  assert.equal(initial.ready, true);

  // Operator reclassifies the primary back; sopOutcome cleared.
  const after = computeGroupReadiness(
    { status: "Needs Evidence" },
    [
      legWithId(1, { sopOutcome: null }),
      legWithId(2, { duplicateOfClaimId: 1 }),
    ],
  );
  assert.equal(after.ready, false);
  assert.equal(after.unresolvedDuplicateLegCount, 1);
});

test("multiple duplicates pointing at the same primary all resolve together", () => {
  const r = computeGroupReadiness(
    { status: "Needs Evidence" },
    [
      legWithId(1, { sopOutcome: "portal_dispute" }),
      legWithId(2, { duplicateOfClaimId: 1 }),
      legWithId(3, { duplicateOfClaimId: 1 }),
      legWithId(4, { duplicateOfClaimId: 1 }),
    ],
  );
  assert.equal(r.ready, true);
  assert.equal(r.duplicateLegCount, 3);
  assert.equal(r.unresolvedDuplicateLegCount, 0);
});

test("duplicate-only reason fires when worktree is otherwise complete", () => {
  // All non-duplicate legs are processed/excluded but a duplicate's primary
  // is on hold — Gate 3b should bite and the message must mention
  // siblings (not worktree review).
  const r = computeGroupReadiness(
    { status: "Needs Evidence" },
    [
      legWithId(1, { holdReason: "evidence_pending" }), // primary on hold
      legWithId(2, { sopOutcome: "portal_dispute" }),
      legWithId(3, { duplicateOfClaimId: 1 }),
    ],
  );
  assert.equal(r.ready, false);
  assert.match(r.reason, /sibling|duplicate/i);
  assert.equal(r.unresolvedDuplicateLegCount, 1);
});

// --- Wave C: disposition column drives bucketing ------------------------
//
// These tests pin the canonical Wave-C+ read path: when a leg carries a
// non-default `disposition`, that column — NOT the legacy `sopOutcome`
// — decides which bucket it lands in. The mapping is fixed by
// `DISPOSITION_TO_SUB_STATUS` in `lib/leg-state/src/per-leg-sub-status.ts`:
//
//   disposed_portal / disposed_email     → processed (dispute)
//   disposed_withdraw / disposed_nonissue → excluded
//   blocked                              → held
//   anything else (awaiting_review, verdict_*, attest_*, …) → unprocessed
//
// Legacy fields are intentionally cleared (sopOutcome: null) on the
// fixtures below so the test fails if the helper accidentally falls
// through to the legacy ladder.

test("disposed_portal / disposed_email count as processed (dispute)", () => {
  const r = computeGroupReadiness(
    { status: "Needs Evidence" },
    [
      leg({ disposition: "disposed_portal", sopOutcome: null }),
      leg({ disposition: "disposed_email", sopOutcome: null }),
    ],
  );
  assert.equal(r.ready, true);
  assert.equal(r.processedLegCount, 2);
  assert.equal(r.excludedLegCount, 0);
  assert.equal(r.heldLegCount, 0);
  assert.equal(r.unprocessedLegCount, 0);
});

test("disposed_withdraw / disposed_nonissue count as excluded", () => {
  const r = computeGroupReadiness(
    { status: "Needs Evidence" },
    [
      leg({ disposition: "disposed_withdraw", sopOutcome: null }),
      leg({ disposition: "disposed_nonissue", sopOutcome: null }),
    ],
  );
  assert.equal(r.ready, false);
  assert.match(r.reason, /contestable/i);
  assert.equal(r.processedLegCount, 0);
  assert.equal(r.excludedLegCount, 2);
});

test("disposition='blocked' counts as held (mirror of legacy sopOutcome='hold')", () => {
  const r = computeGroupReadiness(
    { status: "Needs Evidence" },
    [
      leg({ disposition: "blocked", sopOutcome: null }),
      leg({ disposition: "disposed_portal", sopOutcome: null }),
    ],
  );
  // Held leg rides along; the dispute leg satisfies Gate 4.
  assert.equal(r.ready, true);
  assert.equal(r.heldLegCount, 1);
  assert.equal(r.processedLegCount, 1);
  assert.equal(r.unprocessedLegCount, 0);
});

test("non-terminal dispositions count as unprocessed (still owe worktree review)", () => {
  for (const d of [
    "awaiting_review",
    "verdict_drafted",
    "verdict_approved",
    "verdict_denied",
    "verdict_partial",
    "attest_pending",
    "classifying",
  ]) {
    const r = computeGroupReadiness(
      { status: "Needs Evidence" },
      [
        leg({ disposition: d, sopOutcome: null }),
        leg({ disposition: "disposed_portal", sopOutcome: null }),
      ],
    );
    assert.equal(r.ready, false, `disposition=${d} should still be unprocessed`);
    assert.match(r.reason, /worktree/i);
    assert.equal(r.unprocessedLegCount, 1, `disposition=${d}`);
  }
});

test("disposition='unclassified' falls through to the legacy ladder", () => {
  // The default disposition value is 'unclassified'; in that case the
  // helper must read sopOutcome instead so in-flight rows whose writer
  // hasn't synced disposition yet still bucket correctly.
  const r = computeGroupReadiness(
    { status: "Needs Evidence" },
    [
      leg({ disposition: "unclassified", sopOutcome: "portal_dispute" }),
      leg({ disposition: "unclassified", sopOutcome: "cannot_dispute" }),
    ],
  );
  assert.equal(r.ready, true);
  assert.equal(r.processedLegCount, 1);
  assert.equal(r.excludedLegCount, 1);
});

test("disposition takes precedence over a divergent legacy sopOutcome", () => {
  // If both columns are populated and they disagree, the canonical
  // disposition column wins. This shouldn't happen in production (the
  // 0034/0035 trigger keeps them in sync) but pinning the precedence
  // here means a future drift bug shows up here, not in a hot path.
  const r = computeGroupReadiness(
    { status: "Needs Evidence" },
    [
      // disposition says dispute, legacy says exclude → dispute wins
      leg({ disposition: "disposed_portal", sopOutcome: "cannot_dispute" }),
      // disposition says exclude, legacy says dispute → exclude wins
      leg({ disposition: "disposed_nonissue", sopOutcome: "portal_dispute" }),
    ],
  );
  assert.equal(r.processedLegCount, 1);
  assert.equal(r.excludedLegCount, 1);
});

test("duplicate primary resolution honours disposition", () => {
  // Primary's terminal disposition should resolve its sibling's gate
  // contribution exactly the same way a terminal sopOutcome does.
  const r = computeGroupReadiness(
    { status: "Needs Evidence" },
    [
      legWithId(1, { disposition: "disposed_portal", sopOutcome: null }),
      legWithId(2, { duplicateOfClaimId: 1 }),
    ],
  );
  assert.equal(r.ready, true);
  assert.equal(r.duplicateLegCount, 1);
  assert.equal(r.unresolvedDuplicateLegCount, 0);
});

test("duplicate primary mid-walk via disposition still blocks the gate", () => {
  const r = computeGroupReadiness(
    { status: "Needs Evidence" },
    [
      legWithId(1, { disposition: "awaiting_review", sopOutcome: null }),
      legWithId(2, { disposition: "disposed_portal", sopOutcome: null }),
      legWithId(3, { duplicateOfClaimId: 1 }),
    ],
  );
  assert.equal(r.ready, false);
  // Primary's awaiting_review trips Gate 3 first.
  assert.match(r.reason, /worktree/i);
  assert.equal(r.unprocessedLegCount, 1, "duplicate must NOT be counted as unprocessed");
  assert.equal(r.unresolvedDuplicateLegCount, 1);
});
