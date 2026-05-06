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

  if (group.status === "On Hold") {
    return { phase: "triage", closureReason: null, prePhaseHint: null };
  }

  if (group.status === "MAS Eligible" && group.reattestRequired && !reattestCompleted) {
    return { phase: "awaiting_reattestation", closureReason: null, prePhaseHint: null };
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
