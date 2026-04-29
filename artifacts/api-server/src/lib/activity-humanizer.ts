export type ActivityTone = "good" | "bad" | "neutral";
export type ActorRole = "user" | "system";

export interface AuditRow {
  id: number;
  action: string;
  details: string;
  metadata: unknown;
  userEmail: string | null;
  userName: string | null;
  timestamp: Date | string;
  claimId: number | null;
  invoiceGroupId: number | null;
  invoiceNumber: string | null;
  claimConfNumber: string | null;
}

export interface HumanizedEvent {
  id: number;
  timestamp: string;
  action: string;
  actor: string;
  actorRole: ActorRole;
  summary: string;
  tone: ActivityTone;
  invoiceGroupId: number | null;
  invoiceNumber: string | null;
  claimId: number | null;
  claimConfNumber: string | null;
  href: string | null;
}

function actorFor(row: AuditRow): { actor: string; role: ActorRole } {
  if (row.userName && row.userName.trim()) return { actor: row.userName.trim(), role: "user" };
  if (row.userEmail && row.userEmail.trim()) {
    const local = row.userEmail.split("@")[0];
    return { actor: local, role: "user" };
  }
  return { actor: "ClaimClear", role: "system" };
}

function targetLabel(row: AuditRow): string {
  if (row.invoiceNumber) return `INV-${row.invoiceNumber}`;
  if (row.claimConfNumber) return `claim ${row.claimConfNumber}`;
  if (row.invoiceGroupId != null) return `invoice group #${row.invoiceGroupId}`;
  if (row.claimId != null) return `claim #${row.claimId}`;
  return "a record";
}

function metaString(meta: unknown, key: string): string | null {
  if (!meta || typeof meta !== "object") return null;
  const v = (meta as Record<string, unknown>)[key];
  return typeof v === "string" && v.trim() ? v : null;
}

function metaNumber(meta: unknown, key: string): number | null {
  if (!meta || typeof meta !== "object") return null;
  const v = (meta as Record<string, unknown>)[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function toneForOutcome(outcome: string | null | undefined): ActivityTone {
  if (!outcome) return "neutral";
  if (outcome === "Approved" || outcome === "Partially Approved") return "good";
  if (outcome === "Denied") return "bad";
  return "neutral";
}

const POSITIVE_PORTAL_RESPONSES = new Set(["approved", "partially_approved", "approval"]);
const NEGATIVE_PORTAL_RESPONSES = new Set(["denied", "rejected", "denial"]);

export function humanizeAuditRow(row: AuditRow): HumanizedEvent {
  const { actor, role } = actorFor(row);
  const target = targetLabel(row);
  const meta = row.metadata;

  let summary: string;
  let tone: ActivityTone = "neutral";

  switch (row.action) {
    // ---- Group lifecycle ----
    case "group_outcome_changed": {
      const to = metaString(meta, "to") ?? "an outcome";
      const closure = metaString(meta, "closureReasonLabel");
      const verb =
        to === "Approved" ? "approved"
        : to === "Partially Approved" ? "partially approved"
        : to === "Denied" ? "marked denied"
        : to === "Withdrawn" ? "withdrew"
        : `set outcome to ${to}`;
      summary = `${actor} ${verb} ${target}${closure && to === "Withdrawn" ? ` (${closure})` : ""}`;
      tone = toneForOutcome(to);
      break;
    }
    case "group_status_changed": {
      const to = metaString(meta, "to");
      summary = to
        ? `${actor} moved ${target} to ${to}`
        : `${actor} updated status on ${target}`;
      break;
    }
    case "group_status_and_outcome_changed": {
      const toStatus = metaString(meta, "toStatus");
      const toOutcome = metaString(meta, "toOutcome") ?? metaString(meta, "to");
      summary = toOutcome
        ? `${actor} moved ${target} to ${toStatus ?? "a new status"} (${toOutcome})`
        : `${actor} updated ${target}`;
      tone = toneForOutcome(toOutcome);
      break;
    }
    case "group_triaged":
      summary = `${actor} finished triage on ${target}`;
      break;
    case "group_held":
      summary = `${actor} placed ${target} on hold`;
      break;
    case "group_hold_removed":
      summary = `${actor} removed hold from ${target}`;
      break;
    case "group_evidence_added": {
      const evidence = row.details.replace(/^Evidence collected:\s*/i, "");
      summary = `${actor} added evidence to ${target}${evidence ? `: ${evidence}` : ""}`;
      break;
    }
    case "group_evidence_removed":
      summary = `${actor} removed evidence from ${target}`;
      break;
    case "group_workflow_step":
      summary = `${actor} completed a workflow step on ${target}`;
      break;
    case "group_edited":
      summary = `${actor} edited ${target}`;
      break;
    case "group_error_type_assigned":
      summary = `${actor} assigned an error type on ${target}`;
      break;
    case "group_deleted":
      summary = `${actor} deleted ${target}`;
      tone = "bad";
      break;

    // ---- Claim lifecycle ----
    case "claim_created":
      summary = `${actor} created ${target}`;
      break;
    case "claim_edited":
      summary = `${actor} edited ${target}`;
      break;
    case "claim_deleted":
      summary = `${actor} deleted ${target}`;
      break;
    case "status_changed": {
      const to = metaString(meta, "to");
      summary = to
        ? `${actor} moved ${target} to ${to}`
        : `${actor} updated status on ${target}`;
      break;
    }
    case "outcome_changed": {
      const to = metaString(meta, "to") ?? "an outcome";
      summary = `${actor} set ${target} outcome to ${to}`;
      tone = toneForOutcome(to);
      break;
    }
    case "status_and_outcome_changed": {
      const to = metaString(meta, "toOutcome") ?? metaString(meta, "to");
      summary = `${actor} updated ${target}${to ? ` (${to})` : ""}`;
      tone = toneForOutcome(to);
      break;
    }
    case "evidence_updated":
      summary = `${actor} updated evidence on ${target}`;
      break;
    case "hold_placed":
      summary = `${actor} placed ${target} on hold`;
      break;
    case "hold_removed":
      summary = `${actor} removed hold from ${target}`;
      break;
    case "workflow_updated":
      summary = `${actor} updated workflow on ${target}`;
      break;
    case "error_type_assigned":
      summary = `${actor} assigned an error type to ${target}`;
      break;

    // ---- Portal drafts & submissions ----
    case "portal_draft_created":
      summary = `${actor} generated a dispute write-up for ${target}`;
      break;
    case "portal_draft_edited":
      summary = `${actor} edited the dispute write-up for ${target}`;
      break;
    case "portal_draft_regenerated":
      summary = `${actor} regenerated the dispute write-up for ${target}`;
      break;
    case "portal_draft_reverted":
      summary = `${actor} reverted the dispute write-up on ${target}`;
      break;
    case "portal_submission_submitted":
      summary = `${actor} submitted ${target} to the payor portal`;
      break;
    case "portal_submission_confirmed":
      summary = `${actor} confirmed the portal submission for ${target}`;
      break;
    case "portal_submission_cancelled":
      summary = `${actor} cancelled the portal submission for ${target}`;
      break;

    // ---- Bot / batch processor ----
    case "submission_complete":
      summary = `Bot completed a submission run on ${target}`;
      break;
    case "dry_run_complete":
      summary = `Bot finished a dry run on ${target}`;
      break;
    case "batch_claimed":
      summary = `Bot claimed a batch including ${target}`;
      break;
    case "batch_failed":
      summary = `Bot batch failed on ${target}`;
      tone = "bad";
      break;
    case "sandbox_run_complete":
      summary = `Sandbox run completed on ${target}`;
      break;
    case "sandbox_run_failed":
      summary = `Sandbox run failed on ${target}`;
      tone = "bad";
      break;
    case "submission_retry_scheduled":
      summary = `Retry scheduled for ${target}`;
      break;
    case "submission_retries_exhausted":
      summary = `Retries exhausted for ${target}`;
      tone = "bad";
      break;
    case "submission_stuck_reset":
    case "stuck_reset":
      summary = `Stuck submission auto-reset on ${target}`;
      break;

    // ---- Inbound communication ----
    case "response_received": {
      const outcome = metaString(meta, "outcome");
      const lower = outcome?.toLowerCase() ?? "";
      if (POSITIVE_PORTAL_RESPONSES.has(lower)) {
        summary = `Payor approved ${target}`;
        tone = "good";
      } else if (NEGATIVE_PORTAL_RESPONSES.has(lower)) {
        summary = `Payor denied ${target}`;
        tone = "bad";
      } else {
        summary = `Payor response logged on ${target}${outcome ? ` (${outcome})` : ""}`;
      }
      break;
    }
    case "bounce_received": {
      const address = metaString(meta, "address") ?? metaString(meta, "email");
      summary = address
        ? `Email to ${address} bounced for ${target}`
        : `Email bounced for ${target}`;
      tone = "bad";
      break;
    }
    case "email_generated":
      summary = `${actor} generated an email for ${target}`;
      break;

    // ---- Notes ----
    case "note_added":
      summary = `${actor} added a note on ${target}`;
      break;
    case "note_deleted":
      summary = `${actor} deleted a note on ${target}`;
      break;

    // ---- Imports ----
    case "claims_imported": {
      const created = metaNumber(meta, "created") ?? 0;
      const groups = metaNumber(meta, "groupsCreated");
      const groupSuffix = groups != null ? ` across ${groups} invoice group${groups === 1 ? "" : "s"}` : "";
      summary = `${actor} imported ${created} claim${created === 1 ? "" : "s"} from job-status report${groupSuffix}`;
      break;
    }

    // ---- System / settings ----
    case "connector_unhealthy": {
      const name = metaString(meta, "connector") ?? metaString(meta, "name");
      summary = name
        ? `Connector "${name}" reported unhealthy`
        : `A connector reported unhealthy`;
      tone = "bad";
      break;
    }
    case "notification_opt_out_changed":
      summary = `${actor} changed notification preferences`;
      break;

    default: {
      // Fallback: prefer the human-readable details we already store, else humanize the key.
      const fallback = row.details && row.details.trim()
        ? row.details.trim()
        : row.action.replace(/^(group_|portal_)/, "").replace(/_/g, " ");
      const hasTarget =
        row.invoiceGroupId != null ||
        row.claimId != null ||
        !!row.invoiceNumber ||
        !!row.claimConfNumber;
      summary = `${actor} · ${fallback}${hasTarget ? ` (${target})` : ""}`;
      break;
    }
  }

  const href = row.invoiceGroupId != null
    ? `/invoice-groups/${row.invoiceGroupId}`
    : row.claimId != null
      ? `/claims/${row.claimId}`
      : null;

  return {
    id: row.id,
    timestamp: row.timestamp instanceof Date ? row.timestamp.toISOString() : row.timestamp,
    action: row.action,
    actor,
    actorRole: role,
    summary,
    tone,
    invoiceGroupId: row.invoiceGroupId,
    invoiceNumber: row.invoiceNumber,
    claimId: row.claimId,
    claimConfNumber: row.claimConfNumber,
    href,
  };
}
