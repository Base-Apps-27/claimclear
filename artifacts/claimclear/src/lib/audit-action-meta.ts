import {
  Activity as ActivityIcon,
  BrainCircuit,
  Camera,
  ImageOff,
  Workflow,
  Pencil,
  Tag,
  Trash,
  PauseCircle,
  PlayCircle,
  CheckCircle2,
  XCircle,
  FilePlus2,
  FileEdit,
  RefreshCw,
  Undo2,
  Send,
  Mail,
  MailQuestion,
  ArrowRightLeft,
  AlertOctagon,
  MailX,
  BellOff,
  Timer,
  AlarmClockOff,
  RotateCcw,
  ShieldCheck,
  Inbox,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { auditActionLabel } from "@workspace/vocab";

// Audit metadata: icons, categories, and presentation tokens live here
// next to the React rendering code. The *label* for each action is
// pulled from the canonical glossary (@workspace/vocab) so a rename
// only happens in one place.

export type ActionCategory =
  | "status"
  | "edit"
  | "evidence"
  | "workflow"
  | "hold"
  | "draft"
  | "communication"
  | "other";

export type ActionMeta = {
  label: string;
  icon: LucideIcon;
  iconClass: string;
  category: ActionCategory;
};

// Helper that builds an ActionMeta for a given audit action by looking
// the label up in the glossary. Keeps each table row to icon + tone +
// category and forces every label through one chokepoint.
function meta(
  key: string,
  kind: "claim" | "group",
  icon: LucideIcon,
  iconClass: string,
  category: ActionCategory,
): ActionMeta {
  return { label: auditActionLabel(key, kind), icon, iconClass, category };
}

export const CLAIM_ACTION_META: Record<string, ActionMeta> = {
  claim_created: meta("claim_created", "claim", FilePlus2, "text-emerald-600", "status"),
  claim_deleted: meta("claim_deleted", "claim", Trash, "text-rose-600", "status"),
  claim_edited: meta("claim_edited", "claim", Pencil, "text-slate-600", "edit"),
  status_changed: meta("status_changed", "claim", ActivityIcon, "text-blue-600", "status"),
  outcome_changed: meta("outcome_changed", "claim", CheckCircle2, "text-emerald-600", "status"),
  closure_addressed: meta("closure_addressed", "claim", CheckCircle2, "text-emerald-600", "status"),
  closure_review_updated: meta("closure_review_updated", "claim", FileEdit, "text-muted-foreground", "other"),
  evidence_updated: meta("evidence_updated", "claim", Camera, "text-emerald-600", "evidence"),
  hold_placed: meta("hold_placed", "claim", PauseCircle, "text-amber-600", "hold"),
  hold_removed: meta("hold_removed", "claim", PlayCircle, "text-emerald-600", "hold"),
  workflow_updated: meta("workflow_updated", "claim", Workflow, "text-blue-600", "workflow"),
  portal_understanding_preflight: meta("portal_understanding_preflight", "claim", BrainCircuit, "text-violet-600", "draft"),
  portal_draft_created: meta("portal_draft_created", "claim", FilePlus2, "text-blue-600", "draft"),
  portal_draft_edited: meta("portal_draft_edited", "claim", FileEdit, "text-violet-600", "draft"),
  portal_draft_regenerated: meta("portal_draft_regenerated", "claim", RefreshCw, "text-blue-600", "draft"),
  portal_draft_reverted: meta("portal_draft_reverted", "claim", Undo2, "text-amber-600", "draft"),
  portal_submission_submitted: meta("portal_submission_submitted", "claim", Send, "text-emerald-600", "communication"),
  response_reassigned: meta("response_reassigned", "claim", ArrowRightLeft, "text-blue-600", "communication"),
  response_unmatched: meta("response_unmatched", "claim", MailQuestion, "text-amber-600", "communication"),
  outbound_sent: meta("outbound_sent", "claim", Mail, "text-emerald-600", "communication"),
  bounce_received: meta("bounce_received", "claim", MailX, "text-rose-600", "communication"),
  connector_unhealthy: meta("connector_unhealthy", "claim", AlertOctagon, "text-amber-600", "other"),
  notification_opt_out_changed: meta("notification_opt_out_changed", "claim", BellOff, "text-slate-600", "other"),
  submission_retry_scheduled: meta("submission_retry_scheduled", "claim", Timer, "text-amber-600", "workflow"),
  submission_retries_exhausted: meta("submission_retries_exhausted", "claim", AlertOctagon, "text-rose-600", "workflow"),
  submission_stuck_reset: meta("submission_stuck_reset", "claim", AlarmClockOff, "text-amber-600", "workflow"),
  submission_manual_requeue: meta("submission_manual_requeue", "claim", RotateCcw, "text-blue-600", "workflow"),
  leg_sop_hold_cleared: meta("leg_sop_hold_cleared", "claim", PlayCircle, "text-emerald-600", "hold"),
  attestation_self_confirmed: meta("attestation_self_confirmed", "claim", ShieldCheck, "text-emerald-600", "status"),
  attestation_queued: meta("attestation_queued", "claim", Inbox, "text-amber-600", "workflow"),
  attestation_queue_confirmed: meta("attestation_queue_confirmed", "claim", ShieldCheck, "text-emerald-600", "status"),
};

export const GROUP_ACTION_META: Record<string, ActionMeta> = {
  group_evidence_added: meta("group_evidence_added", "group", Camera, "text-emerald-600", "evidence"),
  group_evidence_removed: meta("group_evidence_removed", "group", ImageOff, "text-rose-600", "evidence"),
  group_workflow_step: meta("group_workflow_step", "group", Workflow, "text-blue-600", "workflow"),
  group_edited: meta("group_edited", "group", Pencil, "text-slate-600", "edit"),
  group_error_type_assigned: meta("group_error_type_assigned", "group", Tag, "text-violet-600", "edit"),
  group_deleted: meta("group_deleted", "group", Trash, "text-rose-600", "status"),
  group_held: meta("group_held", "group", PauseCircle, "text-amber-600", "hold"),
  group_hold_removed: meta("group_hold_removed", "group", PlayCircle, "text-emerald-600", "hold"),
  group_triaged: meta("group_triaged", "group", CheckCircle2, "text-emerald-600", "status"),
  group_resolved: meta("group_resolved", "group", CheckCircle2, "text-emerald-600", "status"),
  group_denied: meta("group_denied", "group", XCircle, "text-rose-600", "status"),
  closure_addressed: meta("closure_addressed", "group", CheckCircle2, "text-emerald-600", "status"),
  closure_review_updated: meta("closure_review_updated", "group", FileEdit, "text-muted-foreground", "other"),
  portal_understanding_preflight: meta("portal_understanding_preflight", "group", BrainCircuit, "text-violet-600", "draft"),
  portal_draft_created: meta("portal_draft_created", "group", FilePlus2, "text-blue-600", "draft"),
  portal_draft_edited: meta("portal_draft_edited", "group", FileEdit, "text-violet-600", "draft"),
  portal_draft_regenerated: meta("portal_draft_regenerated", "group", RefreshCw, "text-blue-600", "draft"),
  portal_draft_reverted: meta("portal_draft_reverted", "group", Undo2, "text-amber-600", "draft"),
  response_reassigned: meta("response_reassigned", "group", ArrowRightLeft, "text-blue-600", "communication"),
  response_unmatched: meta("response_unmatched", "group", MailQuestion, "text-amber-600", "communication"),
  outbound_sent: meta("outbound_sent", "group", Mail, "text-emerald-600", "communication"),
  bounce_received: meta("bounce_received", "group", MailX, "text-rose-600", "communication"),
  mas_reattest_recorded_offline: meta("mas_reattest_recorded_offline", "group", ShieldCheck, "text-amber-600", "status"),
  // Task #322 — surface the new verdict-derived "What's next?" actions
  // in the activity feed with their own tone tokens so reviewers can
  // skim for them. Both are group-only by design.
  payor_denial_reason_recorded: meta("payor_denial_reason_recorded", "group", Tag, "text-rose-600", "status"),
  awaiting_payor_again: meta("awaiting_payor_again", "group", Send, "text-blue-600", "communication"),
};

export function humanizeAuditAction(action: string, kind: "claim" | "group"): ActionMeta {
  const table = kind === "group" ? GROUP_ACTION_META : CLAIM_ACTION_META;
  return (
    table[action] ?? {
      label: action
        .replace(/^(group_|portal_)/, "")
        .replace(/_/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase()),
      icon: ActivityIcon,
      iconClass: "text-muted-foreground",
      category: "other",
    }
  );
}

export const ACTION_CATEGORY_LABELS: Record<ActionCategory | "all", string> = {
  all: "All activity",
  status: "Status",
  edit: "Edits",
  evidence: "Evidence",
  workflow: "Workflow",
  hold: "Hold",
  draft: "Dispute write-ups",
  communication: "Communication",
  other: "Other",
};
