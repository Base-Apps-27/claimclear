import type { GlossaryEntry } from "./domains";

// Audit-action labels — the operator-facing copy that appears in activity
// feeds. Only labels live here; icons/colors/categories continue to live
// in `audit-action-meta.ts` next to the React rendering code.
//
// Many actions are shared between the claim and group log; per-kind
// nuances are captured by passing `kind` to `auditActionLabel`.

const SHARED: Record<string, string> = {
  // Status
  status_changed: "Status changed",
  outcome_changed: "Outcome changed",
  closure_addressed: "Addressed",
  closure_review_updated: "Review notes updated",
  attestation_self_confirmed: "Re-attested in payor portal",
  attestation_queued: "Queued for re-attestation",
  attestation_queue_confirmed: "Queued attestation confirmed",

  // Hold
  hold_placed: "Placed on hold",
  hold_removed: "Hold removed",
  leg_sop_hold_cleared: "SOP hold cleared",

  // Workflow
  workflow_updated: "Workflow updated",
  submission_retry_scheduled: "Portal submission retry scheduled",
  submission_retries_exhausted: "Portal submission retries exhausted",
  submission_stuck_reset: "Stuck submission auto-reset",
  submission_manual_requeue: "Portal submission manually re-queued",

  // Drafts
  portal_understanding_preflight: "AI understanding checked",
  portal_draft_created: "Dispute write-up generated",
  portal_draft_edited: "Dispute write-up edited",
  portal_draft_regenerated: "Dispute write-up regenerated",
  portal_draft_reverted: "Dispute write-up reverted",

  // Communication
  portal_submission_submitted: "Portal submission sent",
  response_reassigned: "Response reassigned",
  response_unmatched: "Response unmatched",
  outbound_sent: "Outbound email sent",
  bounce_received: "Email bounce received",

  // Other
  connector_unhealthy: "Connector unhealthy",
  notification_opt_out_changed: "Notification preferences changed",
};

const CLAIM_ONLY: Record<string, string> = {
  claim_created: "Claim created",
  claim_deleted: "Claim deleted",
  claim_edited: "Claim details updated",
  evidence_updated: "Evidence updated",
};

const GROUP_ONLY: Record<string, string> = {
  group_evidence_added: "Evidence collected",
  group_evidence_removed: "Evidence removed",
  group_workflow_step: "Workflow step completed",
  group_edited: "Group details updated",
  group_error_type_assigned: "Error type assigned",
  group_deleted: "Group deleted",
  group_held: "Placed on hold",
  group_hold_removed: "Hold removed",
  group_triaged: "Classification completed",
  group_resolved: "Group resolved",
  group_denied: "Group denied",
  mas_reattest_recorded_offline: "MAS re-attest recorded (offline)",
  // Task #322 — verdict-derived "What's next?" surface on Responses
  // Awaiting Review. The picker captures a qualitative tag for the
  // payor's denial reason, and the "I replied — wait for payor again"
  // button stamps the group as awaiting the next inbound reply.
  payor_denial_reason_recorded: "Payor denial reason recorded",
  awaiting_payor_again: "Marked awaiting payor reply",
  // Task #455 — invoice number rename carried through the Re-attest flow
  // (atomic with the re-attest stamp + draft promotion).
  group_invoice_number_renamed: "Invoice number renamed",
};

export const AUDIT_ACTION_LABELS_BY_KIND = {
  claim: { ...SHARED, ...CLAIM_ONLY },
  group: { ...SHARED, ...GROUP_ONLY },
} as const;

export type AuditKind = keyof typeof AUDIT_ACTION_LABELS_BY_KIND;

export const AUDIT_ACTIONS: Record<string, GlossaryEntry> = (() => {
  const all: Record<string, GlossaryEntry> = {};
  for (const [key, label] of Object.entries({ ...SHARED, ...CLAIM_ONLY, ...GROUP_ONLY })) {
    all[key] = {
      enumValue: key,
      label,
      description: `Audit action: ${label}.`,
      domain: "audit_action",
    };
  }
  return all;
})();

export function auditActionLabel(action: string, kind: AuditKind): string {
  return AUDIT_ACTION_LABELS_BY_KIND[kind][action] ?? action;
}
