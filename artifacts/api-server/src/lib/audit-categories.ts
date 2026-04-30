export type ActionCategory =
  | "status"
  | "edit"
  | "evidence"
  | "workflow"
  | "hold"
  | "draft"
  | "communication"
  | "other";

export const ACTION_CATEGORIES: ActionCategory[] = [
  "status",
  "edit",
  "evidence",
  "workflow",
  "hold",
  "draft",
  "communication",
  "other",
];

const CLAIM_CATEGORY_MAP: Record<string, ActionCategory> = {
  claim_created: "status",
  claim_deleted: "status",
  claim_edited: "edit",
  status_changed: "status",
  outcome_changed: "status",
  evidence_updated: "evidence",
  hold_placed: "hold",
  hold_removed: "hold",
  workflow_updated: "workflow",
  portal_draft_created: "draft",
  portal_draft_edited: "draft",
  portal_draft_regenerated: "draft",
  portal_draft_reverted: "draft",
  portal_submission_submitted: "communication",
  notification_opt_out_changed: "other",
  submission_retry_scheduled: "workflow",
  submission_retries_exhausted: "workflow",
  submission_stuck_reset: "workflow",
};

const GROUP_CATEGORY_MAP: Record<string, ActionCategory> = {
  group_evidence_added: "evidence",
  group_evidence_removed: "evidence",
  group_workflow_step: "workflow",
  group_edited: "edit",
  group_error_type_assigned: "edit",
  group_deleted: "status",
  group_held: "hold",
  group_hold_removed: "hold",
  group_triaged: "status",
  group_resolved: "status",
  group_denied: "status",
  portal_draft_created: "draft",
  portal_draft_edited: "draft",
  portal_draft_regenerated: "draft",
  portal_draft_reverted: "draft",
};

const CLAIM_LABELS: Record<string, string> = {
  claim_created: "Claim created",
  claim_deleted: "Claim deleted",
  claim_edited: "Claim details updated",
  status_changed: "Status changed",
  outcome_changed: "Outcome changed",
  evidence_updated: "Evidence updated",
  hold_placed: "Placed on hold",
  hold_removed: "Hold removed",
  workflow_updated: "Workflow updated",
  portal_draft_created: "Dispute write-up generated",
  portal_draft_edited: "Dispute write-up edited",
  portal_draft_regenerated: "Dispute write-up regenerated",
  portal_draft_reverted: "Dispute write-up reverted",
  portal_submission_submitted: "Portal submission sent",
  notification_opt_out_changed: "Notification preferences changed",
  submission_retry_scheduled: "Portal submission retry scheduled",
  submission_retries_exhausted: "Portal submission retries exhausted",
  submission_stuck_reset: "Stuck submission auto-reset",
};

const GROUP_LABELS: Record<string, string> = {
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
  portal_draft_created: "Dispute write-up generated",
  portal_draft_edited: "Dispute write-up edited",
  portal_draft_regenerated: "Dispute write-up regenerated",
  portal_draft_reverted: "Dispute write-up reverted",
};

function humanizeFallback(action: string): string {
  return action
    .replace(/^(group_|portal_)/, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function categoryForAction(action: string, kind: "claim" | "group" | "unknown" = "unknown"): ActionCategory {
  if (kind === "group") return GROUP_CATEGORY_MAP[action] ?? "other";
  if (kind === "claim") return CLAIM_CATEGORY_MAP[action] ?? "other";
  return GROUP_CATEGORY_MAP[action] ?? CLAIM_CATEGORY_MAP[action] ?? "other";
}

export function labelForAction(action: string, kind: "claim" | "group" | "unknown" = "unknown"): string {
  if (kind === "group" && GROUP_LABELS[action]) return GROUP_LABELS[action];
  if (kind === "claim" && CLAIM_LABELS[action]) return CLAIM_LABELS[action];
  return GROUP_LABELS[action] ?? CLAIM_LABELS[action] ?? humanizeFallback(action);
}

export function actionKeysForCategory(category: ActionCategory): string[] {
  const keys = new Set<string>();
  for (const [k, v] of Object.entries(CLAIM_CATEGORY_MAP)) {
    if (v === category) keys.add(k);
  }
  for (const [k, v] of Object.entries(GROUP_CATEGORY_MAP)) {
    if (v === category) keys.add(k);
  }
  return Array.from(keys);
}

export function isActionCategory(value: string): value is ActionCategory {
  return (ACTION_CATEGORIES as string[]).includes(value);
}
