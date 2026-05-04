// Single source of truth for the "leg has reached a conclusion?" rule on
// the client. Both the queue's per-leg row (LegConclusionRow) and the
// invoice-group submission gauntlet (InvoiceGroupSubmissionGauntlet) ask
// this question, and they MUST stay aligned with the backend's
// `evaluateDisputedLegsResolved` in
// `artifacts/api-server/src/lib/group-readiness.ts` so the UI gate and
// the server-side gate move together.
//
// The rule:
//   - A leg whose derived sub-status is in RESOLVED_LEG_SUB_STATUSES
//     (`ready` / `dropped` / `excluded`) is resolved on its own.
//   - A `duplicate` leg is resolved iff its primary leg
//     (`duplicateOfClaimId`) is itself in RESOLVED_LEG_SUB_STATUSES.
//     If the primary is mid-walk (or gets reclassified back), the
//     duplicate becomes unresolved again — same semantics as the
//     backend gate.
//
// Implementation detail mirrored from the backend: we pre-compute
// sub-statuses across the FULL leg list (including excluded primaries),
// not just the disputed subset, because a duplicate's primary may be
// excluded (`includedInDispute=false`). Limiting the index to disputed
// legs would make an excluded primary look "missing" and falsely flag
// the duplicate as unresolved.

import {
  deriveLegSubStatus,
  type LegForSubStatus,
  type LegSubStatus,
} from "@workspace/leg-state";

export const RESOLVED_LEG_SUB_STATUSES: ReadonlySet<LegSubStatus> = new Set([
  "ready",
  "dropped",
  "excluded",
]);

// Minimal shape required for the resolved check. Compatible with
// ClaimResponse (which has `id` plus the leg-state fields).
export interface LegForResolvedCheck extends LegForSubStatus {
  id: number;
  duplicateOfClaimId?: number | null;
}

export interface LegResolvedIndex<L extends LegForResolvedCheck> {
  /** Derived sub-status for `leg`. Cached across the index lifetime. */
  subStatusOf: (leg: L) => LegSubStatus;
  /** True when `leg` satisfies the resolved-leg rule above. */
  isLegResolved: (leg: L) => boolean;
  /**
   * First leg in `rides` that is NOT resolved. Used by the gauntlet to
   * power the "Jump to leg" affordance after a `gate: "legs"` submit
   * error. Returns null if every ride is resolved or the list is empty.
   */
  firstUnresolvedLegId: (rides: readonly L[]) => number | null;
}

export function buildLegResolvedIndex<L extends LegForResolvedCheck>(
  allLegs: readonly L[],
): LegResolvedIndex<L> {
  const subStatusById = new Map<number, LegSubStatus>();
  for (const l of allLegs) subStatusById.set(l.id, deriveLegSubStatus(l));

  function subStatusOf(leg: L): LegSubStatus {
    const cached = subStatusById.get(leg.id);
    return cached ?? deriveLegSubStatus(leg);
  }

  function isLegResolved(leg: L): boolean {
    const sub = subStatusOf(leg);
    if (sub === "duplicate") {
      const primaryId = leg.duplicateOfClaimId;
      if (primaryId == null) return false;
      const primarySub = subStatusById.get(primaryId);
      return !!primarySub && RESOLVED_LEG_SUB_STATUSES.has(primarySub);
    }
    return RESOLVED_LEG_SUB_STATUSES.has(sub);
  }

  function firstUnresolvedLegId(rides: readonly L[]): number | null {
    for (const r of rides) {
      if (!isLegResolved(r)) return r.id;
    }
    return null;
  }

  return { subStatusOf, isLegResolved, firstUnresolvedLegId };
}
