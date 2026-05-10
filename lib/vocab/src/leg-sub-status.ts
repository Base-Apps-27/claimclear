import type { GlossaryEntry } from "./domains";
import { LEG_CONCLUSION } from "./leg-conclusion";

// ─────────────────────────────────────────────────────────────────────────
// Per-leg sub-status — derived projection from a leg's discrete columns.
// Underlying enum: `LEG_SUB_STATUSES` in `@workspace/leg-state`.
//
// COLLISION DECISION: the enum values `excluded` and `dropped` previously
// rendered as the literal words "Excluded" and "Dropped" everywhere. Per
// Task #265 the locked operator vocabulary is "Non-issue" / "Non-
// contestable", driven by the underlying conclusion reason (`sopOutcome`
// or auto-mark sibling rule). Both `excluded` and `dropped` therefore map
// to "Non-issue" by default; callers that have the leg row in hand can
// use `legSubStatusDisplayLabel(leg)` to get the more specific
// "Non-contestable" label when `sopOutcome === 'cannot_dispute'`.
//
// This is the one place in the glossary where two enum values share a
// label — and only because they are the same operational concept (a leg
// that has been removed from the dispute and needs no further work).
// ─────────────────────────────────────────────────────────────────────────

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

export const LEG_SUB_STATUS: Record<LegSubStatus, GlossaryEntry> = {
  excluded: {
    enumValue: "excluded",
    label: "Non-issue",
    description: "Auto-excluded from the dispute — typically a blank sibling marked non-issue when another leg in the group was classified.",
    domain: "leg_sub_status",
  },
  duplicate: {
    enumValue: "duplicate",
    // Default label is the short form. Callers with the leg row in hand
    // should call `legSubStatusDisplayLabel(leg)` to get the
    // "Sibling duplicate of CLM-X" form with the primary reference.
    label: "Sibling duplicate",
    description: "Leg shares a trip-overriding finding with a sibling primary in the same invoice — hidden from work surfaces, satisfies readiness when the primary is terminal, fully counted in the invoice $ rollup.",
    domain: "leg_sub_status",
  },
  needs_classification: {
    enumValue: "needs_classification",
    label: "Needs classification",
    description: "Leg has no error type yet. Pick one or conclude as Non-issue / Non-contestable.",
    domain: "leg_sub_status",
  },
  investigating: {
    enumValue: "investigating",
    label: "Investigating",
    description: "Walk the SOP for the assigned error type to determine the right conclusion.",
    domain: "leg_sub_status",
  },
  blocked: {
    enumValue: "blocked",
    label: "On hold",
    description: "Leg is parked — waiting for evidence, an external party, or internal review.",
    domain: "leg_sub_status",
  },
  ready: {
    enumValue: "ready",
    label: "Ready",
    description: "SOP concluded the leg should be disputed. Awaiting submission of the parent invoice.",
    domain: "leg_sub_status",
  },
  dropped: {
    // Default label is "Non-contestable" — the dominant SOP outcome that
    // produces a `dropped` sub-status (Task #649). Consumers with the
    // leg row in hand should still call `legSubStatusDisplayLabel(leg)`
    // to render the more specific "Non-issue" form when the underlying
    // `sopOutcome === 'non_issue'`. The legacy `excluded` sub-status
    // remains the canonical "Non-issue" surface (auto-excluded blank
    // siblings).
    enumValue: "dropped",
    label: "Non-contestable",
    description: "Leg was removed from the dispute via the SOP walk — defaults to Non-contestable; see the underlying conclusion for the Non-issue case.",
    domain: "leg_sub_status",
  },
  frozen: {
    enumValue: "frozen",
    label: "Frozen",
    description: "Leg is locked because the parent invoice has been submitted; no further classification or conclusion is possible.",
    domain: "leg_sub_status",
  },
};

export function legSubStatusLabel(s: string): string {
  return LEG_SUB_STATUS[s as LegSubStatus]?.label ?? s;
}

// Reason-aware display label. When the caller has the leg row in hand
// (so `sopOutcome` and `duplicateOfClaimId` are available) we can pick
// the more specific form for `dropped` and the primary-aware form for
// `duplicate`. Falls back to the default label for everything else.
export interface LegLikeForDisplay {
  sopOutcome?: string | null;
  duplicateOfClaimId?: number | null;
}

export function legSubStatusDisplayLabel(
  s: LegSubStatus,
  leg?: LegLikeForDisplay,
): string {
  if (s === "dropped" && leg?.sopOutcome === "cannot_dispute") {
    return LEG_CONCLUSION.cannot_dispute.label;
  }
  if (s === "dropped" && leg?.sopOutcome === "non_issue") {
    return LEG_CONCLUSION.non_issue.label;
  }
  if (s === "duplicate" && leg?.duplicateOfClaimId != null) {
    return `Sibling duplicate of CLM-${leg.duplicateOfClaimId}`;
  }
  return LEG_SUB_STATUS[s].label;
}
