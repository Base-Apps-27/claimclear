#!/usr/bin/env bash
# Wave-E preflight audit (state-hierarchy-execution-plan.md §8 step E.1).
#
# Counts only the *real* references to legacy state columns — i.e. the
# columns Wave E will drop:
#
#   invoice_groups.status, invoice_groups.outcome
#   claims.status, claims.outcome, claims.sop_outcome,
#   claims.attestation_state, claims.drop_reason
#
# A naive `rg "\.status|\.outcome"` produces hundreds of false positives
# (HTTP `res.status(...)`, fetch `response.status`, cron `last.status`,
# connector_health `last.status`, parser `phraseResult.outcome`, …).
# This script narrows to the unambiguous Drizzle column-reference shapes
# and prefixed identifiers we actually care about, and prints both a
# count and the matching lines so a non-zero result is actionable.
#
# Wave-E gate: every category below must be 0 (modulo the documented
# exceptions in the execution plan §8 step E.1: lib/invoice-state/, test
# files, portal_submissions table, cohesion/tone.ts deprecated
# passthrough, lib/lifecycle-phase.ts).
#
# Exit semantics: ALWAYS exits 0 — informational. Wire into CI as a
# blocking step only when you're inside the Wave-E PR itself.

set -uo pipefail

cd "$(dirname "$0")/../../.."

echo "── Wave-E preflight ($(date -u +%Y-%m-%dT%H:%M:%SZ)) ──"

API_GLOBS=(
  "-g" "artifacts/api-server/src/**"
  "-g" "!artifacts/api-server/src/**/__tests__/**"
  "-g" "!artifacts/api-server/src/**/*.test.ts"
  "-g" "!artifacts/api-server/src/scripts/**"           # one-shot backfills, dropped post-Wave-E
)

WEB_GLOBS=(
  "-g" "artifacts/claimclear/src/**"
  "-g" "!artifacts/claimclear/src/**/__tests__/**"
  "-g" "!artifacts/claimclear/src/**/*.test.ts"
  "-g" "!artifacts/claimclear/src/lib/lifecycle-phase.ts"          # exec-plan §8 E.6 deletes this
  "-g" "!artifacts/claimclear/src/components/cohesion/tone.ts"     # exec-plan §8 E.6 deletes toneForStatus
)

# Patterns that unambiguously reference the legacy columns:
#
# - `claimsTable.status|outcome|sopOutcome|attestationState|dropReason`
# - `invoiceGroupsTable.status|outcome`
# - `claim(s)?.sopOutcome|attestationState|dropReason` (these names exist
#   only on the claim row shape; no false positives)
# - `claim_status|claim_outcome` enum names
#
# `.status|.outcome` alone are NOT used as patterns — too many false
# positives. The Wave-E final pre-flight (per execution plan A2 §8) uses
# this filtered set.
PATTERNS=(
  '\bclaimsTable\.(status|outcome|sopOutcome|attestationState|dropReason)\b'
  '\binvoiceGroupsTable\.(status|outcome)\b'
  '\b(claim|c|leg)\.(sopOutcome|attestationState|dropReason)\b'
  '\b(group|g|invoiceGroup)\.outcome\b'
  '\bclaim_status\b|\bclaim_outcome\b'
  '\bclaimStatusEnum\b|\bclaimOutcomeEnum\b'
)

run_audit() {
  local label="$1"
  shift
  local globs=("$@")
  local total=0
  local detail=""
  for pattern in "${PATTERNS[@]}"; do
    local hits
    hits=$(rg --no-heading -n "$pattern" "${globs[@]}" 2>/dev/null || true)
    if [ -n "$hits" ]; then
      local n
      n=$(printf '%s\n' "$hits" | wc -l)
      total=$((total + n))
      detail+=$'\n  ['"$pattern"$']'$'\n'"$(printf '%s\n' "$hits" | sed 's/^/    /')"$'\n'
    fi
  done
  printf "   %-50s %d\n" "$label" "$total"
  if [ "$total" -gt 0 ]; then
    printf '%s' "$detail"
  fi
}

run_audit "api-server  legacy-column refs (lib + routes)" "${API_GLOBS[@]}"
run_audit "claimclear  legacy-column refs (src/)"          "${WEB_GLOBS[@]}"

# A2 SSE consumer audit — must be 0 before Wave E.
SSE_HITS=$(rg --no-heading -n 'event\.status|event\.outcome|event\?\.status|event\?\.outcome' \
  artifacts/claimclear/src/ 2>/dev/null || true)
SSE_COUNT=0
[ -n "$SSE_HITS" ] && SSE_COUNT=$(printf '%s\n' "$SSE_HITS" | wc -l)
printf "   %-50s %d\n" "claimclear  SSE consumers reading event.{status,outcome}" "$SSE_COUNT"
[ "$SSE_COUNT" -gt 0 ] && printf '%s\n' "$SSE_HITS" | sed 's/^/      /'

# A5 fixture-vocab audit — by Wave-E end this should be 0; during Wave-D
# soak it can be > 0.
FIXTURE_HITS=$(rg --no-heading -n 'PHASE_TO_LEGACY_STATUS|status: PHASE_TO_LEGACY' \
  artifacts/api-server/src/__tests__/ 2>/dev/null || true)
FIXTURE_COUNT=0
[ -n "$FIXTURE_HITS" ] && FIXTURE_COUNT=$(printf '%s\n' "$FIXTURE_HITS" | wc -l)
printf "   %-50s %d\n" "test fixtures emitting old-vocab status field"          "$FIXTURE_COUNT"

# Vocab files that the execution plan §8 E.3/E.6 deletes wholesale.
VOCAB_FILES=(
  "lib/vocab/src/claim-status.ts"
  "lib/vocab/src/outcome.ts"
  "lib/vocab/src/leg-sub-status.ts"
  "lib/vocab/src/leg-conclusion.ts"
  "lib/vocab/src/closure-reason.ts"
  "lib/vocab/src/hold-reason.ts"
  "lib/vocab/src/submission-stage.ts"
  "lib/vocab/src/verbs.ts"
  "lib/vocab/src/forbidden-literals.ts"
  "artifacts/claimclear/src/lib/lifecycle-phase.ts"
  "artifacts/api-server/src/lib/macro-phase.ts"
)
present=0
for f in "${VOCAB_FILES[@]}"; do
  [ -f "$f" ] && present=$((present + 1))
done
printf "   %-50s %d (of %d)\n" "legacy vocab files still present" "$present" "${#VOCAB_FILES[@]}"

echo "ℹ️  Wave-E gate: top three counts must be 0; bottom two are informational."
echo "   See docs/architecture/state-hierarchy-execution-plan.md §8 step E.1."

exit 0
