-- 0036_invoice_groups_and_claims_is_open.down.sql
-- Reversibility for migration 0036. Drops the GENERATED `is_open` columns
-- and their partial indexes from `invoice_groups` and `claims`. No data
-- loss: nothing writes to `is_open` (it is GENERATED ALWAYS AS …).

BEGIN;

DROP INDEX IF EXISTS claims_is_open_invoice_group_idx;
DROP INDEX IF EXISTS claims_is_open_idx;
DROP INDEX IF EXISTS invoice_groups_is_open_idx;

ALTER TABLE claims DROP COLUMN IF EXISTS is_open;
ALTER TABLE invoice_groups DROP COLUMN IF EXISTS is_open;

COMMIT;
