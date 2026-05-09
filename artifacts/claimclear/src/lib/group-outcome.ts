// Per-invoice (group) outcome derivation — re-export shim.
//
// The implementation now lives in `@workspace/leg-state` so the same
// helper is reused by Group Detail, the Insights page, AND the
// api-server dashboard rollups (Task #563). The frontend keeps this
// shim so existing imports (`@/lib/group-outcome`) keep working
// without ripple-edit churn.
import type { ClaimResponse } from "@workspace/api-client-react";
import type { Outcome } from "@workspace/vocab";
import {
  deriveGroupOutcomeFromLegs as deriveSharedGroupOutcomeFromLegs,
  type DerivedGroupOutcome as SharedDerivedGroupOutcome,
  type GroupOutcomeBuckets as SharedGroupOutcomeBuckets,
} from "@workspace/leg-state";

export type GroupOutcomeBuckets = SharedGroupOutcomeBuckets;

export interface DerivedGroupOutcome {
  outcome: Outcome;
  buckets: GroupOutcomeBuckets;
}

export function deriveGroupOutcomeFromLegs(
  legs: readonly ClaimResponse[],
): DerivedGroupOutcome {
  const result: SharedDerivedGroupOutcome = deriveSharedGroupOutcomeFromLegs(legs);
  // Outcome enum widens from the shared 5-value union to the full
  // `Outcome` enum (which also includes "Non-Issue"); the helper never
  // emits "Non-Issue", so the cast is safe.
  return { outcome: result.outcome as Outcome, buckets: result.buckets };
}
