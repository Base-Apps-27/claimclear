-- 0029_tour_sample.sql
--
-- Adds a single global "tour sample" invoice group + claim that the
-- in-app guided tour can navigate to so steps 18 (group detail) and 20
-- (claim detail) anchor on real selectors instead of falling back to
-- centered modals on the list pages. The pair is HIDDEN from every
-- normal list/aggregate query (filtered by `is_tour_sample = false`)
-- and READ-ONLY (every mutation handler 403s when the target row has
-- the flag set). See:
--   - artifacts/api-server/src/routes/tour.ts (GET /tour/sample)
--   - artifacts/api-server/src/lib/tour-sample.ts (assertNotTourSample)
--
-- Singleton enforcement: partial unique index on `is_tour_sample = TRUE`
-- means the table can hold at most one tour-sample row, so a buggy
-- re-seed can never quietly create duplicates.
--
-- The seeded service_date is intentionally far in the past so the row
-- would also be filtered by the standard "hide past-deadline" rules if
-- the is_tour_sample filter were ever bypassed.
--
-- Idempotent: column additions use IF NOT EXISTS, indexes use IF NOT
-- EXISTS, and the seed inserts are guarded by a presence check so
-- re-running the migration is a no-op.

BEGIN;

ALTER TABLE invoice_groups
  ADD COLUMN IF NOT EXISTS is_tour_sample boolean NOT NULL DEFAULT FALSE;

ALTER TABLE claims
  ADD COLUMN IF NOT EXISTS is_tour_sample boolean NOT NULL DEFAULT FALSE;

CREATE UNIQUE INDEX IF NOT EXISTS invoice_groups_singleton_tour_sample_idx
  ON invoice_groups ((is_tour_sample))
  WHERE is_tour_sample = TRUE;

CREATE UNIQUE INDEX IF NOT EXISTS claims_singleton_tour_sample_idx
  ON claims ((is_tour_sample))
  WHERE is_tour_sample = TRUE;

COMMENT ON COLUMN invoice_groups.is_tour_sample IS
  'TRUE for the single global invoice group used by the in-app guided tour. Filtered out of every normal list/aggregate query and read-only at the API layer. See migration 0029.';

COMMENT ON COLUMN claims.is_tour_sample IS
  'TRUE for the single global claim used by the in-app guided tour. Filtered out of every normal list/aggregate query and read-only at the API layer. See migration 0029.';

DO $$
DECLARE
  v_group_id integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM invoice_groups WHERE is_tour_sample = TRUE) THEN
    INSERT INTO invoice_groups (
      invoice_number,
      client_number,
      error_details,
      error_type_id,
      error_type_name,
      status,
      outcome,
      ride_count,
      total_amount,
      service_date,
      is_tour_sample
    ) VALUES (
      'TOUR-SAMPLE-INV',
      'TOUR-CLIENT-001',
      'Sample invoice group used by the in-app guided tour. This row is hidden from normal queries and read-only.',
      'wrong_distance',
      'Wrong Distance',
      'Needs Evidence',
      'Pending',
      1,
      125.00,
      DATE '2020-01-01',
      TRUE
    )
    RETURNING id INTO v_group_id;
  ELSE
    SELECT id INTO v_group_id FROM invoice_groups WHERE is_tour_sample = TRUE LIMIT 1;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM claims WHERE is_tour_sample = TRUE) THEN
    INSERT INTO claims (
      invoice_group_id,
      conf_number,
      date,
      ref_number,
      client_number,
      car_number,
      error_details,
      error_type_id,
      error_type_name,
      claim_amount,
      status,
      outcome,
      included_in_dispute,
      is_tour_sample
    ) VALUES (
      v_group_id,
      'TOUR-CONF-0001',
      DATE '2020-01-01',
      'TOUR-REF-0001',
      'TOUR-CLIENT-001',
      'CAR-007',
      'Sample claim used by the in-app guided tour. This row is hidden from normal queries and read-only.',
      'wrong_distance',
      'Wrong Distance',
      125.00,
      'Needs Evidence',
      'Pending',
      TRUE,
      TRUE
    );
  END IF;
END $$;

COMMIT;
