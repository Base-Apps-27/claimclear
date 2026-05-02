-- Task #313: day-complete celebration idempotency.
--
-- Adds a partial unique index on `state_events` so we can guarantee
-- AT MOST ONE `day_completed_celebration` row per ISO date, even under
-- concurrent group transitions on the same calendar day.
--
-- The lookup key is (event_key, metadata->>'date'); only rows whose
-- event_key is `day_completed_celebration` participate in the index.
-- All existing/other event keys are unaffected.
--
-- Idempotent: safe to re-run.

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS state_events_day_completed_celebration_unique
  ON state_events (event_key, ((metadata->>'date')))
  WHERE event_key = 'day_completed_celebration';

COMMIT;
