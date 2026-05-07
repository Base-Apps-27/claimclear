export type LegacyClaimStatus =
  | "New"
  | "Needs Review"
  | "Needs Evidence"
  | "Generating Email"
  | "Ready to Review"
  | "Awaiting Response"
  | "On Hold"
  | "MAS Eligible"
  | "Expired"
  | "Resolved"
  | "Denied"
  | "Portal Queued"
  | "Processed";

export type LegacyOutcome =
  | "Pending"
  | "Approved"
  | "Denied"
  | "Partially Approved"
  | "Non-Issue"
  | "Withdrawn";

export type LegacySopOutcome =
  | "portal_dispute"
  | "dispute"
  | "hold"
  | "cannot_dispute"
  | "non_issue"
  | null;

export type LegacyAttestationState =
  | "not_required"
  | "pending"
  | "queued"
  | "completed";

export type LegacyDropReason = "cannot_dispute" | "non_issue" | null;

export type LegacyClosureReason = string | null;

export interface LegacyInvoiceGroupShape {
  status: LegacyClaimStatus;
  outcome: LegacyOutcome;
  reattestRequired: boolean;
  reattestCompletedAt: Date | string | null;
  closureReason: LegacyClosureReason;
  holdReason: string | null;
  // Wave D-PR5 (2026-05-07). Group-level aggregate of the per-leg
  // `claims.submitted_via` column — non-null when ANY disputed child
  // has been stamped with a submission path ('portal' | 'email').
  // Optional on the shape so legacy fixtures keep building; callers
  // that own the parent group context fill it from a quick child-side
  // lookup (`refresh*` helpers in `denormalized-cache.ts`).
  submittedVia?: string | null;
}

export interface LegacyClaimShape {
  status: LegacyClaimStatus;
  outcome: LegacyOutcome;
  sopOutcome: LegacySopOutcome;
  attestationState: LegacyAttestationState;
  includedInDispute: boolean;
  duplicateOfClaimId: number | null;
  dropReason: LegacyDropReason;
  errorTypeId: string | null;
  closureReason: LegacyClosureReason;
}
