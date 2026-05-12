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

// Local widening: in addition to the wire-level `Outcome` enum the
// rollup may emit `"No Action Needed"` for invoices whose every leg
// turned out to be a non-issue. That value is a UI-only label (no DB
// column carries it) — see `group-outcome.ts` in @workspace/leg-state.
export type DisplayOutcome = Outcome | "No Action Needed";

export interface DerivedGroupOutcome {
  outcome: DisplayOutcome;
  buckets: GroupOutcomeBuckets;
}

export function deriveGroupOutcomeFromLegs(
  legs: readonly ClaimResponse[],
): DerivedGroupOutcome {
  const result: SharedDerivedGroupOutcome = deriveSharedGroupOutcomeFromLegs(legs);
  return { outcome: result.outcome as DisplayOutcome, buckets: result.buckets };
}
