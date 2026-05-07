-- 0034_invoice_phase_and_disposition.down.sql
-- Reversibility for Wave B. The migration runner does NOT auto-apply this
-- file; it lives here so a rollback is one copy-paste away. No application
-- code reads `phase` or `disposition` until Wave C ships, so dropping these
-- columns is behaviorally invisible.

BEGIN;

DROP TRIGGER IF EXISTS claims_disposition_phase_chk ON claims;
DROP FUNCTION IF EXISTS validate_disposition_against_phase();

DROP INDEX IF EXISTS claims_invoice_group_disposition_idx;
DROP INDEX IF EXISTS claims_disposition_idx;
DROP INDEX IF EXISTS invoice_groups_phase_idx;

ALTER TABLE claims DROP COLUMN IF EXISTS disposition;
ALTER TABLE invoice_groups DROP COLUMN IF EXISTS phase_entered_at;
ALTER TABLE invoice_groups DROP COLUMN IF EXISTS phase;

DROP TYPE IF EXISTS claim_disposition;
DROP TYPE IF EXISTS invoice_phase;

DELETE FROM __schema_migrations WHERE id = '0034_invoice_phase_and_disposition.sql';

COMMIT;
