-- 0040_vocab_cleanup_backfill.sql
-- Wave D-PR6 / Sub-PR 7 (2026-05-07).
--
-- Two trivial vocabulary backfills surfaced by the §G state-fingerprint
-- on PROD this session. Both are pre-vocab strings that survived the
-- Task #160 closure-reason consolidation (`cannot_dispute`,
-- `non_issue`, `denied_by_payor`) and the hold-reason vocab cutover.
--
-- 1. claims.closure_reason: rows id=163 ('accepted_loss') and
--    id=240 ('not_contestable') both predate the consolidation. Both
--    canonical-map to 'cannot_dispute' (the operator could not
--    successfully dispute the leg). Targeted by id rather than by
--    value so we don't accidentally rewrite future rows that pick up
--    the same legacy strings via an import.
--
-- 2. invoice_groups.hold_reason: one prod row (id=32) holds the
--    free-text "MAS needs to fix date of service in the portal." —
--    awaiting an external party (MAS, the payor). Maps to the
--    'awaiting_external_party' enum value. Same id-targeted update
--    so any post-vocab free-text strings (none today) aren't
--    silently rewritten.
--
-- Idempotent: each UPDATE is keyed on the original legacy value AND
-- the row id, so re-running is a no-op once applied.
--
-- Reversibility: `migrations/rollback/0040_…down.sql` restores the
-- original strings.
--
-- Conformance: drops `claim_closure_drift` (2 → 0) and `hold_drift`
-- (1 → 0) on the next §G run after the publish.

BEGIN;

UPDATE claims
SET closure_reason = 'cannot_dispute'
WHERE id = 163 AND closure_reason = 'accepted_loss';

UPDATE claims
SET closure_reason = 'cannot_dispute'
WHERE id = 240 AND closure_reason = 'not_contestable';

UPDATE invoice_groups
SET hold_reason = 'awaiting_external_party'
WHERE id = 32 AND hold_reason = 'MAS needs to fix date of service in the portal. ';

COMMIT;
