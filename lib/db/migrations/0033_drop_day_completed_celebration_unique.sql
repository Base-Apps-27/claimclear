-- Task #495: drop the day-complete celebration partial unique index
-- introduced in migration 0019.
--
-- Day-complete celebrations now fire on every false→true transition of
-- the day-aggregate "concluded" predicate, computed by the calling
-- transition function via a pre-update snapshot. Deduping at the index
-- level prevented later concluded-streaks (e.g. a day that was once
-- concluded, reopened by a manual revert, then re-concluded) from
-- celebrating again. The edge check in `checkAndEmitDayCompleteForGroup`
-- replaces the index-level guard.
--
-- Idempotent: safe to re-run.

BEGIN;

DROP INDEX IF EXISTS state_events_day_completed_celebration_unique;

COMMIT;
