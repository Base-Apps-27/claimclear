-- 0003_backfill_processed_status.sql
--
-- Backfill `claims.status` to match the new per-leg projector rules
-- in artifacts/api-server/src/lib/denormalized-cache.ts. The projector
-- is now SOP-outcome-aware, so legs whose worktree has produced a
-- dispute outcome surface as "Processed" instead of being collapsed
-- into the parent group's status.
--
-- Rule precedence (mirrors the projector):
--   1. Per-leg hold (hold_reason IS NOT NULL OR sop_outcome = 'hold')
--      → "On Hold". Always wins.
--   2. Group's macro phase:
--      pre-submit         → portal_dispute|dispute → "Processed"
--                          cannot_dispute|non_issue → leave as-is (closed
--                            or withdrawn outcome already carries the
--                            appropriate status)
--                          NULL → mirror group.status (New|Needs Evidence)
--      in-flight          → "Awaiting Response"
--      response-pending   → mirror group.status (Ready to Review|Needs Review)
--      closed/derived     → mirror group.status (typically Resolved)
--      on-hold            → "On Hold"
--
-- Standalone legs (invoice_group_id IS NULL) are untouched — the
-- projector also leaves them alone.
--
-- Idempotent: every UPDATE has a `WHERE claims.status IS DISTINCT FROM
-- target` guard so a re-run is a no-op once the row is already at the
-- new status. Safe to apply repeatedly during dev pushes.
--
-- Audit: every flipped row gets a single state_events / audit_logs row
-- so the per-leg history reads "Status changed from X to Y by
-- backfill #231". The actor is the synthetic "system:backfill" so
-- presence/lock filters don't show a phantom user.

DO $$
DECLARE
  v_actor       text := 'system:backfill';
  v_reason      text := 'backfill #231: processed-status projector rewrite';
  v_total       integer := 0;
  v_held        integer := 0;
  v_processed   integer := 0;
  v_pre_mirror  integer := 0;
  v_inflight    integer := 0;
  v_resp_mirror integer := 0;
  v_closed      integer := 0;
BEGIN
  -- Stage the desired projection for every leg with a parent group.
  -- The CTE encodes the projector rules above so the UPDATE statements
  -- below stay declarative and easy to audit.
  CREATE TEMP TABLE _backfill_231 ON COMMIT DROP AS
  SELECT
    c.id                         AS claim_id,
    c.status                     AS old_status,
    CASE
      -- Rule 1: per-leg hold wins.
      WHEN c.hold_reason IS NOT NULL OR c.sop_outcome = 'hold' THEN 'On Hold'::claim_status

      -- Rule 2a: pre-submit phase.
      WHEN g.status IN ('New','Needs Evidence') THEN
        CASE
          WHEN c.sop_outcome IN ('portal_dispute','dispute') THEN 'Processed'::claim_status
          -- cannot_dispute / non_issue: keep current status (excluded
          -- legs already carry the right closed/withdrawn value).
          WHEN c.sop_outcome IN ('cannot_dispute','non_issue') THEN c.status
          -- NULL: mirror the group.
          ELSE g.status
        END

      -- Rule 2b: in-flight phase. Collapse confirmed acceptable.
      WHEN g.status IN ('Portal Queued','Generating Email','Awaiting Response')
        THEN 'Awaiting Response'::claim_status

      -- Rule 2c: response-pending phase. Mirror the group.
      WHEN g.status IN ('Ready to Review','Needs Review') THEN g.status

      -- Rule 2d: closed phase. Mirror (typically Resolved/Denied/Withdrawn).
      WHEN g.status IN ('Resolved','Denied') THEN g.status

      -- Rule 2e: explicit on-hold group.
      WHEN g.status = 'On Hold' THEN 'On Hold'::claim_status

      -- Defensive default: leave as-is if the group status is unknown.
      ELSE c.status
    END AS new_status
  FROM   claims c
  JOIN   invoice_groups g ON g.id = c.invoice_group_id
  WHERE  c.invoice_group_id IS NOT NULL;

  -- Diagnostic counts (non-blocking, surface in psql output).
  SELECT COUNT(*)
    INTO v_total
    FROM _backfill_231
   WHERE old_status IS DISTINCT FROM new_status;

  SELECT COUNT(*) INTO v_held
    FROM _backfill_231 WHERE new_status = 'On Hold' AND old_status IS DISTINCT FROM new_status;
  SELECT COUNT(*) INTO v_processed
    FROM _backfill_231 WHERE new_status = 'Processed' AND old_status IS DISTINCT FROM new_status;
  SELECT COUNT(*) INTO v_pre_mirror
    FROM _backfill_231 WHERE new_status IN ('New','Needs Evidence')
      AND old_status IS DISTINCT FROM new_status;
  SELECT COUNT(*) INTO v_inflight
    FROM _backfill_231 WHERE new_status = 'Awaiting Response'
      AND old_status IS DISTINCT FROM new_status;
  SELECT COUNT(*) INTO v_resp_mirror
    FROM _backfill_231 WHERE new_status IN ('Ready to Review','Needs Review')
      AND old_status IS DISTINCT FROM new_status;
  SELECT COUNT(*) INTO v_closed
    FROM _backfill_231 WHERE new_status IN ('Resolved','Denied')
      AND old_status IS DISTINCT FROM new_status;

  RAISE NOTICE 'backfill 0003 #231: total=% held=% processed=% pre_mirror=% inflight=% resp_mirror=% closed=%',
    v_total, v_held, v_processed, v_pre_mirror, v_inflight, v_resp_mirror, v_closed;

  -- Audit-log every row that will actually flip. We write to
  -- audit_logs (the canonical per-row history table) so the leg
  -- timeline shows the backfill alongside operator-driven changes.
  -- We deliberately do NOT write to state_events: that table is for
  -- live state machine transitions, and a backfill is a corrective
  -- pass, not a transition.
  INSERT INTO audit_logs (claim_id, action, details, metadata, user_email, user_name, timestamp)
  SELECT
    b.claim_id,
    'status_changed',
    'Status changed from ' || b.old_status::text || ' to ' || b.new_status::text || ' (' || v_reason || ')',
    jsonb_build_object(
      'previousStatus', b.old_status,
      'newStatus',      b.new_status,
      'reason',         v_reason,
      'source',         'backfill'
    ),
    v_actor,
    v_actor,
    NOW()
  FROM _backfill_231 b
  WHERE b.old_status IS DISTINCT FROM b.new_status;

  -- Apply the projection. The IS DISTINCT FROM guard preserves
  -- idempotence when the migration is re-applied.
  UPDATE claims c
  SET    status = b.new_status
  FROM   _backfill_231 b
  WHERE  c.id = b.claim_id
    AND  c.status IS DISTINCT FROM b.new_status;
END $$;

-- Verification query (re-runnable):
--
--   SELECT g.status AS group_status, c.sop_outcome, c.hold_reason IS NOT NULL AS held, c.status AS leg_status, COUNT(*)
--   FROM   claims c JOIN invoice_groups g ON g.id = c.invoice_group_id
--   GROUP  BY 1,2,3,4
--   ORDER  BY 1,2,3,4;
--
-- Pre-submit + sop_outcome IN ('portal_dispute','dispute') with no
-- hold should all show leg_status='Processed'. Held legs should all
-- show leg_status='On Hold' regardless of sop_outcome.
