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
//
// `disposition` is the canonical Wave-C+ field — when present, it
// determines the sub-status directly via DISPOSITION_TO_SUB_STATUS
// below. The legacy fields (includedInDispute / errorTypeId / holdReason
// / sopOutcome / duplicateOfClaimId) remain on the shape so callers
// that haven't migrated yet (write-side handlers, in-flight tests) keep
// working through the legacy ladder.
export interface LegForSubStatus {
  disposition?: string | null;
  includedInDispute?: boolean | null;
  errorTypeId?: string | null;
  holdReason?: string | null;
  sopOutcome?: string | null;
  // Sibling-duplicate pointer. When set, the leg derives to `duplicate`
  // ahead of every other state — see Task spec §"Sibling duplicate".
  duplicateOfClaimId?: number | null;
}

// Canonical mapping from `claims.disposition` (22-tuple in
// `@workspace/vocab`) to the 8-tuple `LegSubStatus` UI bucket. Built
// to be exhaustive: every disposition has a single, deterministic
// home — extending CLAIM_DISPOSITIONS requires updating this map (TS
// narrows the Record type so a missing key is a compile error).
//
// excluded — `includedInDispute === false` is still sourced from the
// legacy column because there is no `disposition === 'excluded'` (an
// excluded leg keeps its underlying disposition while being held out
// of the dispute payload). Sub-status `excluded` is a UI-only state.
const DISPOSITION_TO_SUB_STATUS: Record<string, LegSubStatus> = {
  unclassified: "needs_classification",
  classifying: "investigating",
  blocked: "blocked",
  duplicate: "duplicate",
  disposed_portal: "ready",
  disposed_email: "ready",
  disposed_withdraw: "dropped",
  disposed_nonissue: "dropped",
  awaiting_review: "investigating",
  verdict_drafted: "investigating",
  verdict_approved: "investigating",
  verdict_denied: "investigating",
  verdict_partial: "investigating",
  attest_pending: "investigating",
  attest_queued: "investigating",
  attested: "investigating",
  mas_cancelled: "investigating",
  attest_not_required: "investigating",
  // The four `final_*` dispositions are the closed-state terminal
  // markers. `frozen` is the closed-only sub-status used by the
  // attestation queue and MAS Action checklist to distinguish "this
  // leg is done with the system" from any active sub-status.
  final_reattested: "frozen",
  final_withdrawn: "frozen",
  final_denied: "frozen",
  final_nonissue: "frozen",
};

// Pure projection from a leg's discrete state to its derived sub-status.
//
// Precedence ladder when reading from the canonical disposition column:
//   excluded (UI-only flag, sourced from legacy includedInDispute)
//     > disposition → DISPOSITION_TO_SUB_STATUS lookup
//
// Precedence ladder when falling back to the legacy columns:
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
  // `excluded` is a UI-only state — sub-status only, no disposition
  // counterpart. Sourced from the legacy column on the row.
  if (leg.includedInDispute === false) return "excluded";

  // Canonical Wave-C path: read disposition column directly. Skip the
  // `unclassified` default though — during Wave C the writers are still
  // status-based (Wave D wires them) so a row can legitimately carry
  // `disposition='unclassified'` (DB default) AND meaningful legacy
  // fields (errorTypeId / sopOutcome) populated by a status-based
  // writer that hasn't synced disposition yet. Falling through to the
  // legacy ladder for the unclassified default keeps Wave-C reads
  // correct on those in-flight rows; once Wave D ships, every leg
  // beyond initial classification will carry a non-default
  // disposition and short-circuit here.
  if (
    leg.disposition &&
    leg.disposition !== "unclassified" &&
    leg.disposition in DISPOSITION_TO_SUB_STATUS
  ) {
    return DISPOSITION_TO_SUB_STATUS[leg.disposition];
  }

  // Legacy fallback ladder for callers that haven't fetched
  // disposition yet (write-side handlers, fixtures predating
  // T009) and for the `unclassified` default case described above.
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
