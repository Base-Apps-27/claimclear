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
