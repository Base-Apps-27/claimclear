# Wave D-PR6 — §3.E aggregates onto `phase` + drop `unclassified` fallback

## Status as of D-PR5 close (2026-05-07)
- D-PR5 shipped: `claims.submitted_via` column + writer stamps + deriver promotion + closure-aware writer + day-complete residual collapse + §3.B Portal-Queued exclusion collapse. See `state-wave-d-pr5-handoff-prompt.md` session log for the merge surface.
- Dev conformance audit: **41 phase_mismatch, 0 is_open** (was 42 at D-PR4 close; monotonic decrease holds). Remaining drift is the documented `Needs Review stored=response_received derived=triage` dev fixture that has been carried since D-PR2b — will heal lazily as cache helpers touch the rows.
- PROD audit (post-publish, expected): **0 phase_mismatch, 0 is_open** once D-PR5 ships and the next bot tick stamps `submitted_via` on any in-flight rows the migration backfill missed. Treat any non-zero count as a regression and bisect.

## Scope (one slice)

### Half A — §3.E status aggregates → `phase`
The aggregates were intentionally punted in D-PR5 because they're pure read-side display reads (count rows by status for breakdowns) and the §3.B/day-complete collapses already proved the writer/deriver chain. Now flip them to canonical `phase` membership where the semantics are equivalent.

Inventory (re-run `rg -n "Portal Queued|Generating Email|Awaiting Response" artifacts/api-server/src/routes artifacts/api-server/src/lib | rg -v "test|//"` for the live list):
- `routes/dashboard.ts:170` — `portalQueued = sum(Portal Queued + Generating Email + Ready to Review)`. Replace with a `phase` aggregate (count groups in `submitted` ∪ `response_received`). Verify the displayed tile semantics still match the operator's mental model.
- `routes/dashboard.ts:749-757` — per-status / per-outcome breakdowns for the analytics tile. These are display-axes, NOT actionable predicates — leave as `status::text` reads unless a phase-anchored equivalent is genuinely cleaner.
- `routes/dashboard.ts:1054, 1263` — verify whether these are state-machine reads or display reads; convert only the former.
- `routes/invoice-groups.ts:113, 494, 925, 951` — list-route filters. The `113` (`in-flight` filter set) is a candidate; the others may be display reads.
- `lib/brief-personalization.ts:144, 229` — daily-brief copy generation. Display reads; leave unless a `phase` rewrite removes a stale comment.
- `routes/daily-brief.ts:381` — same — display read.
- `lib/urgent-snapshot.ts:45` — already collapsed in D-PR5 (line moved). Verify nothing residual.

**Acceptance**: any aggregate that is materially a state-machine predicate (counting "concluded" rows, or "in-flight" rows, or "post-submit" rows) reads `phase`; any aggregate that is a display axis (counting per-status for a UI breakdown) stays on `status` and is documented with a one-line "display axis, intentionally on status" comment.

### Half B — drop the `unclassified` disposition fallback
Gated on a re-run of `scripts/src/check-invoice-state-derivation.ts` against PROD post-D-PR5 showing **no `unclassified` row that should have a canonical value**. If the audit is clean, drop the `unclassified` arm from `deriveDispositionFromLegacy` and tighten the disposition union in `lib/vocab`. If any rows remain, document the residual case in this doc and ship Half A only — leave Half B for D-PR7.

## Validation gauntlet
Same shape as D-PR5:
```bash
# Composite refresh (required if you touch lib/vocab)
pnpm exec tsc -b lib/db lib/vocab lib/leg-state lib/invoice-state

# Typecheck
pnpm --filter @workspace/api-server exec tsc --noEmit

# Schema drift
pnpm --filter @workspace/db run check-drift

# Targeted tests
pnpm --filter @workspace/api-server exec node --import tsx --test \
  src/__tests__/day-complete-celebration.test.ts \
  src/__tests__/must-file-today-parity.test.ts \
  src/__tests__/dashboard-expiring.test.ts \
  src/__tests__/set-claim-disposition-parity.test.ts \
  src/__tests__/per-leg-state.test.ts

# Conformance audit (dev)
pnpm --filter @workspace/scripts run check:invoice-state-derivation

# Conformance audit (PROD) — gate for Half B
DATABASE_URL="$PROD_DATABASE_URL" pnpm --filter @workspace/scripts run check:invoice-state-derivation
```

`dashboard-expiring.test.ts` and `urgent-today-transitions.test.ts` carry date-keyed assertions that flake on weekdays other than Friday; treat any failure that doesn't match the documented "Friday + …" pattern as a real regression.

## Risks / known landmines
- The §3.E flip is mostly a one-line column substitution per site. The risk is changing a display axis (per-status UI breakdown) onto `phase` and silently flattening a row the operator expects to see broken out. **Read each site's UI consumer before flipping** — if the aggregate feeds a chart/table that lists statuses by name, leave it on status.
- The `unclassified` drop is type-system surgery — every `case 'unclassified':` site in the front-end has to be reviewed. Run `rg -n "unclassified" artifacts/claimclear` before the drop and convert each consumer to the new typed union.
- D-PR5's safety-net deriver branch produces `closureReason='reattested'` for Resolved+Approved+reattestCompleted rows that the writer hasn't re-stamped. If the conformance audit shows `closureReason='approved'` rows the deriver wants to flip back to `'reattested'`, that's drift — fix the deriver to honour the writer's `'approved'` value (extend `LegacyClosureReasonValue` to include it).
