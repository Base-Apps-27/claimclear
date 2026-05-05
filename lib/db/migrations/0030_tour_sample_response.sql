-- 0030_tour_sample_response.sql
--
-- Extends the migration-0029 tour-sample pattern to portal_responses so
-- tour step 14 (Responses Awaiting Review) can be a real anchored
-- 3-card walk (Thread / AI Read / Decide) instead of the simplified
-- centered modal it had to be reduced to after repeated white-screen
-- crashes when the page had no row to anchor to.
--
-- The seeded portal_response is linked to the existing tour-sample
-- invoice group + claim from migration 0029 and is hidden from every
-- normal list/aggregate query, read-only at the API layer. See:
--   - artifacts/api-server/src/routes/tour.ts (GET /tour/sample)
--   - artifacts/api-server/src/lib/tour-sample.ts (mutation guards)
--
-- Singleton enforcement: partial unique index on `is_tour_sample = TRUE`
-- means at most one tour-sample response can exist; a buggy re-seed
-- can never quietly create duplicates.
--
-- Idempotent: column add uses IF NOT EXISTS, index uses IF NOT EXISTS,
-- and the seed insert is guarded by a presence check so re-running
-- the migration is a no-op.

BEGIN;

ALTER TABLE portal_responses
  ADD COLUMN IF NOT EXISTS is_tour_sample boolean NOT NULL DEFAULT FALSE;

CREATE UNIQUE INDEX IF NOT EXISTS portal_responses_singleton_tour_sample_idx
  ON portal_responses ((is_tour_sample))
  WHERE is_tour_sample = TRUE;

COMMENT ON COLUMN portal_responses.is_tour_sample IS
  'TRUE for the single global portal_response used by the in-app guided tour (step 14). Filtered out of every normal list/aggregate query and read-only at the API layer. See migration 0030.';

DO $$
DECLARE
  v_group_id integer;
  v_claim_id integer;
BEGIN
  SELECT id INTO v_group_id FROM invoice_groups WHERE is_tour_sample = TRUE LIMIT 1;
  SELECT id INTO v_claim_id FROM claims          WHERE is_tour_sample = TRUE LIMIT 1;

  -- Migration 0029 must have seeded the group + claim; bail loudly if
  -- it didn't so the operator knows the migrations are out of order.
  IF v_group_id IS NULL OR v_claim_id IS NULL THEN
    RAISE EXCEPTION 'tour_sample group/claim not present — migration 0029 must run before 0030';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM portal_responses WHERE is_tour_sample = TRUE) THEN
    INSERT INTO portal_responses (
      claim_id,
      invoice_group_id,
      submission_id,
      source,
      "responseType",
      subject,
      content,
      raw_content,
      body_format,
      sender_email,
      sender_name,
      matched_via,
      match_confidence,
      processed,
      auto_linked,
      ai_summary,
      classifier_source,
      classifier_confidence,
      received_at,
      is_tour_sample
    ) VALUES (
      v_claim_id,
      v_group_id,
      NULL,
      'portal',
      'denial',
      'Re: TOUR-SAMPLE-INV — Distance dispute denied',
      E'Hello,\n\nWe reviewed the dispute on confirmation TOUR-CONF-0001 (car CAR-007). Per our records the trip distance recorded by the driver matches the geocoded route distance. The wrong-distance claim is denied. If you have GPS evidence showing a longer route was required, attach it and re-submit within 30 days.\n\n— MAS Audit',
      E'<p>Hello,</p><p>We reviewed the dispute on confirmation <strong>TOUR-CONF-0001</strong> (car CAR-007). Per our records the trip distance recorded by the driver matches the geocoded route distance. The wrong-distance claim is <strong>denied</strong>. If you have GPS evidence showing a longer route was required, attach it and re-submit within 30 days.</p><p>— MAS Audit</p>',
      'html',
      'audit@masride-sample.invalid',
      'MAS Audit (sample)',
      'manual',
      'high',
      FALSE,
      FALSE,
      'MAS denied the wrong-distance dispute, citing matching GPS distances. They invite a re-submission with explicit GPS evidence within 30 days.',
      'tour_sample_seed',
      'high',
      TIMESTAMPTZ '2020-01-02 09:00:00+00',
      TRUE
    );
  END IF;
END $$;

COMMIT;
