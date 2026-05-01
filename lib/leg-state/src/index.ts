// Shared, dependency-free vocabulary + derivation helper for the inner-tier
// per-leg sub-status. Lives in its own package (rather than @workspace/db)
// so the React client can depend on it without pulling drizzle/pg into the
// browser bundle. The DB package re-exports these symbols so existing
// server-side imports stay valid.

export const LEG_SUB_STATUSES = [
  "excluded",
  "needs_classification",
  "investigating",
  "blocked",
  "ready",
  "dropped",
  "frozen",
] as const;
export type LegSubStatus = typeof LEG_SUB_STATUSES[number];

// Hold-reason vocabulary, mirrored from `@workspace/db`'s `LEG_HOLD_REASONS`.
// Re-exported here so the React client can pick from the same list without
// pulling drizzle/pg into the browser bundle.
export const LEG_HOLD_REASONS = [
  "evidence_pending",
  "awaiting_external_party",
  "awaiting_member_response",
  "awaiting_internal_review",
  "other",
] as const;
export type LegHoldReason = typeof LEG_HOLD_REASONS[number];

// Input shape for deriveLegSubStatus. Field names match the discrete
// columns introduced on `claims` in the Task #195 schema reshape so that
// callers can spread a row directly without a translation step.
export interface LegForSubStatus {
  includedInDispute?: boolean | null;
  errorTypeId?: string | null;
  holdReason?: string | null;
  sopOutcome?: string | null;
}

// Pure projection from a leg's discrete state to its derived sub-status.
// The conditional ladder is the source of truth for precedence per the
// Task #195 spec:
//
//   excluded > needs_classification > blocked (holdReason)
//     > investigating (no sopOutcome) > dropped/ready (driven by sopOutcome)
//
// `sopOutcome === 'hold'` is a parallel pause path from inside the SOP
// walk and also resolves to `blocked`.
export function deriveLegSubStatus(leg: LegForSubStatus): LegSubStatus {
  if (leg.includedInDispute === false) return "excluded";
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
