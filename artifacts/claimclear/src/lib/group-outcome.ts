// Per-invoice (group) outcome derivation — re-export shim.
//
// The implementation now lives in `@workspace/leg-state` so the same
// helper is reused by Group Detail, the Insights page, AND the
// api-server dashboard rollups (Task #563). The frontend keeps this
// shim so existing imports (`@/lib/group-outcome`) keep working
// without ripple-edit churn.
//
// Task #714 — the wire-level `Outcome` type now includes
// `"No Action Needed"` as a first-class value (it is a real
// `claim_outcome` Postgres enum member, surfaced through the OpenAPI
// spec, the vocab glossary, and stored on disk by the auto-close
// cascade). The Phase 1 `DisplayOutcome` widening shim that lived
// here is no longer needed.
import {
  deriveGroupOutcomeFromLegs as deriveSharedGroupOutcomeFromLegs,
  type DerivedGroupOutcome as SharedDerivedGroupOutcome,
  type GroupOutcomeBuckets as SharedGroupOutcomeBuckets,
} from "@workspace/leg-state";
import type { ClaimResponse } from "@workspace/api-client-react";

export type GroupOutcomeBuckets = SharedGroupOutcomeBuckets;
export type DerivedGroupOutcome = SharedDerivedGroupOutcome;

export function deriveGroupOutcomeFromLegs(
  legs: readonly ClaimResponse[],
): DerivedGroupOutcome {
  return deriveSharedGroupOutcomeFromLegs(legs);
}
