# Wave D PR2b Handoff

**Status as of this session**: D-PR1 (`is_open` GENERATED column) shipped commit `e883c79d`; D-PR2a (cache helpers write canonical columns alongside legacy mirrors) shipped commit `1ac4867a`. The Wave D suggested sequence in `state-wave-d-handoff.md` §3 / §6.3 is now at **D-PR2b**: rewire the SOP-advance handlers and `claim-transitions.ts` to call a single `setClaimDisposition()` writer instead of writing `sopOutcome` / `dropReason` / `includedInDispute` directly.

## What shipped this session

### D-PR2a — cache helpers write canonical columns alongside legacy mirrors

Rewrote `artifacts/api-server/src/lib/denormalized-cache.ts` (~390 lines) so the two materializer entry points produce both halves of the legacy/canonical pair in one transaction, using the prod-validated derivers from `@workspace/invoice-state`:

- `refreshClaimDenormalizedCache(claimId)` — writes `claims.disposition` from `deriveDispositionFromLegacy(toLegacyClaimShape(row))` and (when stale) `invoice_groups.phase` from `derivePhaseFromLegacy(toLegacyGroupShape(parent))`. Both writes happen inside an internal `db.transaction(...)` when the caller didn't pass an `executor`; otherwise the caller's executor is reused.
- `refreshGroupDerivedFields(groupId)` — writes `invoice_groups.phase` and refreshes every child leg's `disposition` against the new phase, in one tx.
- Both helpers preserve their existing executor / idempotency contracts (27 callsites in `routes/claims.ts`, 8 in `routes/invoice-groups.ts` — none changed).

Added `@workspace/invoice-state` as a dependency in `artifacts/api-server/package.json`.

### Two discoveries that simplified the design (now recorded in §6.3)

1. **The trigger fires only on claim-side writes.** `claims_disposition_phase_chk` (migration 0034 lines 189-237) is `DEFERRABLE INITIALLY DEFERRED` and fires `AFTER INSERT OR UPDATE OF disposition, invoice_group_id ON claims` — *not* on `invoice_groups.phase` changes. Updating a group's phase therefore does NOT revalidate sibling legs the helper isn't touching; they get healed lazily on their own next refresh, and the trigger never sees their stale pair.
2. **Cache helpers run *outside* the route txns.** Every callsite is `await db.transaction(...) { ... }` followed by `await refreshClaimDenormalizedCache(id)`. Cross-helper consistency therefore can't rely on the route's tx — but per-claim trigger semantics make that fine, because each helper opens its own internal tx that wraps the (group.phase, claim.disposition) pair when required.

### `state-wave-d-handoff.md` §6.3 rewritten

The original §6.3 plan called for "invert the cache to read from disposition" + "parity assertion" inside D-PR2a. That required a `dispositionToStatus` projector with a 22-disposition × parent-context decision table — non-trivial, and pointless to write before disposition is even being kept current. The revised three-stage flip is:

- **D-PR2a** (shipped) — make canonical columns *current* alongside legacy mirrors. Both written from the same prod-validated derivers.
- **D-PR2b** (next) — single-writer rewire: SOP handlers and `claim-transitions.ts` call `setClaimDisposition()` directly.
- **D-PR2c** — invert the cache: replace `projectLegStatus` with `dispositionToStatus`. Parity assertion belongs here (it's a no-op in D-PR2a since both paths share inputs).

D-PR2b cannot land before D-PR2a; otherwise the SOP handlers would write disposition while the cache still wrote it from stale inputs. D-PR2c cannot land before D-PR2b; otherwise the SOP handlers would clobber the cache's disposition writes via legacy column mutations.

### Files touched this session

- `artifacts/api-server/src/lib/denormalized-cache.ts` — rewrite (~390 lines).
- `artifacts/api-server/package.json` — added `@workspace/invoice-state` dep.
- `docs/architecture/state-wave-d-handoff.md` — §6.3 rewritten with three-stage flip + trigger / cross-tx discoveries.
- `docs/architecture/state-wave-d-pr2b-handoff-prompt.md` — this doc.

### Validation

- `pnpm -r --workspace-concurrency=1 typecheck` — clean.
- Targeted `node:test` on every cache-touching test: **86/86 green** (`leg-status-projector.test.ts` + `per-leg-state.test.ts` + `group-sop-advance.test.ts`).
- API server: restarted clean, listening on 8080, migration runner OK.
- `schema-drift` workflow: green.
- PROD conformance audit (`scripts/src/check-invoice-state-derivation.ts`): unchanged from 2026-05-07 baseline — 1,310 groups + 2,405 claims = 3,715 rows, 0 violations across all three assertions.

---

## What's left in Wave D

| PR | Estimate | Notes |
|---|---|---|
| **D-PR2b — single-writer rewire** | 1.5 slices | Introduce `setClaimDisposition(claimId, disposition, ...)` writer. Rewire `claim-transitions.ts` + the per-leg SOP-advance handler in `routes/claims.ts:~1745-1907` + the bulk SOP-advance loop in `routes/invoice-groups.ts:~3007-3308` to call it. Keep `sopOutcome`/`dropReason` co-writes intact (legacy mirrors) until D-PR2c. |
| **D-PR2c — invert the cache** | 1 slice | Replace `projectLegStatus` with `dispositionToStatus(disposition, parent)`. Status / outcome become derived projections of disposition. Add the parity assertion the original §6.3 plan asked for. |
| **D-PR3 — §3.B residuals onto `is_open`** | half a slice | Pure column substitution at the 6 callsites in `state-wave-d-handoff.md` §3.B. |
| **D-PR4 — `day-complete.ts` SQL builder rewrite** | half a slice | §3.C. Now that disposition is canonical, source the matcher's sets from `disposition`/`phase` directly. |
| **D-PR5 — §3.E aggregates** | half a slice | Per §6.2: ship immediately, no parity window. PROD audit is the parity proof. |
| **D-PR6 — drop the `unclassified` fallback** | half a slice | §3.D. Gated on a re-run of the conformance script post-D-PR2b showing no `unclassified` row that should have a canonical value. |

After D-PR6, Wave E (drop the legacy columns) is unblocked.

---

## D-PR2b inventory — call sites that write `sopOutcome` / `dropReason` / `includedInDispute`

Run `rg -n "sopOutcome|sop_outcome|dropReason|drop_reason|includedInDispute" artifacts/api-server/src/lib/claim-transitions.ts artifacts/api-server/src/routes/claims.ts artifacts/api-server/src/routes/invoice-groups.ts` for the up-to-date list. As of this session:

### `claim-transitions.ts`

| Line(s) | Surface | Notes |
|---|---|---|
| 548-602 | `excludeLegCore` | Writes `includedInDispute = false` and (under the **Task #476 co-write contract**) `sopOutcome = 'non_issue'` when `reason === "non_issue" && leg.sopOutcome == null`. Conservative guard prevents clobbering an SOP-walk verdict that landed before exclusion. **D-PR2b must preserve this contract** — the audit-reason ↔ `sop_outcome` co-write is what `deriveInvoiceDisputeOutlook` relies on to flag a leg as a re-attest survivor. The cleanest expression in D-PR2b is `setClaimDisposition(claimId, "excluded_non_issue", { writeLegacyMirror: true })` and let the writer handle the legacy mirror; the call still has to honor the "only when `sopOutcome` is currently null" guard. |

### `routes/claims.ts` — per-leg SOP-advance handler

| Line(s) | Surface | Notes |
|---|---|---|
| 1745-1907 | SOP-advance handler (`POST /claims/:id/sop-advance`) | Lines 1872-1874 set `updateData.sopOutcome = nextSopOutcome` and (when `isTerminal && DROP_REASON_OUTCOMES.has(nextSopOutcome)`) `updateData.dropReason = nextSopOutcome`. The terminal/non-terminal split is the load-bearing distinction for D-PR2b's writer. |
| 1988-1989 | "Drop the leg" path (operator-initiated drop, not SOP-walk) | Sets `sopOutcome: reason` AND `dropReason: reason` together. `setClaimDisposition()` should accept an explicit `dropReason` param so this path keeps stamping both. |
| 1208 | Operator-clear-hold path (`POST /claims/:id/clear-sop-hold`) | Sets `sopOutcome: null` to release the hold. **Disposition equivalent**: back to `unclassified` if no other state signals exist; otherwise the cache's next refresh will compute the right disposition. Decision needed: does the writer accept `null` disposition, or does the route call `clearClaimDisposition()`? |
| 1359-1360 | Reclassify path (`POST /claims/:id/reclassify`) | Sets both `sopOutcome: null` AND `dropReason: null` to clear MAS state. Same `clearClaimDisposition()` shape applies. |
| 2642-2643 | Re-include path (`POST /claims/:id/include`) | Sets `sopOutcome: null` and `dropReason: null` when re-including a leg. Same shape as 1359. |
| 2207-2241 | Manual-exclude route delegates to `excludeLegCore` | No new write — already covered by the `excludeLegCore` rewire above. |
| 2332 | Re-include path | `set({ includedInDispute: true })`. Pair with the 2642 cleanup; `setClaimDisposition()` likely takes `includedInDispute` as a derived flag rather than an explicit param. |

### `routes/invoice-groups.ts` — bulk SOP-advance

| Line(s) | Surface | Notes |
|---|---|---|
| 3007-3308 | Bulk SOP-advance loop (`POST /invoice-groups/:id/sop-advance`) | Lines 3270-3272 mirror the per-leg handler's `sopOutcome` + (terminal-gated) `dropReason` write. **Hot path**: this loop processes every eligible leg in a group inside one tx; `setClaimDisposition()` must accept an `executor` param so the loop can reuse the outer tx, identical to the cache-helper executor convention introduced in D-PR2a. The per-leg audit writes (3291, 3305) need the same `bulk: true, source: "group_sop_advance"` metadata they emit today. |
| 758-760 | Importer auto-exclude (`includedInDispute: false` for rows without `errorTypeId`) | Wave-D out of scope per §3 (writer rewire scope) — keep as direct write; the importer is its own ladder. Confirmed by the inline comment at line 758. |

### Cache-helper callsites (read-only — do NOT change in D-PR2b)

`refreshClaimDenormalizedCache` is called 27 times in `routes/claims.ts` and 8 times in `routes/invoice-groups.ts`. D-PR2b does NOT touch these — the cache helpers continue to derive disposition from legacy inputs as a defense in depth until D-PR2c inverts the cache. Adding `setClaimDisposition()` calls *upstream* of these sites means the cache helper observes a fresher row and computes the same value (idempotent).

---

## Sharp edges D-PR2b must preserve

Beyond the §3.A-E sharp edges in the Wave-C continuation series (still authoritative), D-PR2b inherits four contracts that surfaced or sharpened during D-PR2a:

1. **Task #476 audit-reason ↔ `sop_outcome` co-write.** `excludeLegCore` co-writes `sop_outcome = 'non_issue'` when the exclusion reason is `non_issue` AND no SOP verdict has landed yet. `deriveInvoiceDisputeOutlook` (the invoice-level outlook gate) reads `sopOutcome === 'non_issue'` to recognize a re-attest survivor; without the co-write, the outlook drops the leg into the amber "Mark as closed" CTA. The 2026-05-06 backfill healed 680 historical rows. **The D-PR2b writer must preserve the "only when `sop_outcome` is currently null" guard** — never clobber a verdict that already landed.
2. **Terminal vs non-terminal SOP outcomes.** Lines 1872-1874 in `routes/claims.ts` (and 3270-3272 in `routes/invoice-groups.ts`) only stamp `dropReason` when `isTerminal && DROP_REASON_OUTCOMES.has(nextSopOutcome)`. Mid-walk transitions stamp `sopOutcome` only; `dropReason` stays null. The disposition writer must accept the `isTerminal` signal (or derive `dropReason` itself from the disposition's terminality) so this distinction survives.
3. **The trigger is per-claim, not cross-row.** `claims_disposition_phase_chk` only validates the claim being written, against the *current* parent phase. D-PR2b can write a leg's disposition without first revalidating siblings. (This is what makes the bulk SOP-advance loop tractable in one tx.) See §6.3 of `state-wave-d-handoff.md` for the full trigger geometry.
4. **Cache helpers run outside the route txns.** D-PR2a's helpers each open their own internal tx when no executor is passed. The D-PR2b writer should follow the same convention: `setClaimDisposition(claimId, disposition, { ex?: Executor, ... })`. The 35 cache-helper callsites were not changed in D-PR2a and must not change in D-PR2b — disposition is written *upstream* of the cache helper, and the helper's existing job (recompute the materialized columns) becomes idempotent.

## Sharp edges (still authoritative — see continuation #2 §3.A-E + Wave D §3)

The Wave-C continuation #2 §3.A-E catalogue and Wave D §3.A-E are unchanged by this session. D-PR2b does NOT close any of them — the writer rewire is a §3 concern only.

---

## Pre-existing test noise to disentangle

D-PR2b verification will encounter two unrelated failures that are NOT regressions of D-PR1 or D-PR2a — both confirmed pre-existing under prior commits (verified by `git checkout` of the parent of `e883c79d`):

| Test | Failure | Cause |
|---|---|---|
| `artifacts/api-server/src/__tests__/duplicate-of-endpoints.test.ts` | line 291 | Pre-existing dev DB drift; fails identically under D-PR1 code. |
| `artifacts/api-server/src/__tests__/list-count-past-deadline-parity.test.ts` | line 254 | Pre-existing dev DB drift; fails identically under D-PR1 code. |

Dev DB also has 38 `phase_mismatch` rows from prior backfills (PROD audit is clean). The D-PR2a cache helpers will heal these lazily as normal traffic touches them. **Do not block D-PR2b on these** — re-run the conformance audit on PROD after D-PR2b lands; that's the verification that matters. Per Wave D §6.2, no parity window is needed.

---

## Recommended next session

1. **Read first** (in order): `state-wave-d-handoff.md` §3 + §6.3, then `lib/invoice-state/src/derive-disposition.ts` and `legacy-shapes.ts`, then `denormalized-cache.ts` (the D-PR2a writer pattern to mirror), then the four call-site groups in the inventory above.
2. **Design `setClaimDisposition()`** in `artifacts/api-server/src/lib/leg-state/` (or co-located with `claim-transitions.ts` if that's where the team prefers writers to live). Required signature shape, based on the inventory:
   - `(claimId: number, disposition: ClaimDisposition, opts?: { isTerminal?: boolean; dropReason?: string | null; includedInDispute?: boolean; ex?: Executor; actor?: ActorContext })`
   - Writes the canonical column FIRST. Then derives + writes the legacy mirrors (`sopOutcome`, `dropReason`, `includedInDispute`) using the inverse of the §3.D fallback table — i.e. a `dispositionToLegacy(disposition, isTerminal)` helper. Keep the helper alongside the writer so the inversion lives in one place (this is the seed for D-PR2c's `dispositionToStatus`).
   - Honors the **Task #476 guard**: when `disposition` implies `sopOutcome = 'non_issue'`, only stamp it if the existing row's `sopOutcome` is currently null (read-then-write inside the writer's tx).
3. **Rewire the four call-site groups** above, smallest → largest:
   - `excludeLegCore` (1 site, contract-bearing)
   - `routes/claims.ts` per-leg SOP-advance handler + reclassify + clear-hold + drop + include (6 sites)
   - `routes/invoice-groups.ts` bulk SOP-advance loop (1 site, hot path; pass `executor` to reuse the loop's outer tx)
4. **Validation gauntlet** (per Wave D §5):
   - `pnpm -r --workspace-concurrency=1 typecheck` — clean.
   - `pnpm --filter @workspace/api-server exec node --import tsx --test src/__tests__/leg-status-projector.test.ts src/__tests__/per-leg-state.test.ts src/__tests__/group-sop-advance.test.ts src/__tests__/excludeLegCore.test.ts` — must stay 100% green; the Task #476 contract test in particular.
   - Add a parity test that asserts, for a representative fixture set, the D-PR2b writer produces the same `(disposition, sopOutcome, dropReason, includedInDispute)` tuple the legacy direct writes would have produced. This is the §5 parity-test requirement for writer-rewire PRs.
   - `scripts/src/check-invoice-state-derivation.ts` against PROD post-merge — must remain 0/3,715. (Re-run the dev audit too; the 38 pre-existing drifted rows should monotonically decrease as traffic flows.)
5. **Stop at D-PR2b.** D-PR2c (invert the cache) is the next session after that. Do not bundle them — the parity assertion D-PR2c needs only becomes meaningful once D-PR2b's writer is the sole producer of disposition.

---

## Validation invocation reference

The default `pnpm test` concurrency wedges the shell on this monorepo. The reliable invocations from D-PR2a:

```bash
# Typecheck (workspace-wide)
pnpm -r --workspace-concurrency=1 typecheck

# Targeted unit tests (must run from inside the api-server filter so tsx resolves)
pnpm --filter @workspace/api-server exec node --import tsx --test \
  src/__tests__/leg-status-projector.test.ts \
  src/__tests__/per-leg-state.test.ts \
  src/__tests__/group-sop-advance.test.ts

# Conformance audit
cd scripts && pnpm exec tsx ./src/check-invoice-state-derivation.ts
```

Workflow `artifacts/training-guide: web` emits port-collision noise (`EADDRINUSE 0.0.0.0:5924`) on every restart — pre-existing, ignore.
