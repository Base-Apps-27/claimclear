// Inner-tier per-leg sub-status vocabulary + derivation. Lives in its
// own module (rather than in `index.ts`) so sibling modules in this
// package — notably `./leg-resolved.ts` — can depend on it without
// going through the barrel re-export. Routing through `./index.ts`
// would create a `index <-> leg-resolved` cycle (index re-exports
// leg-resolved, leg-resolved imports from index). Importing the
// derivation directly from this leaf module avoids the cycle.
//
// `index.ts` re-exports every symbol below, so external callers
// continue to write `from "@workspace/leg-state"` unchanged.

export const LEG_SUB_STATUSES = [
  "excluded",
  "duplicate",
  "needs_classification",
  "investigating",
  "blocked",
  "ready",
  "dropped",
  "frozen",
] as const;
export type LegSubStatus = typeof LEG_SUB_STATUSES[number];

// Input shape for deriveLegSubStatus. Field names match the discrete
// columns introduced on `claims` in the Task #195 schema reshape so that
// callers can spread a row directly without a translation step.
export interface LegForSubStatus {
  includedInDispute?: boolean | null;
  errorTypeId?: string | null;
  holdReason?: string | null;
  sopOutcome?: string | null;
  // Sibling-duplicate pointer. When set, the leg derives to `duplicate`
  // ahead of every other state — see Task spec §"Sibling duplicate".
  duplicateOfClaimId?: number | null;
}

// Pure projection from a leg's discrete state to its derived sub-status.
// The conditional ladder is the source of truth for precedence:
//
//   excluded > duplicate > needs_classification > blocked (holdReason)
//     > investigating (no sopOutcome) > dropped/ready (driven by sopOutcome)
//
// `duplicate` sits just under `excluded` because a sibling duplicate is
// a deliberate "this leg has no independent investigation to do" state —
// distinct from being excluded from the dispute entirely (drivers were
// still paid; the leg counts in the $ rollup) but identical from the
// operator-work perspective: hide from work surfaces.
//
// `sopOutcome === 'hold'` is a parallel pause path from inside the SOP
// walk and also resolves to `blocked`.
export function deriveLegSubStatus(leg: LegForSubStatus): LegSubStatus {
  if (leg.includedInDispute === false) return "excluded";
  if (leg.duplicateOfClaimId != null) return "duplicate";
  if (!leg.errorTypeId) return "needs_classification";
  if (leg.holdReason) return "blocked";
  if (leg.sopOutcome === null || leg.sopOutcome === undefined) {
    return "investigating";
  }
  if (leg.sopOutcome === "cannot_dispute" || leg.sopOutcome === "non_issue") {
    return "dropped";
  }
  if (leg.sopOutcome === "portal_dispute" || leg.sopOutcome === "dispute") {
    return "ready";
  }
  if (leg.sopOutcome === "hold") return "blocked";
  return "investigating"; // unreachable; satisfies exhaustiveness
}
