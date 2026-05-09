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

test("group-outcome: empty / all-excluded → Withdrawn", () => {
  assert.equal(deriveGroupOutcomeFromLegs([]).outcome, "Withdrawn");
  const allExcluded = [
    leg({ id: 1, includedInDispute: false }),
    leg({ id: 2, includedInDispute: false }),
  ];
  assert.equal(deriveGroupOutcomeFromLegs(allExcluded).outcome, "Withdrawn");
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

test("group-outcome: only non_issue rows → Withdrawn", () => {
  const result = deriveGroupOutcomeFromLegs([
    leg({ id: 1, sopOutcome: "non_issue" }),
    leg({ id: 2, sopOutcome: "non_issue" }),
  ]);
  assert.equal(result.outcome, "Withdrawn");
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
