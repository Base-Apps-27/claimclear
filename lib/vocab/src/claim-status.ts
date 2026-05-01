import type { GlossaryEntry } from "./domains";

// ─────────────────────────────────────────────────────────────────────────
// Workflow status — applied to both claims and invoice groups.
// Underlying enum: DB column `status` on `claims` / `invoice_groups`.
//
// COLLISION DECISIONS recorded inline so future readers see the choice:
//
// - "Pending"  collides with the per-claim *outcome* (also "Pending"). Both
//   mean "no terminal state yet"; we keep both rather than rename, because
//   the surfaces (workflow vs outcome chip) live next to each other and
//   reinforce the same meaning.
// - "Denied"   collides with the *outcome* "Denied" and with the per-leg
//   conclusion verb (rendered as "Non-contestable" — see leg-conclusion).
//   We keep the workflow + outcome word identical; the leg-conclusion form
//   is the qualified one.
// - "Resolved" is colloquially used in tooltip prose ("the response was
//   resolved"). The workflow status keeps the word; tooltip prose now
//   spells out the action ("the dispute was successfully closed") so a
//   reader doesn't conflate the two.
// ─────────────────────────────────────────────────────────────────────────

export const CLAIM_STATUSES = [
  "New",
  "Needs Review",
  "Needs Evidence",
  "Generating Email",
  "Ready to Review",
  "Awaiting Response",
  "On Hold",
  "Resolved",
  "Denied",
  "Portal Queued",
  "Processed",
] as const;

export type ClaimStatus = typeof CLAIM_STATUSES[number];

export const CLAIM_STATUS: Record<ClaimStatus, GlossaryEntry> = {
  "New": {
    enumValue: "New",
    label: "New",
    description: "Claim just entered the system. Next: review the claim details and move to evidence gathering.",
    domain: "claim_status",
  },
  "Needs Review": {
    enumValue: "Needs Review",
    label: "Needs Review",
    description: "Claim imported with no error details. Check the portal, then classify as non-issue or define the error type.",
    domain: "claim_status",
  },
  "Needs Evidence": {
    enumValue: "Needs Evidence",
    label: "Needs Evidence",
    description: "Evidence must be collected before this claim can proceed. Next: gather GPS logs, driver statements, and supporting documents.",
    domain: "claim_status",
  },
  "Generating Email": {
    enumValue: "Generating Email",
    label: "Generating Email",
    description: "The system is generating a dispute email for this claim. Next: wait for email generation to complete, then review.",
    domain: "claim_status",
  },
  "Ready to Review": {
    enumValue: "Ready to Review",
    label: "Ready to Review",
    description: "The dispute email or submission is ready for staff review. Next: review the generated content and approve or edit before sending.",
    domain: "claim_status",
  },
  "Awaiting Response": {
    enumValue: "Awaiting Response",
    label: "Awaiting Response",
    description: "Dispute has been submitted to the payor portal. Next: wait for the payor's response — check back periodically.",
    domain: "claim_status",
  },
  "On Hold": {
    enumValue: "On Hold",
    label: "On Hold",
    description: "Claim is paused, usually waiting for additional information. Next: follow up on the pending item and resume processing.",
    domain: "claim_status",
  },
  "Resolved": {
    enumValue: "Resolved",
    label: "Resolved",
    description: "Workflow closed with a favorable terminal outcome. No further action needed.",
    domain: "claim_status",
  },
  "Denied": {
    enumValue: "Denied",
    label: "Denied",
    description: "The dispute was denied by the payor. Review whether a re-dispute or appeal is possible.",
    domain: "claim_status",
  },
  "Portal Queued": {
    enumValue: "Portal Queued",
    label: "Portal Queued",
    description: "Claim is queued for automated portal submission. Next: the bot will pick this up and submit it.",
    domain: "claim_status",
  },
  "Processed": {
    enumValue: "Processed",
    label: "Processed",
    description: "Worktree complete on this leg — waiting for the rest of the invoice to be packaged. Next: finish the remaining legs, then click Ready to package on the invoice.",
    domain: "claim_status",
  },
};

export function claimStatusLabel(status: string): string {
  return CLAIM_STATUS[status as ClaimStatus]?.label ?? status;
}

export function claimStatusDescription(status: string): string | undefined {
  return CLAIM_STATUS[status as ClaimStatus]?.description;
}
