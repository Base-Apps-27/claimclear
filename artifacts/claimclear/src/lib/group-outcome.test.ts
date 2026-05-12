// Task #555 — invariants for the per-leg → group outcome roll-up.
//
// The detail page (and any other macro-workflow surface) is required
// to read this helper instead of the stored `invoice_groups.outcome`
// column, so the buckets must be exhaustively pinned. Sibling-
// duplicate legs and excluded legs are filtered out by the helper —
// they don't represent operator-actionable claims.
import { test } from "node:test";
import { strict as assert } from "node:assert";
import type { ClaimResponse } from "@workspace/api-client-react";
import { deriveGroupOutcomeFromLegs } from "./group-outcome";

function leg(over: Partial<ClaimResponse> & { id: number }): ClaimResponse {
  return {
    confNumber: `CLM-${over.id}`,
    status: "New",
    outcome: null,
    includedInDispute: true,
    duplicateOfClaimId: null,
    sopOutcome: null,
    errorTypeId: null,
    holdReason: null,
    latestVerdict: null,
    latestDraft: null,
    ...over,
  } as unknown as ClaimResponse;
}

const confirmedVerdict = (outcome: string) => ({
  source: "operator_confirmed" as const,
  outcome,
  createdAt: "2026-01-01T00:00:00Z",
});

test("group-outcome: empty / all-excluded-without-verdict → Withdrawn", () => {
  assert.equal(deriveGroupOutcomeFromLegs([]).outcome, "Withdrawn");
  const allExcludedWithoutVerdict = [
    leg({ id: 1, includedInDispute: false }),
    leg({ id: 2, includedInDispute: false }),
  ];
  assert.equal(
    deriveGroupOutcomeFromLegs(allExcludedWithoutVerdict).outcome,
    "Withdrawn",
  );
});

test("group-outcome: all-excluded with non-issue verdict → No Action Needed", () => {
  // Group 519 in production: every leg per-leg-classified as
  // non-issue (sop_outcome=non_issue, included_in_dispute=false).
  // The invoice was already attested correctly — this is NOT a
  // withdrawal.
  const allNonIssueExcluded = [
    leg({ id: 1, includedInDispute: false, sopOutcome: "non_issue" }),
    leg({ id: 2, includedInDispute: false, sopOutcome: "non_issue" }),
    leg({ id: 3, includedInDispute: false, sopOutcome: "non_issue" }),
    leg({ id: 4, includedInDispute: false, sopOutcome: "non_issue" }),
  ];
  const result = deriveGroupOutcomeFromLegs(allNonIssueExcluded);
  assert.equal(result.outcome, "No Action Needed");
  assert.equal(result.buckets.nonIssue, 4);
  assert.equal(result.buckets.total, 4);
});

test("group-outcome: any unresolved leg → Pending", () => {
  const result = deriveGroupOutcomeFromLegs([
    leg({ id: 1, latestVerdict: confirmedVerdict("Approved") } as Partial<ClaimResponse> & { id: number }),
    leg({ id: 2 }), // no verdict, no SOP outcome → pending
  ]);
  assert.equal(result.outcome, "Pending");
  assert.equal(result.buckets.pending, 1);
  assert.equal(result.buckets.approved, 1);
});

test("group-outcome: all approved → Approved", () => {
  const result = deriveGroupOutcomeFromLegs([
    leg({ id: 1, latestVerdict: confirmedVerdict("Approved") } as Partial<ClaimResponse> & { id: number }),
    leg({ id: 2, latestVerdict: confirmedVerdict("Partially Approved") } as Partial<ClaimResponse> & { id: number }),
  ]);
  assert.equal(result.outcome, "Approved");
});

test("group-outcome: approved + denied mix → Partially Approved", () => {
  const result = deriveGroupOutcomeFromLegs([
    leg({ id: 1, latestVerdict: confirmedVerdict("Approved") } as Partial<ClaimResponse> & { id: number }),
    leg({ id: 2, latestVerdict: confirmedVerdict("Denied") } as Partial<ClaimResponse> & { id: number }),
  ]);
  assert.equal(result.outcome, "Partially Approved");
});

test("group-outcome: approved + cannot_dispute → Partially Approved", () => {
  const result = deriveGroupOutcomeFromLegs([
    leg({ id: 1, latestVerdict: confirmedVerdict("Approved") } as Partial<ClaimResponse> & { id: number }),
    leg({ id: 2, sopOutcome: "cannot_dispute" }),
  ]);
  assert.equal(result.outcome, "Partially Approved");
  assert.equal(result.buckets.cannotDispute, 1);
});

test("group-outcome: only denied / cannot_dispute → Denied", () => {
  const result = deriveGroupOutcomeFromLegs([
    leg({ id: 1, latestVerdict: confirmedVerdict("Denied") } as Partial<ClaimResponse> & { id: number }),
    leg({ id: 2, sopOutcome: "cannot_dispute" }),
  ]);
  assert.equal(result.outcome, "Denied");
});

test("group-outcome: all-excluded with cannot_dispute verdict → Denied", () => {
  // Symmetric to the all-non-issue case: every leg per-leg-classified
  // as cannot_dispute (excluded from the dispute, but with a meaningful
  // per-leg verdict). The "Denied" rollup matches an all-cannot_dispute
  // group where the legs were never excluded.
  const allCannotDisputeExcluded = [
    leg({ id: 1, includedInDispute: false, sopOutcome: "cannot_dispute" }),
    leg({ id: 2, includedInDispute: false, sopOutcome: "cannot_dispute" }),
  ];
  const result = deriveGroupOutcomeFromLegs(allCannotDisputeExcluded);
  assert.equal(result.outcome, "Denied");
  assert.equal(result.buckets.cannotDispute, 2);
});

test("group-outcome: mixed non_issue + cannot_dispute (both excluded) → Denied", () => {
  // Any cannot_dispute presence wins over non_issue in the rollup
  // (the group still has a "we couldn't dispute" bucket so it lands
  // on the Denied side, not the No Action Needed side).
  const mixed = [
    leg({ id: 1, includedInDispute: false, sopOutcome: "non_issue" }),
    leg({ id: 2, includedInDispute: false, sopOutcome: "cannot_dispute" }),
  ];
  const result = deriveGroupOutcomeFromLegs(mixed);
  assert.equal(result.outcome, "Denied");
  assert.equal(result.buckets.nonIssue, 1);
  assert.equal(result.buckets.cannotDispute, 1);
});

test("group-outcome: only non_issue rows → No Action Needed", () => {
  // Per-leg classification finished and every leg is non-issue. The
  // invoice didn't need work; this is NOT a withdrawal.
  const result = deriveGroupOutcomeFromLegs([
    leg({ id: 1, sopOutcome: "non_issue" }),
    leg({ id: 2, sopOutcome: "non_issue" }),
  ]);
  assert.equal(result.outcome, "No Action Needed");
  assert.equal(result.buckets.nonIssue, 2);
});

test("group-outcome: sibling duplicates + excluded rows are filtered out", () => {
  const result = deriveGroupOutcomeFromLegs([
    leg({ id: 1, latestVerdict: confirmedVerdict("Approved") } as Partial<ClaimResponse> & { id: number }),
    leg({ id: 2, duplicateOfClaimId: 1 }), // sibling-duplicate → ignored
    leg({ id: 3, includedInDispute: false }), // excluded → ignored
  ]);
  assert.equal(result.outcome, "Approved");
  assert.equal(result.buckets.total, 1);
});
