#!/usr/bin/env bash
# Wave D state-fingerprint §G check.
#
# Runs the canonical "is the live DB consistent with the layered state
# contract?" query block from docs/architecture/state-migration-plan.md
# §G against the database pointed to by $DATABASE_URL and prints a
# one-line-per-metric summary. Wired into the schema-drift workflow as
# a session-start ritual: drift in any of these counts means a writer
# (or a one-shot migration) violated the layered terminal contract.
#
# Exit semantics: ALWAYS exits 0. The §G fingerprint is informational
# at session-start — it surfaces drift without blocking the workflow.
# Hard-failing on a legitimate non-zero count (e.g. the 31 fallback
# `unclassified` legs that the operator decided to keep in D-PR6 Half
# B) would force a workflow-level allowlist for every audit decision.
# Read the printed counts at session start, drill into anything that
# moved, and fix forward.
#
# Each query is annotated with the fingerprint key from §G so the
# output lines can be cross-referenced against the migration plan
# without re-reading the SQL.

set -uo pipefail

if [ -z "${DATABASE_URL:-}" ]; then
  echo "ℹ️  state-fingerprint: DATABASE_URL unset — skipping."
  exit 0
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "ℹ️  state-fingerprint: psql not on PATH — skipping."
  exit 0
fi

echo "── §G state-fingerprint ($(date -u +%Y-%m-%dT%H:%M:%SZ)) ──"

# Per §G of the migration plan. Inline rather than sourced from a .sql
# file so the script is self-contained and the per-metric annotation
# stays next to the query that produces it.
#
# Notes on individual queries:
#
# `dual_terminal_violation` — migration 0034 deliberately stamped
# `closure_reason='reattested'` for every `reattest_completed_at IS
# NOT NULL` row (lines 88-89). That dual-stamp is the *intended*
# end-state of the wave-D phase model: `reattest_completed_at` is the
# Layer-1 timestamp, `closure_reason` is the Layer-2 vocabulary, and
# the two coexist by design for the reattested-closure case. The
# fingerprint excludes that legitimate combo so the count surfaces
# only genuinely conflicting dual-stamps (e.g. a row with both
# `reattest_completed_at` and `closure_reason IN ('expired',
# 'cannot_dispute', 'approved')` — those would mean two different
# terminal narratives on one row).
#
# `cron_drift` — count of rows whose `status` is outside the canonical
# {running | completed | failed} vocabulary. Was 2894 in the
# 2026-05-07 prod audit (2892 'ok' + 2 'degraded'); migration 0039
# rewrites those in place and adds a CHECK constraint, so the count
# should sit at 0 from the next publish onwards.

SQL_FILE="$(mktemp -t state-fingerprint.XXXXXX.sql)"
trap 'rm -f "$SQL_FILE"' EXIT

cat > "$SQL_FILE" <<'SQL'
SELECT 'open_groups_missing_closure', COUNT(*)::text
  FROM invoice_groups
 WHERE phase = 'closed'
   AND closure_reason IS NULL
   AND reattest_completed_at IS NULL
UNION ALL
SELECT 'dual_terminal_violation', COUNT(*)::text
  FROM invoice_groups
 WHERE reattest_completed_at IS NOT NULL
   AND closure_reason IS NOT NULL
   AND closure_reason <> 'reattested'
UNION ALL
SELECT 'claim_closure_drift', COUNT(*)::text
  FROM claims
 WHERE closure_reason IS NOT NULL
   AND closure_reason NOT IN ('approved', 'denied', 'cannot_dispute', 'reattested', 'expired')
UNION ALL
SELECT 'cron_drift', COUNT(*)::text
  FROM cron_runs
 WHERE status NOT IN ('running', 'completed', 'failed')
UNION ALL
SELECT 'user_drift', COUNT(*)::text
  FROM users
 WHERE status NOT IN ('pending', 'approved', 'suspended')
UNION ALL
SELECT 'hold_drift', COUNT(*)::text
  FROM invoice_groups
 WHERE status = 'On Hold'
   AND hold_reason IS NOT NULL
   AND hold_reason NOT IN ('awaiting_internal_decision','awaiting_external_party','client_paused','other');
SQL

PSQL_OUT=$(psql "$DATABASE_URL" -At -F'|' -v ON_ERROR_STOP=1 -f "$SQL_FILE" 2>&1)
PSQL_RC=$?

if [ $PSQL_RC -ne 0 ]; then
  echo "⚠️  state-fingerprint query failed (exit $PSQL_RC):"
  echo "$PSQL_OUT" | sed 's/^/     /'
  exit 0
fi

echo "$PSQL_OUT" | awk -F'|' 'BEGIN { any_nonzero = 0 }
{
  printf "   %-32s %s\n", $1, $2
  if ($2 != "0") any_nonzero = 1
}
END {
  if (any_nonzero) {
    print "ℹ️  non-zero counts above — drill into the listed rows; see docs/architecture/state-migration-plan.md §G."
  } else {
    print "✅ all §G fingerprint counts are zero."
  }
}'

exit 0
