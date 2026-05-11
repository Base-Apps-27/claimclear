-- Saturday Load-Test Deep Mining — SQL #2: raw dumps under raw/.
--
-- Each statement was wrapped with `SELECT jsonb_agg(t) FROM (…) t` and the
-- result was streamed to reports/saturday-load-test-mining/raw/<name>.json by
-- scripts/analyze.mjs's helper. Audit_logs had to be chunked by 30-minute
-- slices for the 18:00–20:00 UTC peak (~2400 rows in 2h) — see chunk loop in
-- the dump driver. All other dumps fit in a single round-trip.
--
-- Operator filter applied to user-emitting tables. NULL is preserved for
-- audit_logs/state_events because system writes are valuable for joining
-- record state changes; they get tagged 'system' downstream.

\set window_start '2026-05-09 04:00:00+00'
\set window_end   '2026-05-10 04:00:00+00'
\set excluded_emails $$('system@claimclear', 'system@claimclear-heal', 'system', 'z7ytv7jcb4@privaterelay.appleid.com')$$

-- audit_logs (chunked by 30-min slice in the driver to stay under tool size cap).
SELECT id, claim_id, invoice_group_id, action, details, metadata, user_email, user_name, timestamp
FROM audit_logs
WHERE timestamp >= :'window_start' AND timestamp < :'window_end'
  AND (user_email IS NULL OR user_email NOT IN :excluded_emails)
ORDER BY timestamp;

-- state_events (single round-trip, ~2.7k rows).
SELECT id, claim_id, invoice_group_id, event_key, event_phase, actor_user_id,
       metadata, duration_ms, created_at
FROM state_events
WHERE created_at >= :'window_start' AND created_at < :'window_end'
ORDER BY created_at;

-- presence_logs (sparse — see data-gaps section of the report).
SELECT id, user_email, user_name, resource_type, resource_id, last_heartbeat
FROM presence_logs
WHERE last_heartbeat >= :'window_start' AND last_heartbeat < :'window_end'
  AND (user_email IS NULL OR user_email NOT IN :excluded_emails)
ORDER BY last_heartbeat;

-- claim_verdict.
SELECT id, claim_id, source, outcome, confidence, inspection_time_ms,
       created_by, created_at
FROM claim_verdict
WHERE created_at >= :'window_start' AND created_at < :'window_end'
ORDER BY created_at;

-- portal_submissions.
SELECT id, invoice_group_id, status, attempts, requester_email,
       claimed_by_user_name, created_at, submitted_at
FROM portal_submissions
WHERE created_at >= :'window_start' AND created_at < :'window_end'
ORDER BY created_at;

-- bot_activity_log.
SELECT id, submission_id, action, success, message, created_at
FROM bot_activity_log
WHERE created_at >= :'window_start' AND created_at < :'window_end'
ORDER BY created_at;

-- claims_touched (joined by claim_id from audit/state above).
SELECT id, invoice_group_id, conf_number, status, outcome, disposition, sop_node_id,
       sop_answers, sop_outcome, drop_reason, error_type_id, error_type_name,
       included_in_dispute, ready_at, created_at, updated_at,
       attestation_state, hold_reason
FROM claims
WHERE id = ANY(:'touched_claim_ids'::int[]);

-- groups_touched (joined by invoice_group_id from audit/state above).
SELECT id, invoice_number, status, outcome, phase, phase_entered_at,
       error_type_id, error_type_name, draft_subject, draft_edited_at,
       draft_reviewed_at, preview_generated_at, preview_generated_by,
       understanding_readback_at, ride_count, total_amount,
       created_at, updated_at, hold_reason, closure_reason
FROM invoice_groups
WHERE id = ANY(:'touched_group_ids'::int[]);

-- error_types (decision trees for SOP node-name lookup).
SELECT id, name, category, decision_tree FROM error_types;
