// Shared convention for tagging audit_logs rows produced by one-shot
// backfill scripts (Task #268).
//
// Any backfill script that inserts into `audit_logs` MUST stamp the row's
// `metadata.backfillId` with one of the constants below. That single
// convention lets operators slice "rows produced by a one-shot backfill"
// out of audit history with a uniform query, no matter which script ran.
//
// Convention:
//   audit_logs.metadata = {
//     ...row-specific fields (reason, source, from, to, ...),
//     backfillId: "<dated-slug>",
//   }
//
// The dated slug always matches the migration filename minus the
// `-backfill.ts` suffix so it's trivial to grep both ways. Examples:
//   2026-05-auto-non-issue-siblings-backfill.ts
//     → backfillId = "2026-05-auto-non-issue-siblings"
//   2026-05-per-leg-state-backfill.ts
//     → backfillId = "2026-05-per-leg-state"
//
// Backwards compatibility:
//   The retro auto-non-issue script keeps its older
//   `metadata.source = 'retro_auto_non_issue_backfill'` tag intact so
//   pre-existing rows and saved queries that filter on it still work.
//   New rows pick up *both* the legacy `source` and the new `backfillId`.
//
// Companion saved query: `_backfill-audit-rows.sql` lists every audit
// row produced by any backfill script (filters on metadata->>'backfillId'
// IS NOT NULL).
//
// To register a new backfill:
//   1. Add an entry to BACKFILL_IDS keyed by a short camelCase name and
//      valued at the dated-slug string above.
//   2. Pass that constant down to whatever audit-writing helper the
//      script funnels through (e.g. `excludeLegCore({ ..., backfillId })`)
//      or merge it directly into the `metadata` object on the insert.
//   3. Backfills that don't touch `audit_logs` at all (e.g. the
//      portal-submissions group-link script) still belong in this
//      registry as documentation, but have nothing to stamp.

export const BACKFILL_IDS = {
  // Task #260 retro: auto-exclude blank sibling legs in pre-existing
  // groups. Funnels writes through excludeLegCore so the audit row's
  // metadata.backfillId is set there.
  autoNonIssueSiblings: "2026-05-auto-non-issue-siblings",

  // Task #195 cutover gate: project legacy workflow_progress JSONB onto
  // the new discrete columns + claim_verdict table. Does NOT write to
  // audit_logs (only reads from it), so there's nothing to stamp; the
  // entry exists purely for registry completeness.
  perLegState: "2026-05-per-leg-state",

  // Task #199 cutover prep: populate portal_submissions.invoice_group_id.
  // Does NOT write to audit_logs (only deletes/updates portal rows), so
  // there's nothing to stamp; entry exists for registry completeness.
  portalSubmissionsGroupLink: "2026-05-portal-submissions-group-link",

  // Older one-shot heal in artifacts/api-server/scripts: re-syncs
  // disputed-leg status when it drifted from its group's status. Writes
  // an audit row per healed leg.
  disputedChildSync: "api-server-backfill-disputed-child-sync",

  // Task #283 (+ Task #284 extension): clear the lingering "Unprocessed"
  // badge on phrase-signature acknowledgment receipts that landed BEFORE
  // `shouldAutoMarkProcessed` shipped. Writes a single summary audit_logs
  // row when at least one portal_responses row is flipped (claim_id and
  // invoice_group_id are both null on that summary row). Task #284 added a
  // `--include-retro` flag that broadens the cleanup to also clear
  // retro_phrase_signature acks (operationally identical, just stamped by
  // the one-shot reclassify-confirmation-emails backfill); the summary
  // row records `metadata.includeRetro` and `metadata.classifierSources`
  // so the cohort the run targeted is discoverable after the fact.
  clearPhraseSignatureAckProcessed: "2026-05-clear-phrase-signature-ack-processed",

  // Task #301: backfill `claims.sop_outcome` for legs that were filed
  // before the invoice-group flow shipped. The 2026-05 cutover migrations
  // swept these legs into invoice groups but left their per-leg state
  // empty, which kept the modern verdict gate from accepting them. The
  // script stamps `'portal_dispute'` or `'dispute'` based on hard
  // evidence of a prior submission and writes one
  // `leg_sop_outcome_backfilled` audit row per healed leg.
  preGroupLegSopOutcome: "2026-05-pre-group-leg-sop-outcome",
} as const;

export type BackfillId = (typeof BACKFILL_IDS)[keyof typeof BACKFILL_IDS];

/**
 * Merge `backfillId` into a metadata object for an audit_logs row produced
 * by a one-shot backfill. Use this in scripts that insert into audit_logs
 * directly. Scripts that funnel through a shared helper (e.g.
 * `excludeLegCore`) should pass the id through that helper instead.
 *
 * Returns a new object — does not mutate the input.
 */
export function withBackfillId<M extends Record<string, unknown>>(
  metadata: M,
  backfillId: BackfillId,
): M & { backfillId: BackfillId } {
  return { ...metadata, backfillId };
}
