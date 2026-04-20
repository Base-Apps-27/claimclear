import {
  Activity as ActivityIcon,
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
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type ActionMeta = {
  label: string;
  icon: LucideIcon;
  iconClass: string;
  category: ActionCategory;
};

export type ActionCategory =
  | "status"
  | "edit"
  | "evidence"
  | "workflow"
  | "hold"
  | "draft"
  | "communication"
  | "other";

export const CLAIM_ACTION_META: Record<string, ActionMeta> = {
  claim_created: { label: "Claim created", icon: FilePlus2, iconClass: "text-emerald-600", category: "status" },
  claim_deleted: { label: "Claim deleted", icon: Trash, iconClass: "text-rose-600", category: "status" },
  claim_edited: { label: "Claim details updated", icon: Pencil, iconClass: "text-slate-600", category: "edit" },
  status_changed: { label: "Status changed", icon: ActivityIcon, iconClass: "text-blue-600", category: "status" },
  outcome_changed: { label: "Outcome changed", icon: CheckCircle2, iconClass: "text-emerald-600", category: "status" },
  evidence_updated: { label: "Evidence updated", icon: Camera, iconClass: "text-emerald-600", category: "evidence" },
  hold_placed: { label: "Placed on hold", icon: PauseCircle, iconClass: "text-amber-600", category: "hold" },
  hold_removed: { label: "Hold removed", icon: PlayCircle, iconClass: "text-emerald-600", category: "hold" },
  workflow_updated: { label: "Workflow updated", icon: Workflow, iconClass: "text-blue-600", category: "workflow" },
  portal_draft_created: { label: "Dispute write-up generated", icon: FilePlus2, iconClass: "text-blue-600", category: "draft" },
  portal_draft_edited: { label: "Dispute write-up edited", icon: FileEdit, iconClass: "text-violet-600", category: "draft" },
  portal_draft_regenerated: { label: "Dispute write-up regenerated", icon: RefreshCw, iconClass: "text-blue-600", category: "draft" },
  portal_draft_reverted: { label: "Dispute write-up reverted", icon: Undo2, iconClass: "text-amber-600", category: "draft" },
  portal_submission_submitted: { label: "Portal submission sent", icon: Send, iconClass: "text-emerald-600", category: "communication" },
  response_reassigned: { label: "Response reassigned", icon: ArrowRightLeft, iconClass: "text-blue-600", category: "communication" },
  response_unmatched: { label: "Response unmatched", icon: MailQuestion, iconClass: "text-amber-600", category: "communication" },
  outbound_sent: { label: "Outbound email sent", icon: Mail, iconClass: "text-emerald-600", category: "communication" },
  bounce_received: { label: "Email bounce received", icon: MailX, iconClass: "text-rose-600", category: "communication" },
  connector_unhealthy: { label: "Connector unhealthy", icon: AlertOctagon, iconClass: "text-amber-600", category: "other" },
};

export const GROUP_ACTION_META: Record<string, ActionMeta> = {
  group_evidence_added: { label: "Evidence collected", icon: Camera, iconClass: "text-emerald-600", category: "evidence" },
  group_evidence_removed: { label: "Evidence removed", icon: ImageOff, iconClass: "text-rose-600", category: "evidence" },
  group_workflow_step: { label: "Workflow step completed", icon: Workflow, iconClass: "text-blue-600", category: "workflow" },
  group_edited: { label: "Group details updated", icon: Pencil, iconClass: "text-slate-600", category: "edit" },
  group_error_type_assigned: { label: "Error type assigned", icon: Tag, iconClass: "text-violet-600", category: "edit" },
  group_deleted: { label: "Group deleted", icon: Trash, iconClass: "text-rose-600", category: "status" },
  group_held: { label: "Placed on hold", icon: PauseCircle, iconClass: "text-amber-600", category: "hold" },
  group_hold_removed: { label: "Hold removed", icon: PlayCircle, iconClass: "text-emerald-600", category: "hold" },
  group_triaged: { label: "Triage completed", icon: CheckCircle2, iconClass: "text-emerald-600", category: "status" },
  group_resolved: { label: "Group resolved", icon: CheckCircle2, iconClass: "text-emerald-600", category: "status" },
  group_denied: { label: "Group denied", icon: XCircle, iconClass: "text-rose-600", category: "status" },
  portal_draft_created: { label: "Dispute write-up generated", icon: FilePlus2, iconClass: "text-blue-600", category: "draft" },
  portal_draft_edited: { label: "Dispute write-up edited", icon: FileEdit, iconClass: "text-violet-600", category: "draft" },
  portal_draft_regenerated: { label: "Dispute write-up regenerated", icon: RefreshCw, iconClass: "text-blue-600", category: "draft" },
  portal_draft_reverted: { label: "Dispute write-up reverted", icon: Undo2, iconClass: "text-amber-600", category: "draft" },
  response_reassigned: { label: "Response reassigned", icon: ArrowRightLeft, iconClass: "text-blue-600", category: "communication" },
  response_unmatched: { label: "Response unmatched", icon: MailQuestion, iconClass: "text-amber-600", category: "communication" },
  outbound_sent: { label: "Outbound email sent", icon: Mail, iconClass: "text-emerald-600", category: "communication" },
  bounce_received: { label: "Email bounce received", icon: MailX, iconClass: "text-rose-600", category: "communication" },
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
