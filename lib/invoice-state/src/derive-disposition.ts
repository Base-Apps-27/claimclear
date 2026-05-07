import type { ClaimDisposition, InvoicePhase } from "@workspace/vocab";
import type { LegacyClaimShape } from "./legacy-shapes";

export function deriveDispositionFromLegacy(
  claim: LegacyClaimShape,
  parentPhase: InvoicePhase,
): ClaimDisposition {
  if (claim.duplicateOfClaimId != null) {
    return "duplicate";
  }

  if (parentPhase === "closed") {
    return terminalForClosedPhase(claim);
  }

  if (parentPhase === "awaiting_reattestation") {
    return reattestDisposition(claim);
  }

  if (parentPhase === "reviewed") {
    return verdictDisposition(claim) ?? "verdict_approved";
  }

  if (parentPhase === "response_received") {
    return responseDisposition(claim);
  }

  if (parentPhase === "ready_to_submit" || parentPhase === "submitted") {
    // The claim is on or past the submit step. If `sop_outcome` / `drop_reason`
    // explicitly says how the operator concluded the leg, honor that; otherwise
    // pick the submitted-via-X default from the denormalized `claim.status`
    // mirror (Wave B prod backfill, 2026-05-07: 12 legacy rows have
    // error_type_id set but never went through the SOP triage system, so the
    // pure-triage fallback `errorTypeId != null → classifying` produced
    // dispositions invalid for these phases per VALID_DISPOSITIONS_BY_PHASE).
    return submittedDisposition(claim);
  }

  return triageDisposition(claim);
}

function submittedDisposition(claim: LegacyClaimShape): ClaimDisposition {
  const fromSop = sopOrDropReasonDisposition(claim);
  if (fromSop != null) return fromSop;
  if (claim.includedInDispute === false) return "disposed_nonissue";
  // `claim.status` mirrors the parent group's submission path: Portal Queued
  // means the group went out via the MAS portal, anything else (Awaiting
  // Response, Generating Email, Processed) means the email path. There is no
  // claim-level column that records the submission method directly, so the
  // mirror is the cleanest signal we have without expanding the deriver
  // signature to take the full parent row.
  if (claim.status === "Portal Queued") return "disposed_portal";
  return "disposed_email";
}

function sopOrDropReasonDisposition(claim: LegacyClaimShape): ClaimDisposition | null {
  switch (claim.sopOutcome) {
    case "non_issue":
      return "disposed_nonissue";
    case "cannot_dispute":
      return "disposed_withdraw";
    case "hold":
      return "blocked";
    case "portal_dispute":
      return "disposed_portal";
    case "dispute":
      return "disposed_email";
  }
  if (claim.dropReason === "non_issue") return "disposed_nonissue";
  if (claim.dropReason === "cannot_dispute") return "disposed_withdraw";
  return null;
}

function triageDisposition(claim: LegacyClaimShape): ClaimDisposition {
  const fromSop = sopOrDropReasonDisposition(claim);
  if (fromSop != null) return fromSop;
  if (claim.includedInDispute === false && claim.sopOutcome == null) {
    return "disposed_nonissue";
  }
  if (claim.errorTypeId != null) return "classifying";
  return "unclassified";
}

function responseDisposition(claim: LegacyClaimShape): ClaimDisposition {
  const v = verdictDisposition(claim);
  if (v != null) return v;
  return "awaiting_review";
}

function verdictDisposition(claim: LegacyClaimShape): ClaimDisposition | null {
  switch (claim.outcome) {
    case "Approved":
      return "verdict_approved";
    case "Partially Approved":
      return "verdict_partial";
    case "Denied":
      return "verdict_denied";
  }
  return null;
}

function reattestDisposition(claim: LegacyClaimShape): ClaimDisposition {
  if (claim.outcome === "Denied") return "verdict_denied";
  if (claim.outcome === "Partially Approved" || claim.outcome === "Approved") {
    switch (claim.attestationState) {
      case "queued":
        return "attest_queued";
      case "pending":
        return "attest_pending";
      case "completed":
        return "attested";
      case "not_required":
        return "attest_not_required";
    }
  }
  return verdictDisposition(claim) ?? "attest_pending";
}

function terminalForClosedPhase(claim: LegacyClaimShape): ClaimDisposition {
  switch (claim.closureReason) {
    case "non_issue":
      return "final_nonissue";
    case "denied_by_payor":
      return "final_denied";
    case "cannot_dispute":
      return "final_withdrawn";
  }
  if (claim.attestationState === "completed") return "final_reattested";
  switch (claim.outcome) {
    case "Approved":
    case "Partially Approved":
      return "final_reattested";
    case "Denied":
      return "final_denied";
    case "Withdrawn":
      return "final_withdrawn";
    case "Non-Issue":
      return "final_nonissue";
  }
  if (claim.sopOutcome === "non_issue") return "final_nonissue";
  if (claim.sopOutcome === "cannot_dispute") return "final_withdrawn";
  return "final_nonissue";
}
