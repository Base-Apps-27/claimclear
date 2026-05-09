// Shared, dependency-free vocabulary + derivation helper for the inner-tier
// per-leg sub-status. Lives in its own package (rather than @workspace/db)
// so the React client can depend on it without pulling drizzle/pg into the
// browser bundle. The DB package re-exports these symbols so existing
// server-side imports stay valid.

// Re-export the openness predicate (Wave D-PR1, 2026-05-07). Mirrors the
// `is_open` GENERATED column on `claims` and `invoice_groups`. See
// `./openness.ts` for the lockstep contract.
export {
  OPEN_STATUSES,
  isClaimOpen,
  isInvoiceGroupOpen,
  type OpenStatus,
} from "./openness";

// Cross-surface "is this invoice group still on the operator's queue?"
// vocabulary. The Queue page's lane filters and the API's day-complete
// celebration matcher both consume these constants so the two can never
// drift. See `./operator-queue.ts` for the lockstep contract.
export {
  OPERATOR_ON_QUEUE_STATUSES,
  OPERATOR_DONE_OUTCOMES,
  isInvoiceGroupOperatorDone,
  type OperatorOnQueueStatus,
  type OperatorDoneOutcome,
} from "./operator-queue";

// Re-export the SOP transcript helper so both the React client (leg-detail
// "SOP walk transcript" card) and the server (Task #377: dispute write-up
// prompt) consume one source of truth without duplicating the logic.
export {
  buildSopTranscript,
  normalizeAnswers,
  type SopAnswerRow,
  type TranscriptLine,
  type SopTranscriptTree,
  type SopTranscriptTreeNode,
} from "./sop-transcript";

// Re-export the "is this leg concluded?" helper so both the React client
// (queue per-leg row + submission gauntlet) and the api-server's
// portal-submission gate consume one source of truth. See
// `./leg-resolved.ts` for the rule and the duplicate→primary semantics.
export {
  RESOLVED_LEG_SUB_STATUSES,
  buildLegResolvedIndex,
  type LegForResolvedCheck,
  type LegResolvedIndex,
} from "./leg-resolved";

// Per-leg sub-status vocabulary + derivation live in their own leaf
// module (`./per-leg-sub-status.ts`) so sibling files like
// `./leg-resolved.ts` can depend on them without cycling through this
// barrel. Re-exported here so external callers keep the
// `from "@workspace/leg-state"` import.
export {
  LEG_SUB_STATUSES,
  deriveLegSubStatus,
  type LegSubStatus,
  type LegForSubStatus,
} from "./per-leg-sub-status";

// Per-invoice outcome rollup (Task #563). Shared between the React
// Group Detail page, the Insights page, and the api-server dashboard
// rollups so the displayed group outcome is computed exactly once and
// can never disagree across surfaces.
export {
  deriveGroupOutcomeFromLegs,
  type DerivedGroupOutcome,
  type DerivedGroupOutcome_Outcome,
  type GroupOutcomeBuckets,
  type LegForGroupOutcome,
  type VerdictLike,
} from "./group-outcome";

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

// ─────────────────────────────────────────────────────────────────────
// Outcome role — the abstraction every UI/server consumer should switch
// on instead of the raw `sopOutcome` string. Hides the legacy
// `portal_dispute` vs `dispute` (email) split (both = "include in
// invoice submission") and lets future channel decisions be made at the
// invoice level without touching every leg-aware caller.
//
//   include        → sopOutcome ∈ {portal_dispute, dispute}
//   hold           → sopOutcome === 'hold'
//   cannot_dispute → sopOutcome === 'cannot_dispute'
//   non_issue      → sopOutcome === 'non_issue'
//   internal       → reserved for the upcoming "internal-only" terminal
//                    (see plan §T006); not yet a stored sopOutcome value
//   duplicate      → leg has duplicateOfClaimId set (sopOutcome ignored)
//   none           → no outcome reached yet (sopOutcome null/undefined)
// ─────────────────────────────────────────────────────────────────────

export const OUTCOME_ROLES = [
  "include",
  "hold",
  "cannot_dispute",
  "non_issue",
  "internal",
  "duplicate",
  "none",
] as const;
export type OutcomeRole = typeof OUTCOME_ROLES[number];

export interface LegForOutcomeRole {
  sopOutcome?: string | null;
  duplicateOfClaimId?: number | null;
}

// ─────────────────────────────────────────────────────────────────────
// Legacy auto-derived per-leg context detection (Task #372). Before this
// task the SOP-advance player auto-filled `claims.per_leg_context` with
// a "• Question — Answer" bullet list of the operator's worktree
// breadcrumb. The new contract treats per-leg context as a deliberate,
// AI-clarified narrative captured ONLY at the end-of-walk Include
// terminal — the SOP transcript is rendered separately on the leg page
// and never written into the field. Existing rows from the old player
// look like a bullet list; this helper recognises them so:
//
//   - the dispute write-up bot (`buildPromptLegInputs`) ignores them
//     and never feeds the breadcrumb back to itself as "operator
//     captured context";
//   - the `PerLegContextEditor` (rendered inline during the SOP walk
//     and on the inline "Ready" surface in SopAdvancePlayer) renders
//     them as empty (the operator starts from a blank slate and
//     authors fresh context if any);
//   - the read-only SOP transcript card on the leg page can still
//     surface them so nothing is lost in the migration.
//
// A value is considered legacy-derived iff it is non-empty and EVERY
// non-empty line begins with "• " — the exact prefix the previous
// `deriveContextFromAnswers` produced. A real operator note that
// happens to start with a single bullet (e.g. "• follow-up needed")
// won't accidentally match because the helper requires that EVERY
// non-empty line start with that prefix; freeform notes virtually
// never satisfy that.
// ─────────────────────────────────────────────────────────────────────

export function isLegacyDerivedContext(s: string | null | undefined): boolean {
  if (s == null) return false;
  const trimmed = s.trim();
  if (trimmed.length === 0) return false;
  const lines = trimmed.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length === 0) return false;
  return lines.every((l) => l.startsWith("• "));
}

export function outcomeRole(leg: LegForOutcomeRole): OutcomeRole {
  if (leg.duplicateOfClaimId != null) return "duplicate";
  switch (leg.sopOutcome) {
    case "portal_dispute":
    case "dispute":
      return "include";
    case "hold":
      return "hold";
    case "cannot_dispute":
      return "cannot_dispute";
    case "non_issue":
      return "non_issue";
    case "internal":
      return "internal";
    case null:
    case undefined:
    case "":
      return "none";
    default:
      return "none";
  }
}
