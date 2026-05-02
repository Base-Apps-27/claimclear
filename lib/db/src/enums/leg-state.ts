// Pinned vocabulary for the per-leg state model introduced by the
// per-claim → per-invoice transition (see docs/architecture/per-invoice-transition.md).
//
// These constants are deliberately the single source of truth: the DB CHECK
// constraints reference these values, the deriveLegSubStatus helper switches
// on them, and downstream UI/route code imports the same arrays. Adding a
// new value is a four-step change (this file + the migration + the helper +
// the UI surface), and that intentional friction is the point.

export const SOP_OUTCOMES = [
  "portal_dispute",
  "dispute",
  "hold",
  "cannot_dispute",
  "non_issue",
] as const;
export type SopOutcome = typeof SOP_OUTCOMES[number];

// Drop reasons reuse the same string values as the leg-scoped subset of
// CLOSURE_REASONS — the operator already learned this vocabulary at the
// group-closure scope, no need to teach it twice.
export const LEG_DROP_REASONS = ["cannot_dispute", "non_issue"] as const;
export type LegDropReason = typeof LEG_DROP_REASONS[number];

export const LEG_EXCLUSION_REASONS = [
  "clean_leg",
  "out_of_scope",
  "duplicate",
  "non_issue",
  "cannot_dispute",
  "other",
] as const;
export type LegExclusionReason = typeof LEG_EXCLUSION_REASONS[number];

// Re-exported from @workspace/leg-state — see file footer for the full set.

export const MAS_ACTION_REQUIRED = ["cancel", "none"] as const;
export type MasActionRequired = typeof MAS_ACTION_REQUIRED[number];

export const VERDICT_SOURCE = ["ai_suggested", "operator_confirmed"] as const;
export type VerdictSource = typeof VERDICT_SOURCE[number];

export const VERDICT_OUTCOMES = ["Approved", "Denied", "Partial"] as const;
export type VerdictOutcome = typeof VERDICT_OUTCOMES[number];

// Sub-status, its input shape, and the pure derivation function live in
// @workspace/leg-state — a dependency-free package so the React client can
// depend on it without pulling drizzle/pg into the browser bundle. We re-
// export them here so existing server-side imports from @workspace/db keep
// working and so there is exactly one source of truth shared by both sides.
export {
  LEG_SUB_STATUSES,
  type LegSubStatus,
  type LegForSubStatus,
  deriveLegSubStatus,
  LEG_HOLD_REASONS,
  type LegHoldReason,
  OUTCOME_ROLES,
  type OutcomeRole,
  type LegForOutcomeRole,
  outcomeRole,
} from "@workspace/leg-state";
