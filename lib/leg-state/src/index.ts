// Shared, dependency-free vocabulary + derivation helper for the inner-tier
// per-leg sub-status. Lives in its own package (rather than @workspace/db)
// so the React client can depend on it without pulling drizzle/pg into the
// browser bundle. The DB package re-exports these symbols so existing
// server-side imports stay valid.

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
//   - the IncludeTerminal editor renders them as empty (the operator
//     starts from a blank slate and authors fresh context if any);
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
