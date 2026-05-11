-- Saturday Load-Test Deep Mining — SQL #1: scope window discovery.
--
-- Confirms the active window. Saturday May 9, 2026 in EDT (UTC-4) =
-- 2026-05-09 04:00:00+00 → 2026-05-10 04:00:00+00 UTC.

-- Per-table row counts in the candidate window (UTC, +/- one day).
SELECT 'audit_logs' AS table, MIN(timestamp) AS min_ts, MAX(timestamp) AS max_ts, COUNT(*) AS n
FROM audit_logs WHERE timestamp >= '2026-05-08' AND timestamp < '2026-05-11'
UNION ALL SELECT 'state_events',  MIN(created_at),    MAX(created_at),    COUNT(*)
FROM state_events WHERE created_at >= '2026-05-08' AND created_at < '2026-05-11'
UNION ALL SELECT 'presence_logs', MIN(last_heartbeat), MAX(last_heartbeat), COUNT(*)
FROM presence_logs WHERE last_heartbeat >= '2026-05-08' AND last_heartbeat < '2026-05-11'
UNION ALL SELECT 'claim_verdict', MIN(created_at), MAX(created_at), COUNT(*)
FROM claim_verdict WHERE created_at >= '2026-05-08' AND created_at < '2026-05-11'
UNION ALL SELECT 'portal_submissions', MIN(created_at), MAX(created_at), COUNT(*)
FROM portal_submissions WHERE created_at >= '2026-05-08' AND created_at < '2026-05-11'
UNION ALL SELECT 'bot_activity_log',   MIN(created_at), MAX(created_at), COUNT(*)
FROM bot_activity_log WHERE created_at >= '2026-05-08' AND created_at < '2026-05-11';

-- Per-hour audit-event volume (used to confirm Saturday is the load-test day).
SELECT date_trunc('hour', timestamp) AS hr, COUNT(*) AS n
FROM audit_logs WHERE timestamp >= '2026-05-08' AND timestamp < '2026-05-11'
GROUP BY 1 ORDER BY 1;

-- Per-operator audit volume Saturday (EDT). Used to identify the operator set
-- vs. test/admin/bot accounts to exclude.
SELECT user_email,
       COUNT(*) FILTER (WHERE timestamp >= '2026-05-09 04:00:00+00'
                         AND timestamp < '2026-05-10 04:00:00+00') AS sat_n,
       MIN(timestamp) AS first_seen,
       MAX(timestamp) AS last_seen
FROM audit_logs
WHERE timestamp >= '2026-05-08' AND timestamp < '2026-05-11'
GROUP BY 1
ORDER BY sat_n DESC NULLS LAST;
