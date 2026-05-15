import type { InvoicePhase } from "@workspace/vocab";
import type { LegacyInvoiceGroupShape } from "./legacy-shapes";

export type LegacyClosureReasonValue =
  | "reattested"
  | "non_issue"
  | "expired"
  | "denied_by_payor"
  | "cannot_dispute";

export interface DerivedPhase {
  phase: InvoicePhase;
  closureReason: LegacyClosureReasonValue | null;
  prePhaseHint: InvoicePhase | null;
}

export function derivePhaseFromLegacy(group: LegacyInvoiceGroupShape): DerivedPhase {
  const reattestCompleted = group.reattestCompletedAt != null;

  if (reattestCompleted) {
    return { phase: "closed", closureReason: "reattested", prePhaseHint: null };
  }

  if (group.status === "Resolved" && group.outcome === "Non-Issue") {
    return { phase: "closed", closureReason: "non_issue", prePhaseHint: null };
  }

  if (group.status === "Expired") {
    return { phase: "closed", closureReason: "expired", prePhaseHint: null };
  }

  if (group.status === "Denied") {
    return { phase: "closed", closureReason: "denied_by_payor", prePhaseHint: null };
  }

  if (group.status === "Resolved" && group.outcome === "Withdrawn") {
    const cr = legacyClosureReasonOrCannotDispute(group.closureReason);
    return { phase: "closed", closureReason: cr, prePhaseHint: null };
  }

  // Task #648 follow-up (2026-05-15). "No Action Needed" is the
  // system-asserted "closed without a dispute outcome" verdict (Task
  // #714). The writer (`transitionGroupOutcome` in
  // `group-transitions.ts`) lands phase='closed' directly when it
  // stamps this outcome, but the deriver fell through to the generic
  // `Resolved → triage` arm at the bottom of this function — meaning
  // any later `refreshGroupDerivedFields` call would snap the group
  // back to triage and re-pollute the dashboard money tiles that
  // exclude `outcome IN ('Withdrawn','Non-Issue','No Action Needed')`.
  // Closure reason is locked to 'non_issue' for this outcome by the
  // writer at `group-transitions.ts:646`, so we mirror that here
  // instead of consulting the legacy fallback table.
  if (group.status === "Resolved" && group.outcome === "No Action Needed") {
    return { phase: "closed", closureReason: "non_issue", prePhaseHint: null };
  }

  if (group.status === "On Hold") {
    return { phase: "triage", closureReason: null, prePhaseHint: null };
  }

  if (group.status === "MAS Eligible" && group.reattestRequired && !reattestCompleted) {
    return { phase: "awaiting_reattestation", closureReason: null, prePhaseHint: null };
  }

  // Wave D-PR5 closure-aware safety net (Half 2): the writer
  // (`transitionGroupOutcome` / `transitionGroupStatusAndOutcome`)
  // now stamps phase='closed' + closureReason='approved' directly
  // on Resolved+Approved/Partially Approved. This branch keeps the
  // deriver consistent for any code path that re-runs derivation
  // against the legacy tuple before the writer rewire is universal.
  if (
    group.status === "Resolved" &&
    (group.outcome === "Approved" || group.outcome === "Partially Approved")
  ) {
    return { phase: "closed", closureReason: "reattested", prePhaseHint: null };
  }

  // Wave D-PR5 submitted-promotion (Half 1): once any child carries
  // a non-null `submitted_via`, the group has crossed the "filed via
  // portal/email" line. Promote to phase='submitted' so the §3.B
  // residual `status != "Portal Queued"` exclusion across
  // expiring-filter / urgent-snapshot / dashboard / day-complete can
  // be deleted — phase membership becomes the single source of truth.
  if (
    group.submittedVia != null &&
    (group.status === "Portal Queued" ||
      group.status === "Generating Email" ||
      group.status === "Processed")
  ) {
    return { phase: "submitted", closureReason: null, prePhaseHint: null };
  }

  switch (group.status) {
    case "New":
    case "Needs Review":
    case "Needs Evidence":
      return { phase: "triage", closureReason: null, prePhaseHint: null };
    case "Generating Email":
    case "Portal Queued":
    case "Processed":
    case "Ready to Review":
      return phaseForReadyOrResponse(group);
    case "Awaiting Response":
      return { phase: "submitted", closureReason: null, prePhaseHint: null };
    case "MAS Eligible":
      return { phase: "awaiting_reattestation", closureReason: null, prePhaseHint: null };
    case "Resolved":
      return { phase: "triage", closureReason: null, prePhaseHint: null };
  }
  return { phase: "triage", closureReason: null, prePhaseHint: null };
}

function phaseForReadyOrResponse(group: LegacyInvoiceGroupShape): DerivedPhase {
  if (group.status === "Ready to Review") {
    return { phase: "response_received", closureReason: null, prePhaseHint: null };
  }
  return { phase: "ready_to_submit", closureReason: null, prePhaseHint: null };
}

function legacyClosureReasonOrCannotDispute(cr: string | null): LegacyClosureReasonValue {
  if (cr === "denied_by_payor" || cr === "non_issue" || cr === "cannot_dispute") return cr;
  return "cannot_dispute";
}
