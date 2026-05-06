import type { AuditActionName } from "./audit-actions";
import type { TransitionSource } from "./sources";

export type TransitionRegistryKey = {
  source: TransitionSource;
  fromState: string | null;
  toState: string;
};

const SOURCE_TO_ACTION: Record<TransitionSource, AuditActionName> = {
  manual_exclude: "leg_excluded",
  auto_blank_sibling: "leg_excluded",
  conclude_leg: "leg_concluded",
  sop_terminal: "leg_sop_advanced",
  sop_mid_walk: "leg_sop_advanced",
  re_include: "leg_included",
  leg_classified: "leg_classified",
  verdict_recorded: "outcome_changed",
  verdict_drafted: "portal_draft_edited",
  attest_self_confirmed: "attestation_self_confirmed",
  attest_queued: "attestation_queued",
  attest_queue_confirmed: "attestation_queue_confirmed",
  attest_complete: "attestation_completed",
  mas_cancel_complete: "mas_action_completed",
  mas_reattest_offline: "mas_reattest_recorded_offline",
  mas_reattest_completed: "mas_reattest_completed",
  expired_sweep_cron: "group_status_changed",
  stuck_submission_reset_cron: "submission_stuck_reset",
  portal_batch_sweeper: "submission_complete",
  portal_submission_confirmed: "portal_submission_confirmed",
  portal_submission_cancelled: "portal_submission_cancelled",
  response_received: "response_received",
  operator_close: "group_status_changed",
  operator_resolve: "group_resolved",
  operator_deny: "group_denied",
  group_triage: "group_triaged",
  group_reattest_queued_bulk: "group_reattest_queued_bulk",
  group_sop_advanced_bulk: "group_sop_advanced_bulk",
  manual_status_change: "status_changed",
  manual_outcome_change: "outcome_changed",
  claims_imported: "claims_imported",
  backfill: "status_changed",
};

export function resolveAuditAction(key: TransitionRegistryKey): AuditActionName {
  return SOURCE_TO_ACTION[key.source];
}

export function actionForSource(source: TransitionSource): AuditActionName {
  return SOURCE_TO_ACTION[source];
}

export const SOURCE_TO_ACTION_TABLE = SOURCE_TO_ACTION;
