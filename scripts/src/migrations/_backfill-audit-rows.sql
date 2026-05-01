-- Saved query: list every audit_logs row produced by any one-shot
-- backfill script (Task #268 convention).
--
-- Convention: every backfill script that writes into audit_logs stamps
-- metadata.backfillId with the dated-slug constant defined in
-- scripts/src/migrations/_backfill-audit.ts. Filter on that one field
-- regardless of which script ran.
--
-- Usage:
--   psql ... -f scripts/src/migrations/_backfill-audit-rows.sql
--
-- Optional: narrow to a single backfill by uncommenting the AND clause
-- below and substituting the desired id (see BACKFILL_IDS for the full
-- registered list).

SELECT
    id,
    timestamp,
    action,
    claim_id,
    invoice_group_id,
    user_email,
    metadata->>'backfillId'   AS backfill_id,
    metadata->>'source'       AS source,
    metadata->>'reason'       AS reason,
    metadata
FROM audit_logs
WHERE metadata ? 'backfillId'
  -- AND metadata->>'backfillId' = '2026-05-auto-non-issue-siblings'
ORDER BY timestamp DESC, id DESC;

-- Quick aggregate companion: count rows per backfill, useful as a
-- post-run sanity check.
--
-- SELECT metadata->>'backfillId' AS backfill_id, count(*)
-- FROM audit_logs
-- WHERE metadata ? 'backfillId'
-- GROUP BY 1
-- ORDER BY 2 DESC;
