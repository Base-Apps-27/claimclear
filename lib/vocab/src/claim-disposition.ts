import type { GlossaryEntry } from "./domains";
import type { InvoicePhase } from "./invoice-phase";

export const CLAIM_DISPOSITIONS = [
  "unclassified",
  "classifying",
  "disposed_portal",
  "disposed_email",
  "disposed_withdraw",
  "disposed_nonissue",
  "blocked",
  "duplicate",
  "awaiting_review",
  "verdict_drafted",
  "verdict_approved",
  "verdict_denied",
  "verdict_partial",
  "attest_pending",
  "attest_queued",
  "attested",
  "mas_cancelled",
  "attest_not_required",
  "final_reattested",
  "final_withdrawn",
  "final_denied",
  "final_nonissue",
  "disposed_expired",
] as const;

export type ClaimDisposition = typeof CLAIM_DISPOSITIONS[number];

export const CLAIM_DISPOSITION: Record<ClaimDisposition, GlossaryEntry> = {
  unclassified: {
    enumValue: "unclassified",
    label: "Unclassified",
    description: "No SOP outcome yet. Operator hasn't picked an error type or concluded the leg.",
    domain: "claim_disposition",
  },
  classifying: {
    enumValue: "classifying",
    label: "Classifying",
    description: "Operator is mid-walk in the SOP for the assigned error type.",
    domain: "claim_disposition",
  },
  disposed_portal: {
    enumValue: "disposed_portal",
    label: "Ready (portal)",
    description: "SOP concluded the leg should be disputed via the MAS portal. Awaiting parent invoice submission.",
    domain: "claim_disposition",
  },
  disposed_email: {
    enumValue: "disposed_email",
    label: "Ready (email)",
    description: "SOP concluded the leg should be disputed via dispute email. Awaiting parent invoice submission.",
    domain: "claim_disposition",
  },
  disposed_withdraw: {
    enumValue: "disposed_withdraw",
    label: "Non-contestable",
    description: "SOP concluded the leg cannot be disputed and is being withdrawn from the dispute.",
    domain: "claim_disposition",
  },
  disposed_nonissue: {
    enumValue: "disposed_nonissue",
    label: "Non-issue",
    description: "SOP concluded the leg is a non-issue and will not be disputed.",
    domain: "claim_disposition",
  },
  blocked: {
    enumValue: "blocked",
    label: "On hold",
    description: "Leg is parked from inside the SOP — waiting for evidence, an external party, or internal review.",
    domain: "claim_disposition",
  },
  duplicate: {
    enumValue: "duplicate",
    label: "Sibling duplicate",
    description: "Leg is linked to a sibling primary in the same invoice and rides on the primary's outcome.",
    domain: "claim_disposition",
  },
  awaiting_review: {
    enumValue: "awaiting_review",
    label: "Awaiting review",
    description: "Payor response is in but the operator hasn't drafted a verdict for this leg yet.",
    domain: "claim_disposition",
  },
  verdict_drafted: {
    enumValue: "verdict_drafted",
    label: "Verdict drafted",
    description: "Verdict is drafted but not yet confirmed by the operator.",
    domain: "claim_disposition",
  },
  verdict_approved: {
    enumValue: "verdict_approved",
    label: "Approved",
    description: "Operator confirmed the payor approved this leg.",
    domain: "claim_disposition",
  },
  verdict_denied: {
    enumValue: "verdict_denied",
    label: "Denied",
    description: "Operator confirmed the payor denied this leg.",
    domain: "claim_disposition",
  },
  verdict_partial: {
    enumValue: "verdict_partial",
    label: "Partial",
    description: "Operator confirmed a partial approval for this leg.",
    domain: "claim_disposition",
  },
  attest_pending: {
    enumValue: "attest_pending",
    label: "Re-attest pending",
    description: "Approved or Partial leg is waiting on MAS re-attestation; not yet queued.",
    domain: "claim_disposition",
  },
  attest_queued: {
    enumValue: "attest_queued",
    label: "Re-attest queued",
    description: "Re-attestation queued for batch processing in the MAS portal.",
    domain: "claim_disposition",
  },
  attested: {
    enumValue: "attested",
    label: "Re-attested",
    description: "MAS re-attestation completed for this leg.",
    domain: "claim_disposition",
  },
  mas_cancelled: {
    enumValue: "mas_cancelled",
    label: "MAS cancelled",
    description: "MAS cancelled the re-attestation request — the leg cannot be re-attested through the portal.",
    domain: "claim_disposition",
  },
  attest_not_required: {
    enumValue: "attest_not_required",
    label: "Re-attest not required",
    description: "MAS confirmed no re-attestation is needed for this Approved or Partial leg.",
    domain: "claim_disposition",
  },
  final_reattested: {
    enumValue: "final_reattested",
    label: "Reattested (closed)",
    description: "Terminal: parent invoice closed after MAS re-attestation completed.",
    domain: "claim_disposition",
  },
  final_withdrawn: {
    enumValue: "final_withdrawn",
    label: "Withdrawn (closed)",
    description: "Terminal: parent invoice closed after the leg was withdrawn from the dispute.",
    domain: "claim_disposition",
  },
  final_denied: {
    enumValue: "final_denied",
    label: "Denied (closed)",
    description: "Terminal: parent invoice closed after the payor denied this leg.",
    domain: "claim_disposition",
  },
  final_nonissue: {
    enumValue: "final_nonissue",
    label: "Non-issue (closed)",
    description: "Terminal: parent invoice closed after the leg was concluded as a non-issue.",
    domain: "claim_disposition",
  },
  disposed_expired: {
    enumValue: "disposed_expired",
    label: "Expired (closed)",
    description: "Terminal: parent invoice was auto-retired by the nightly Expired sweep after the filing deadline passed without submission.",
    domain: "claim_disposition",
  },
};

export function claimDispositionLabel(d: string): string {
  return CLAIM_DISPOSITION[d as ClaimDisposition]?.label ?? d;
}

export function claimDispositionDescription(d: string): string | undefined {
  return CLAIM_DISPOSITION[d as ClaimDisposition]?.description;
}

export function isClaimDisposition(value: string): value is ClaimDisposition {
  return value in CLAIM_DISPOSITION;
}

const TRIAGE_SET: ReadonlyArray<ClaimDisposition> = [
  "unclassified",
  "classifying",
  "disposed_portal",
  "disposed_email",
  "disposed_withdraw",
  "disposed_nonissue",
  "blocked",
  "duplicate",
];

const READY_SUBMITTED_SET: ReadonlyArray<ClaimDisposition> = [
  "disposed_portal",
  "disposed_email",
  "disposed_withdraw",
  "disposed_nonissue",
  "duplicate",
];

const RESPONSE_RECEIVED_SET: ReadonlyArray<ClaimDisposition> = [
  "awaiting_review",
  "verdict_drafted",
  "verdict_approved",
  "verdict_denied",
  "verdict_partial",
  "duplicate",
];

const REVIEWED_SET: ReadonlyArray<ClaimDisposition> = [
  "verdict_approved",
  "verdict_denied",
  "verdict_partial",
  "duplicate",
];

const REATTEST_SET: ReadonlyArray<ClaimDisposition> = [
  "verdict_approved",
  "verdict_denied",
  "verdict_partial",
  "attest_pending",
  "attest_queued",
  "attested",
  "mas_cancelled",
  "attest_not_required",
  "duplicate",
];

const CLOSED_SET: ReadonlyArray<ClaimDisposition> = [
  "final_reattested",
  "final_withdrawn",
  "final_denied",
  "final_nonissue",
  "disposed_expired",
  "duplicate",
];

export const VALID_DISPOSITIONS_BY_PHASE: Record<InvoicePhase, ReadonlyArray<ClaimDisposition>> = {
  triage: TRIAGE_SET,
  ready_to_submit: READY_SUBMITTED_SET,
  submitted: READY_SUBMITTED_SET,
  response_received: RESPONSE_RECEIVED_SET,
  reviewed: REVIEWED_SET,
  awaiting_reattestation: REATTEST_SET,
  closed: CLOSED_SET,
};

export function isDispositionValidForPhase(d: ClaimDisposition, phase: InvoicePhase): boolean {
  return VALID_DISPOSITIONS_BY_PHASE[phase].includes(d);
}

export const TERMINAL_TRIAGE_DISPOSITIONS: ReadonlyArray<ClaimDisposition> = [
  "disposed_portal",
  "disposed_email",
  "disposed_withdraw",
  "disposed_nonissue",
  "duplicate",
];

export const CONFIRMED_VERDICT_DISPOSITIONS: ReadonlyArray<ClaimDisposition> = [
  "verdict_approved",
  "verdict_denied",
  "verdict_partial",
];

export const REATTEST_REQUIRING_DISPOSITIONS: ReadonlyArray<ClaimDisposition> = [
  "verdict_approved",
  "verdict_partial",
];
