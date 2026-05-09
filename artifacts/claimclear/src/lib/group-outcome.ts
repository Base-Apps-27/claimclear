// Compute an invoice group's outcome from per-leg verdicts.
//
// Per Task #555 / per-invoice-transition.md the page MUST NOT read the
// stored `invoice_groups.outcome` column for display — that field can
// drift behind per-leg edits and the operator should always see the
// computed verdict that matches the leg rail above it.
//
// The helper is colocated with `lib/lifecycle-phase.ts` so every
// macro-workflow surface (detail page, queue card, response review)
// imports the same source of truth. The buckets it consumes
// (`legVerdictBucket` + `outcomeRole`) are the same ones the per-leg
// picker writes through.
//
// Bucketing rules — applied to actionable legs only (sibling-duplicate
// legs follow their primary; legs with `includedInDispute === false`
// are excluded by the operator):
//
//   1. If the leg has an Approved/Partially-Approved verdict → approved
//   2. Else if the leg has a Denied verdict                  → denied
//   3. Else map by closure role:
//        cannot_dispute → cannotDispute (group as "denied side", $0 recovery)
//        non_issue      → nonIssue      (group as "withdrawn side")
//        anything else  → pending
//
// Group rollup (in priority order — first match wins):
//   - any pending                                    → "Pending"
//   - approved > 0 AND no denied/cannotDispute       → "Approved"
//   - approved > 0 AND some denied/cannotDispute     → "Partially Approved"
//   - denied > 0 OR cannotDispute > 0                → "Denied"
//   - only nonIssue (or no actionable legs)          → "Withdrawn"
//   - empty fallback                                 → "Pending"
import type { ClaimResponse } from "@workspace/api-client-react";
import type { Outcome } from "@workspace/vocab";
import { outcomeRole } from "@workspace/leg-state";
import { isActionableLeg, legVerdictBucket } from "./whats-next-derivation";

export interface GroupOutcomeBuckets {
  approved: number;
  denied: number;
  cannotDispute: number;
  nonIssue: number;
  pending: number;
  /** Total actionable legs considered (post-exclusion, post-duplicate-filter). */
  total: number;
}

export interface DerivedGroupOutcome {
  outcome: Outcome;
  buckets: GroupOutcomeBuckets;
}

export function deriveGroupOutcomeFromLegs(
  legs: readonly ClaimResponse[],
): DerivedGroupOutcome {
  const actionable = legs.filter(isActionableLeg);
  const buckets: GroupOutcomeBuckets = {
    approved: 0,
    denied: 0,
    cannotDispute: 0,
    nonIssue: 0,
    pending: 0,
    total: actionable.length,
  };
  for (const leg of actionable) {
    const verdict = legVerdictBucket(leg);
    if (verdict === "approved") {
      buckets.approved += 1;
      continue;
    }
    if (verdict === "denied") {
      buckets.denied += 1;
      continue;
    }
    const role = outcomeRole(leg);
    if (role === "cannot_dispute") {
      buckets.cannotDispute += 1;
    } else if (role === "non_issue") {
      buckets.nonIssue += 1;
    } else {
      buckets.pending += 1;
    }
  }

  let outcome: Outcome;
  if (buckets.pending > 0) {
    outcome = "Pending";
  } else if (
    buckets.approved > 0 &&
    buckets.denied === 0 &&
    buckets.cannotDispute === 0
  ) {
    outcome = "Approved";
  } else if (buckets.approved > 0) {
    outcome = "Partially Approved";
  } else if (buckets.denied > 0 || buckets.cannotDispute > 0) {
    outcome = "Denied";
  } else if (buckets.nonIssue > 0 || buckets.total === 0) {
    outcome = "Withdrawn";
  } else {
    outcome = "Pending";
  }
  return { outcome, buckets };
}
