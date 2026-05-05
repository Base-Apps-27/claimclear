-- Task #457: database-level uniqueness guard on group invoice numbers.
--
-- `invoice_groups.invoice_number` was indexed (non-unique) and the
-- only protection against two groups ending up with the same number
-- was an app-level probe inside `applyGroupInvoiceRename` (Task #455
-- Re-attest rename). That guard is correct for the rename path it
-- runs in, but any other code path that inserts/updates the column
-- could quietly create duplicates. This migration promotes the
-- invariant to a database-enforced fact via a unique index.
--
-- Pre-flight: hard-fail if a duplicate already exists. The migration
-- runner aborts on any raised exception so we'll surface the bad
-- rows to the operator instead of silently skipping the index. The
-- error message lists the offending invoice numbers so the operator
-- can investigate before re-running.
--
-- Drops the old non-unique `invoice_groups_invoice_number_idx` and
-- replaces it with a unique index of the same shape — the lookup
-- workload (`WHERE invoice_number = $1`) is identical, so the unique
-- index serves as both the integrity constraint and the lookup
-- index.
--
-- Idempotent: the duplicate check is read-only, the DROP/CREATE use
-- IF EXISTS / IF NOT EXISTS, and the new unique index name differs
-- from the old one so a partial re-run leaves a consistent state.

BEGIN;

DO $$
DECLARE
  v_dupes text;
BEGIN
  SELECT string_agg(invoice_number || ' (' || cnt || ')', ', ')
    INTO v_dupes
  FROM (
    SELECT invoice_number, COUNT(*) AS cnt
    FROM invoice_groups
    GROUP BY invoice_number
    HAVING COUNT(*) > 1
  ) d;

  IF v_dupes IS NOT NULL THEN
    RAISE EXCEPTION
      'Cannot add unique index on invoice_groups.invoice_number: duplicate invoice_number values exist: %',
      v_dupes;
  END IF;
END $$;

DROP INDEX IF EXISTS invoice_groups_invoice_number_idx;

CREATE UNIQUE INDEX IF NOT EXISTS invoice_groups_invoice_number_unique
  ON invoice_groups (invoice_number);

COMMIT;
