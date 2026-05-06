export const TRANSITION_SOURCES = [
  "manual_exclude",
  "auto_blank_sibling",
  "conclude_leg",
  "sop_terminal",
  "sop_mid_walk",
  "re_include",
  "leg_classified",
  "verdict_recorded",
  "verdict_drafted",
  "attest_self_confirmed",
  "attest_queued",
  "attest_queue_confirmed",
  "attest_complete",
  "mas_cancel_complete",
  "mas_reattest_offline",
  "mas_reattest_completed",
  "expired_sweep_cron",
  "stuck_submission_reset_cron",
  "portal_batch_sweeper",
  "portal_submission_confirmed",
  "portal_submission_cancelled",
  "response_received",
  "operator_close",
  "operator_resolve",
  "operator_deny",
  "group_triage",
  "group_reattest_queued_bulk",
  "group_sop_advanced_bulk",
  "manual_status_change",
  "manual_outcome_change",
  "claims_imported",
  "backfill",
] as const;

export type TransitionSource = (typeof TRANSITION_SOURCES)[number];

const SOURCE_SET: ReadonlySet<string> = new Set(TRANSITION_SOURCES);

export function isTransitionSource(value: string): value is TransitionSource {
  return SOURCE_SET.has(value);
}
