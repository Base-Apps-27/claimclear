-- Backfill: set included_in_dispute = false for New legs with no error type.
-- These legs are clean lines that should not appear in the dispute work queue.
-- The migration is idempotent — re-running it after the first pass is a no-op
-- because the WHERE clause filters rows already set to false.

DO $$
DECLARE
  v_changed integer;
BEGIN
  WITH updated AS (
    UPDATE claims
    SET    included_in_dispute = false
    WHERE  error_type_id IS NULL
      AND  included_in_dispute = true
      AND  status = 'New'
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_changed FROM updated;

  RAISE NOTICE 'backfill 0012: flipped % claim row(s) to included_in_dispute=false', v_changed;
END $$;

-- Verification query (re-runnable, paste into psql to confirm the backfill):
--
--   SELECT included_in_dispute, COUNT(*)
--   FROM   claims
--   WHERE  error_type_id IS NULL AND status = 'New'
--   GROUP  BY included_in_dispute;
--
--   After backfill: only the false bucket should be non-empty.
