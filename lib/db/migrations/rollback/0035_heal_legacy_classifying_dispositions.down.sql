-- 0035_heal_legacy_classifying_dispositions.down.sql
-- Reverts the 0035 heal. Only useful inside a full Wave B rollback flow
-- (after 0034.down.sql drops the trigger) — re-applying `classifying` while
-- the trigger is active would otherwise be rejected for non-triage parents.

BEGIN;

UPDATE claims c
SET disposition = 'classifying'::claim_disposition
WHERE c.disposition IN ('disposed_portal', 'disposed_email')
  AND c.invoice_group_id IN (
    SELECT id FROM invoice_groups
    WHERE phase IN ('ready_to_submit', 'submitted')
  );

DELETE FROM __schema_migrations WHERE id = '0035_heal_legacy_classifying_dispositions.sql';

COMMIT;
