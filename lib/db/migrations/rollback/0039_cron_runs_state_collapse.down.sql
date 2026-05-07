-- Rollback for 0039_cron_runs_state_collapse.sql
--
-- The forward migration is a one-way data normalisation: 'ok' and
-- 'degraded' rows were rewritten to 'completed'/'failed', and the
-- original producer signal is not preserved per-row. A faithful
-- rollback would need a backup table to restore from — we do NOT
-- create one in the forward migration because (a) the legacy strings
-- carried no information the new strings don't (ok = completed, and
-- 'degraded' rows still have the partial-success narrative in
-- `message`) and (b) the column is a write-once audit log; readers
-- never differentiated 'ok' from 'completed' beyond the §G
-- fingerprint count this migration was written to clear.
--
-- This rollback therefore only undoes the schema change (the CHECK
-- constraint). Application code shipped in the same wave (the
-- `mapResultStatus` shim in cron-runs.ts) MUST be reverted in lockstep
-- if the constraint is dropped, otherwise new writes will continue to
-- emit {completed | failed} and a re-apply of 0039 is required to
-- reattach the constraint.

ALTER TABLE cron_runs
  DROP CONSTRAINT IF EXISTS cron_runs_status_check;
