# Invoice-as-state-machine: hierarchical state model v1

**Date:** 2026-05-06.
**Status:** Plan-of-record. Supersedes the cancelled Task #512 lock-down plan (`docs/architecture/state-migration-plan.md`).
**Predecessors (read for context):**
- `docs/architecture/invoice-terminal-state.md` — the terminal-state contract (still valid; collapses into one phase here)
- `docs/architecture/state-vocabularies-audit.md` — the 6-layer status census
- `docs/architecture/state-migration-plan.md` — the cancelled lock-down plan; useful as a record of every drifted row this work must heal

---

## 0. The one-sentence mental model

> **The invoice is the noun that moves. Each claim is a work item that contributes to the next phase transition. Phase advancement is gated by an aggregate over claim dispositions — never by a free-running cache.**

Today's system models groups and claims as **peers with overlapping state**, kept in sync by a bidirectional cache (`denormalized-cache.ts` mirrors group→leg downstream and aggregates leg→group upstream). That is the actual root cause of every drift bug catalogued in the audit. The audit catalogued symptoms; this doc replaces the topology.

---

## 1. The seven phases an invoice moves through

These replace `invoice_groups.status` (currently 13 shared enum values) and `invoice_groups.outcome` (6 values). One column, sequential, one writer.

| # | Phase | What it means in operator language | Entry condition (what must be true to enter) |
|---|---|---|---|
| 1 | **`triage`** | Just imported; operator is deciding what to do with each leg | (none — all new invoices start here) |
| 2 | **`ready_to_submit`** | Every leg has a committed disposition; nothing has been filed yet | Every claim has `disposition ∈ {disposed_portal, disposed_email, disposed_withdraw, disposed_nonissue}` |
| 3 | **`submitted`** | Filed at the payor; awaiting a response | A `portal_submissions` row with `status='submitted'` exists for the invoice, OR a dispute email was sent for every claim with `disposed_email` |
| 4 | **`response_received`** | Payor reply parsed and linked | A `portal_responses` row is linked to this invoice and at least one verdict is still undrafted |
| 5 | **`reviewed`** | Operator has confirmed a verdict for every leg | Every claim has `disposition ∈ {verdict_approved, verdict_denied, verdict_partial}` |
| 6 | **`awaiting_reattestation`** | At least one Approved/Partial verdict requires MAS re-attestation | `phase=reviewed` AND any claim has `disposition ∈ {verdict_approved, verdict_partial}` AND `reattestCompletedAt IS NULL` |
| 7 | **`closed`** | Terminal | EITHER `reattestCompletedAt IS NOT NULL` OR every claim has `disposition=verdict_denied` (no MAS work needed) OR every claim has `disposition=disposed_withdraw / disposed_nonissue` (never submitted, never responded) |

**Deleted concepts:** `On Hold` is not a phase — it's a flag (`hold_reason IS NOT NULL`) orthogonal to phase that suspends the entry-condition checks. `Expired` is not a phase — it's a `closed` invoice with `closure_reason='expired'`. `Denied` and `Resolved` are not phases — they're `closed` with different `closure_reason` values.

This collapses today's 13 statuses × 6 outcomes (78-cell matrix, ~25 reachable in prod) into **7 phases × 1 closure_reason** = 11 actually distinguishable end-states.

---

## 2. Claim dispositions (per-phase valid sets)

Each claim has one `disposition` column. The valid value depends on the parent invoice's current phase. **A claim with a disposition outside its parent's phase set is, by definition, invalid** — that combination is unrepresentable, not just discouraged.

| Parent phase | Valid claim dispositions | Meaning |
|---|---|---|
| `triage` | `unclassified` | No SOP outcome yet |
| | `classifying` | Operator is in the SOP walk |
| | `disposed_portal` | SOP concluded → file via portal |
| | `disposed_email` | SOP concluded → file via dispute email |
| | `disposed_withdraw` | SOP concluded → withdraw (cannot dispute) |
| | `disposed_nonissue` | SOP concluded → close as non-issue |
| | `blocked` | On hold from inside SOP (parallel pause path) |
| | `duplicate` | Linked to another leg via `duplicate_of_claim_id` |
| `ready_to_submit` | (locked — same as triage's terminal dispositions, no further claim activity) | |
| `submitted` | (locked — payor has the work; nothing changes until response arrives) | |
| `response_received` | `awaiting_review` | Operator hasn't drafted a verdict yet |
| | `verdict_drafted` | Verdict drafted, not yet confirmed |
| `reviewed` / `awaiting_reattestation` | `verdict_approved` | Operator confirmed Approved verdict |
| | `verdict_denied` | Operator confirmed Denied verdict |
| | `verdict_partial` | Operator confirmed Partial verdict |
| `awaiting_reattestation` | (above) PLUS `attest_pending`, `attest_queued`, `attested`, `mas_cancelled`, `attest_not_required` | The per-leg attestation queue dispositions (today's `attestation_state`) |
| `closed` | `final_reattested`, `final_withdrawn:<reason>`, `final_denied`, `final_nonissue` | Terminal |

**Important: `disposition` is the canonical column.** Today's `claims.status`, `claims.outcome`, `claims.sop_outcome`, `claims.attestation_state`, `claims.drop_reason` are all merged into this one column. The migration mapping in §6 spells out exactly how each existing tuple translates.

---

## 3. The transition API (one writer per layer)

### 3.1 Invoice transitions

```ts
// lib/invoice-state/src/transitions.ts
export async function transitionInvoice(
  invoiceId: number,
  toPhase: InvoicePhase,
  ctx: TransitionContext,  // actor, reason, metadata
  executor?: DbExecutor,
): Promise<TransitionResult>;
```

Behaviour:
1. Lock the invoice row.
2. Read current phase + all child claims' dispositions.
3. Look up `(currentPhase → toPhase)` in `INVOICE_TRANSITION_TABLE`. Reject if not allowed.
4. Evaluate entry condition for `toPhase`. Reject with structured reason listing blocking claims if not met.
5. Update `invoice_groups.phase = toPhase` + any phase-specific stamps (e.g. `closure_reason` when entering `closed`).
6. Emit one `audit_logs` row + one `state_events` row via `lib/observability` (drift bug #11 fix folds in here).
7. Return updated invoice + emitted event id.

**There is NO other writer for `invoice_groups.phase`.** All 6 of today's writer sites (enumerated in `state-migration-plan.md` §F) become callers of `transitionInvoice`.

### 3.2 Claim disposition transitions

```ts
// lib/invoice-state/src/disposition.ts
export async function setClaimDisposition(
  claimId: number,
  toDisposition: ClaimDisposition,
  ctx: TransitionContext,
  executor?: DbExecutor,
): Promise<DispositionResult>;
```

Behaviour:
1. Lock the claim row + its parent invoice.
2. Verify `toDisposition ∈ VALID_DISPOSITIONS_BY_PHASE[parentInvoice.phase]`. Reject if not.
3. Update `claims.disposition`.
4. Emit observability event.
5. **If this disposition change might satisfy a phase entry condition**, call `maybeAdvanceInvoice(invoiceId, executor)` which:
   - Reads the next legal phase per `INVOICE_TRANSITION_TABLE`
   - Evaluates its entry condition
   - If satisfied AND the transition is configured as `auto: true`, calls `transitionInvoice` recursively
   - Otherwise no-ops

`maybeAdvanceInvoice` is the **only** code path that auto-advances an invoice. Everywhere else, advancement is operator-triggered through `transitionInvoice`. This kills the "where does group state actually come from?" question.

**Writer-path consolidation (revised 2026-05-06).** `setClaimDisposition` replaces multiple legacy writers that today produce equivalent operator-facing state through different storage shapes. Specifically, the four writers below all collapse into a single `setClaimDisposition` call:

| Today's writer | Today's audit action | New call |
|---|---|---|
| `excludeLegCore(reason='non_issue')` (`POST /claims/:id/exclude` w/ reason=non_issue, blank-sibling auto-exclude) | `leg_excluded` | `setClaimDisposition(id, 'disposed_nonissue', ctx)` |
| `excludeLegCore(reason='cannot_dispute')` | `leg_excluded` | `setClaimDisposition(id, 'disposed_withdraw', ctx)` |
| `POST /claims/:id/conclude-leg` w/ `reason='non_issue'` (Task #265 picker) | `leg_concluded` | `setClaimDisposition(id, 'disposed_nonissue', ctx)` |
| `POST /claims/:id/conclude-leg` w/ `reason='cannot_dispute'` | `leg_concluded` | `setClaimDisposition(id, 'disposed_withdraw', ctx)` |
| `POST /claims/:id/sop-advance` terminal (`non_issue` / `cannot_dispute` / `portal_dispute` / `dispute`) | `leg_sop_advanced` | `setClaimDisposition(id, <mapped>, ctx)` |

The historical writer-path distinction (audit action name) is preserved by setting `ctx.source` so the new audit registry stamps an equivalent action label. The `included_in_dispute`, `drop_reason`, `dropped_at`, `ready_at` columns are storage-shape artifacts of the legacy two-path design and are dropped in Wave E (see §4 / §5.3).

### 3.3 The transition table

```ts
// lib/invoice-state/src/transition-table.ts
type TransitionDef = {
  from: InvoicePhase;
  to: InvoicePhase;
  trigger: 'operator' | 'auto';
  guard: (invoice, claims) => GuardResult;
};

export const INVOICE_TRANSITION_TABLE: TransitionDef[] = [
  { from: 'triage', to: 'ready_to_submit', trigger: 'auto',
    guard: allClaimsHaveTerminalTriageDisposition },
  { from: 'ready_to_submit', to: 'submitted', trigger: 'operator',
    guard: hasPortalSubmissionOrAllEmailsSent },
  { from: 'submitted', to: 'response_received', trigger: 'auto',
    guard: hasLinkedPayorResponse },
  { from: 'response_received', to: 'reviewed', trigger: 'auto',
    guard: allClaimsHaveConfirmedVerdict },
  { from: 'reviewed', to: 'awaiting_reattestation', trigger: 'auto',
    guard: anyVerdictApprovedOrPartialAndNotReattested },
  { from: 'reviewed', to: 'closed', trigger: 'auto',
    guard: allVerdictsDeniedOrNoMasNeeded },
  { from: 'awaiting_reattestation', to: 'closed', trigger: 'operator',
    guard: hasReattestCompletedStamp },
  // Admin-only reverse transitions (re-open):
  { from: 'closed', to: 'reviewed', trigger: 'operator',
    guard: requiresAdminAndClearsClosureFields },
  // Hold is NOT a phase — it's a flag. No transitions.
];
```

The transition table is the **whiteboard description** counsel asked for. It fits in 30 lines. The state machine is now a graph you can draw, not a truth table.

---

## 4. What gets deleted

This is what makes the topology change real:

| File / concept | Why it goes |
|---|---|
| `artifacts/api-server/src/lib/denormalized-cache.ts` | Bidirectional mirror is the disease. Phase is computed at write time by `transitionInvoice`; claim disposition is computed at write time by `setClaimDisposition`. Both are stored; neither is mirrored. |
| `artifacts/api-server/src/lib/macro-phase.ts` + `claimclear/src/lib/lifecycle-phase.ts` | Macro-phase derivation logic disappears because phase IS macro. The 7 macro values are nearly identical to the 7 invoice phases — see §6.4. |
| The 7-way truth-table terminal-state helper from `docs/architecture/invoice-terminal-state.md` §3 | Replaced by `invoice.phase === 'closed'`. The 4-column tuple becomes a single read. The mutual-exclusion guard becomes unrepresentable instead of run-time-enforced. |
| `lib/vocab/src/verdict-outcome.ts` | Already dead per drift bug #5. |
| `claims.status`, `claims.outcome`, `claims.sop_outcome`, `claims.attestation_state`, `claims.drop_reason`, `claims.dropped_at`, `claims.ready_at`, `claims.included_in_dispute` | All folded into `claims.disposition`. The last four are storage-shape artifacts of the legacy excluded-vs-dropped two-path writer split (see §3.2 consolidation table). Dropped after dual-write window (§7). |
| `invoice_groups.status`, `invoice_groups.outcome` | Folded into `invoice_groups.phase` + `closure_reason`. Dropped after dual-write window. |
| The 6 independent writer sites for `group.status` and 5 for `claim.status` | Become callers of `transitionInvoice` / `setClaimDisposition`. Direct `db.update(invoiceGroupsTable).set({status: ...})` is banned by lint rule. |
| Drift bugs #1, #2, #3, #4, #6, #7, #8, #9 from the audit | Become unrepresentable. |

What survives:
- `closure_reason`, `closure_review_state`, `hold_reason` (orthogonal flags)
- `reattest_required`, `reattest_completed_at`, `reattest_completed_by`, `reattest_note` (fact stamps the closed phase reads)
- `lib/leg-state` — restructured around the new disposition vocabulary
- The audit/state_event log tables (append-only)
- The `lib/observability` registry (drift bug #11 fix)

---

## 5. Schema diff

### 5.1 New columns

```sql
ALTER TABLE invoice_groups ADD COLUMN phase invoice_phase NOT NULL DEFAULT 'triage';
ALTER TABLE claims         ADD COLUMN disposition claim_disposition NOT NULL DEFAULT 'unclassified';

CREATE TYPE invoice_phase AS ENUM (
  'triage', 'ready_to_submit', 'submitted', 'response_received',
  'reviewed', 'awaiting_reattestation', 'closed'
);

CREATE TYPE claim_disposition AS ENUM (
  -- triage set
  'unclassified', 'classifying', 'disposed_portal', 'disposed_email',
  'disposed_withdraw', 'disposed_nonissue', 'blocked', 'duplicate',
  -- response set
  'awaiting_review', 'verdict_drafted',
  -- reviewed/reattest set
  'verdict_approved', 'verdict_denied', 'verdict_partial',
  -- attestation queue
  'attest_pending', 'attest_queued', 'attested', 'mas_cancelled', 'attest_not_required',
  -- terminal
  'final_reattested', 'final_withdrawn', 'final_denied', 'final_nonissue'
);
```

### 5.2 Cross-row constraint

```sql
-- A claim's disposition must be in its parent invoice's valid set.
-- Enforced by a deferrable trigger because the validation needs
-- to read the parent invoice row.
CREATE FUNCTION validate_disposition_against_phase() RETURNS trigger AS $$
DECLARE parent_phase invoice_phase;
BEGIN
  SELECT phase INTO parent_phase FROM invoice_groups WHERE id = NEW.invoice_group_id;
  IF NOT (NEW.disposition = ANY(VALID_DISPOSITIONS_FOR_PHASE(parent_phase))) THEN
    RAISE EXCEPTION 'disposition % not valid for parent invoice phase %',
      NEW.disposition, parent_phase;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
```

This is the **structural** version of the contract. Bad combinations stop being possible at the database level, not at the application level.

### 5.3 Dropped after migration

```sql
ALTER TABLE invoice_groups DROP COLUMN status, DROP COLUMN outcome;
ALTER TABLE claims DROP COLUMN status, DROP COLUMN outcome,
                   DROP COLUMN sop_outcome, DROP COLUMN attestation_state,
                   DROP COLUMN drop_reason, DROP COLUMN dropped_at,
                   DROP COLUMN ready_at, DROP COLUMN included_in_dispute;
DROP TYPE claim_status;
DROP TYPE claim_outcome;
```

---

## 6. Mapping today's data → new model

This is the deterministic backfill. Every existing row has exactly one target.

### 6.1 Invoice phase from today's `(status, outcome, reattestRequired, reattestCompletedAt, closureReason)` tuple

| Today's tuple | New `phase` | New invoice metadata |
|---|---|---|
| `(New, Pending, _, _, _)` | `triage` | — |
| `(Needs Evidence, Pending, _, _, _)` | `triage` | (set `hold_reason='evidence_pending'` for the "needs evidence" sub-state) |
| `(Needs Review, Pending, _, _, _)` | `triage` | The "needs review" gloss is a per-claim disposition, not a phase. See §6.2. |
| `(Portal Queued, Pending, _, _, _)` | `ready_to_submit` | — |
| `(Generating Email, Pending, _, _, _)` | `ready_to_submit` | (transient state; will resolve to `submitted` on next email send) |
| `(Awaiting Response, Pending, _, _, _)` | `submitted` | — |
| `(Ready to Review, Pending, _, _, _)` | `response_received` | — |
| `(MAS Eligible, *, true, NULL, _)` | `awaiting_reattestation` | — |
| `(*, *, _, NOT NULL, _)` | `closed` | `closure_reason='reattested'` |
| `(Resolved, Non-Issue, _, NULL, _)` | `closed` | `closure_reason='non_issue'` |
| `(Expired, *, _, NULL, _)` | `closed` | `closure_reason='expired'` |
| `(Denied, *, _, NULL, _)` | `closed` | `closure_reason='denied_by_payor'` |
| `(Resolved, Withdrawn, _, NULL, X)` | `closed` | `closure_reason=X` (carry forward) |
| `(On Hold, *, _, _, _)` | (use prior phase from audit_log + set `hold_reason='other'`) | Hold is no longer a phase. Compute prior phase from the most recent `group_status_changed` audit row. |

### 6.2 Claim disposition from today's `(status, outcome, sop_outcome, attestation_state, included_in_dispute, duplicate_of_claim_id)` tuple

**Two-path collapse (revised 2026-05-06).** Today's schema has two parallel writers that produce the same operator-facing concept ("this leg won't be disputed: non-issue / non-contestable") through two different storage shapes:

- **Excluded path** — `excludeLegCore` (in `artifacts/api-server/src/lib/claim-transitions.ts`) flips `included_in_dispute=false` and, when reason is `non_issue`, co-writes `sop_outcome='non_issue'`. Audit action: `leg_excluded`. Used by blank-sibling auto-exclusion (Task #232) and the manual leg-detail exclude button.
- **Dropped path** — `POST /claims/:id/conclude-leg` (Task #265 three-button picker on Queue Panel A) and the `sop-advance` terminal both stamp `sop_outcome` + `drop_reason` + `dropped_at`, leaving `included_in_dispute=true`. Audit action: `leg_concluded` or `leg_sop_advanced` with `metadata.isTerminal=true`. Sub-status derives to `dropped` (vs `excluded` for the other path).

Both paths produce the same operator concept. The new `disposition` column encodes the operator concept, not the storage shape — so both shapes map to the same disposition value below. The historical path distinction is preserved in the append-only `audit_logs` action name, not in the column. Wave D consolidates both writer paths into a single `setClaimDisposition` call (see §3.2 note).

Computed in this order; first match wins:

| Predicate | New `disposition` |
|---|---|
| `duplicate_of_claim_id IS NOT NULL` | `duplicate` |
| `sop_outcome = 'non_issue'` | `disposed_nonissue` (or `final_nonissue` if parent phase `closed`) — covers both excluded path (`included_in_dispute=false`, `drop_reason=NULL`) and dropped path (`included_in_dispute=true`, `drop_reason='non_issue'`) |
| `sop_outcome = 'cannot_dispute'` | `disposed_withdraw` (or `final_withdrawn`) — same two-path collapse as above |
| `sop_outcome = 'hold'` | `blocked` |
| `sop_outcome = 'portal_dispute'` AND parent phase ≥ `submitted` AND no verdict yet | (claim continues with `disposed_portal`; parent phase carries the actual progress) |
| `sop_outcome = 'dispute'` (the deprecated value) AND parent phase ≥ `submitted` | `disposed_email` (fold of `dispute → portal_dispute` from migration plan §4d simplified: `dispute` was email-channel, `portal_dispute` is portal-channel) |
| `sop_outcome IS NULL AND included_in_dispute = true AND error_type_id IS NOT NULL` | `classifying` |
| `sop_outcome IS NULL` (anything else) | `unclassified` |
| Verdict exists and is `Approved` and `attestation_state = 'queued'` | `attest_queued` |
| Verdict exists and is `Approved` and `attestation_state = 'pending'` | `attest_pending` |
| Verdict exists and is `Approved` and `attestation_state = 'completed'` | `attested` |
| Verdict exists and is `Approved` and `attestation_state = 'not_required'` | `attest_not_required` |
| Verdict exists and is `Partial` | `verdict_partial` (with attestation sub-state if applicable) |
| Verdict exists and is `Denied` | `verdict_denied` |
| Parent phase = `closed` | one of `final_*` per `closure_reason` |

### 6.3 Drift rows from the cancelled lock-down plan

The 264 group + 102 claim rows enumerated in `state-migration-plan.md` §B all have well-defined targets above. Specifically:

- The 81 `(Resolved, Non-Issue)` groups → `phase=closed, closure_reason=non_issue`
- The 72 `(Expired, *)` groups → `phase=closed, closure_reason=expired`
- The 9 `(Denied, *)` groups → `phase=closed, closure_reason=denied_by_payor`
- The 2 `closure_reason='accepted_loss'` claim rows → `closure_reason='denied_by_payor'` then disposition mapping per §6.2
- The 6 free-text `hold_reason` claim rows → `disposition=blocked, hold_reason='other'`, original text moved to a system note
- The 3 `sop_outcome='dispute'` claim rows → `disposition=disposed_email`

**The drift heals as a free side-effect of the backfill** — there is no separate "data fix" step. The mapping function is the single source of truth.

### 6.4 Macro-phase mapping (sanity check)

Existing `MacroPhase` (today's derived 7-value enum) maps almost 1:1 to the new stored phases. This is by design — the macro-phase logic was already correctly identifying these as the meaningful invoice phases; we just never made it the source of truth.

| Today's `MacroPhase` | New `phase` |
|---|---|
| `pre-submit` | `triage` |
| `in-flight` | `submitted` (with intermediate `ready_to_submit` while between SOP completion and submit click) |
| `response-pending` | `response_received` |
| `mas-action-required` | `awaiting_reattestation` |
| `awaiting-payout` | `closed` (with `closure_reason='reattested'`; "payout" was always a separate question) |
| `closed` | `closed` |
| `on-hold` | (deleted — becomes a flag, not a phase) |

---

## 7. Execution plan

This is bigger than the cancelled lock-down task and replaces it. ~5 PRs over ~3 working sessions, each independently shippable. **No boot-time scripts.** **No deprecation windows.** Schema + data + code in one PR per wave.

### Wave A — Read-side foundations (3 PRs, no schema change, no data change)

**A1. New `lib/invoice-state` package.** Pure logic only:
- `INVOICE_PHASES` enum (TS literal union; not yet a pgEnum)
- `CLAIM_DISPOSITIONS` enum
- `VALID_DISPOSITIONS_BY_PHASE` table
- `INVOICE_TRANSITION_TABLE` with the 8 transitions
- `derivePhase(invoice, claims)` — computes the new phase from today's columns per §6.1, deterministic
- `deriveDisposition(claim)` — same per §6.2
- `getValidNextPhases(invoice)`, `evaluateGuard(transition, invoice, claims)`
- 100% unit-tested against fixtures

This is **zero-risk** code-only — nothing imports it yet.

**A2. New `lib/observability` package** (drift bug #11 fix folded in). `EventKey` registry + `emitEvent` dual-write helper. Refactor 4 existing emit sites to use it; lint rule blocks new direct inserts.

**A3. CI conformance check.** `scripts/src/check-invoice-state-derivation.ts` runs `derivePhase` against every prod row and asserts the result is well-defined (no row maps to `null`). Wired into the existing `schema-drift` workflow. **Run this against prod before any further wave** — it's the safety belt that proves §6's mapping covers every existing row.

### Wave B — Schema + dual-write backfill (1 PR, the big one)

**B1.** Single migration that:
1. Creates `invoice_phase` and `claim_disposition` pgEnums.
2. Adds `invoice_groups.phase` and `claims.disposition` columns (NOT NULL with default).
3. In the migration's UP, runs the §6 mapping for every existing row in one transaction:
   ```sql
   UPDATE invoice_groups SET phase = derive_phase(...);  -- via inlined CASE
   UPDATE claims         SET disposition = derive_disposition(...);
   ```
4. Adds the cross-row trigger from §5.2.
5. Emits one audit_log + state_event per row touched (~3700 events; logged via `emitEvent`).

**Backfill is part of the migration**, not a separate one-shot script — because the trigger added in step 4 would reject the inserts if data weren't already conformant. Atomic.

After this PR ships, every row has both `(status, outcome)` AND `(phase, disposition)`. They're kept in sync by the existing writers (no code change yet); the new columns are read-only.

### Wave C — Switch reads to the new columns (1 PR, code-only)

**C1.** Every `SELECT` and derivation site switches from reading `(status, outcome, ...)` to reading `(phase, disposition)`:
- `routes/invoice-groups.ts` GET handlers
- `routes/dashboard.ts` (the urgent snapshot, the KPI rollups)
- `lib/expiring-filter.ts`
- `lib/group-packaging.ts` (`computeGroupReadiness`)
- All client-side derivations in `claimclear/src/lib/`
- The OpenAPI spec gains `phase` + `disposition` as the canonical fields; the old `status`/`outcome` are marked deprecated

The bidirectional cache is still running in the background but nothing reads from its outputs anymore.

### Wave D — Switch writes to the new functions (1 PR, the topology change)

**D1.** Every `db.update(invoiceGroupsTable).set({status: ...})` site is rewritten to call `transitionInvoice(...)`. Same for `db.update(claimsTable).set({status: ...})` → `setClaimDisposition(...)`.

**`lib/denormalized-cache.ts` is deleted.** Its file. Gone.
**`artifacts/api-server/src/lib/macro-phase.ts` is deleted.**
**`artifacts/claimclear/src/lib/lifecycle-phase.ts` is deleted.**

The transition functions write the new columns directly; the old columns are no longer touched.

A lint rule (custom ESLint plugin) catches any `.update(invoiceGroupsTable).set({status:` outside the transition-function file, fails CI.

### Wave E — Drop the old columns (1 PR, schema-only)

**E1.** The dual-write window is over (writers ignore old columns; readers read new columns). Drop:
- `invoice_groups.status`, `invoice_groups.outcome`
- `claims.status`, `claims.outcome`, `claims.sop_outcome`, `claims.attestation_state`, `claims.drop_reason`
- `claim_status`, `claim_outcome` enum types
- The OpenAPI spec drops the deprecated fields; regen `lib/api-zod` + `lib/api-client-react`

After Wave E, the schema reflects the model: one phase column per invoice, one disposition column per claim, validated by trigger.

---

## 8. What the system-health rollup answers after this lands

Today's `lib/system-health-rollup.ts` answers questions like "are there groups whose `service_date` disagrees with `MIN(claims.date)`?" — drift checks for the bidirectional cache.

After Wave E, those questions become **uninteresting** because the cache doesn't exist. The interesting questions become:

```sql
-- Q1: Any invoice in a phase whose entry condition is no longer satisfied?
--     (Should never fire; would indicate a transition function bug.)
SELECT id, phase FROM invoice_groups
WHERE phase = 'reviewed'
  AND EXISTS (SELECT 1 FROM claims c
              WHERE c.invoice_group_id = invoice_groups.id
                AND c.disposition NOT IN ('verdict_approved', 'verdict_denied', 'verdict_partial'));

-- Q2: Any claim with a disposition outside its parent's valid set?
--     (Caught by trigger at insert time; this is the post-hoc backstop.)
SELECT c.id FROM claims c JOIN invoice_groups g ON c.invoice_group_id = g.id
WHERE NOT (c.disposition = ANY(valid_dispositions_for_phase(g.phase)));

-- Q3: How long are invoices spending in each phase?
--     (KPI replacement for today's "hold time" metrics.)
SELECT phase, percentile_cont(0.5) WITHIN GROUP (ORDER BY age_in_phase)
FROM (SELECT phase, NOW() - phase_entered_at AS age_in_phase FROM invoice_groups) s
GROUP BY phase;
```

Q1 and Q2 should always return zero rows. If they don't, the transition table or trigger has a bug — but bad data cannot exist as a result of normal operation, only as a result of a code bug we'd fix.

---

## 9. Open questions to resolve before scoping each wave

These need an answer before each wave is committed; flagged here so they don't surface mid-PR.

1. **Should `phase_entered_at` be a stored timestamp on `invoice_groups`?** Today the audit_log has the entry events; reading them on every dashboard query is slow. Recommend yes — adds one column, written by `transitionInvoice`.
2. **What happens to today's `Generating Email` status?** It's transient (lasts seconds during email send). Recommend: not a phase; modelled as a per-claim flag `email_in_flight` if needed. Otherwise dropped entirely.
3. **Reverse transitions (admin re-open).** Today admins can transition `Resolved → Awaiting Response` via `routes/admin.ts:106`. The transition table allows `closed → reviewed` for admins; need to confirm with the team that no other reverse paths are used.
4. **Per-claim phase exposure in the UI.** Today operators see per-claim status in the legs grid. Recommend showing `disposition` directly with friendly labels per the disposition vocabulary. Need design pass.
5. **Email sends and portal submissions as phase triggers.** `submitted` requires either a portal submission OR all-emails-sent. Should the email-sent tracking move to a dedicated `dispute_emails_sent` count column on the invoice, or stay in `outbound_emails`? Affects the guard's query cost.
6. **Hold semantics.** Hold is now a flag, not a phase. Does putting an invoice on hold *pause* the auto-transitions, or just visually flag it? Recommend pause: `maybeAdvanceInvoice` short-circuits when `hold_reason IS NOT NULL`.

---

## 10. Risk + reversibility per wave

| Wave | Schema risk | Data risk | Code blast radius | Reversibility |
|---|---|---|---|---|
| A1–A3 | None (no DDL) | None (no writes) | New packages, zero existing imports | Trivial — revert commit |
| B1 | Two new enums + two new columns (additive) + trigger | All rows touched in one txn (~3700 rows) | None (read-only columns) | Reversible: drop columns + types in DOWN; data still in old columns |
| C1 | None | None | ~30 read sites, ~15 client files | Reversible: revert commit; old columns still populated by existing writers |
| **D1** | **None** | **Behaviour change: writes now go to new columns** | **Every writer site (~12), plus 3 deletions** | **One-way operationally**: once cache is deleted, reverting requires recreating it. Data is recoverable from new columns via reverse `derivePhase`. |
| E1 | DROP COLUMN x 7, DROP TYPE x 2 | None (data already migrated and unused) | OpenAPI codegen blast (~30 generated files) | One-way: requires restoring from backup if needed. By this point, code has been running on new columns for 1+ release cycle. |

The single highest-risk step is Wave D (the deletion of `denormalized-cache.ts`). It is reversible operationally only by restoring the file from git and resuming dual-writes. No data is lost; only behaviour reverts.

---

## 11. What this answers vs. what it doesn't

**Counsel's question:** "After this lands, can you cleanly describe the state machine as 'group does X, then claim does Y within X, then group moves to Z'?"

**Answer after Wave E:** Yes.

> An invoice is in one of 7 phases. While in `triage`, each of its claims is being classified — once every claim has a committed disposition (one of 4 terminal triage values), the invoice auto-advances to `ready_to_submit`. The operator clicks Submit; the invoice moves to `submitted`. When a payor response arrives, the invoice auto-advances to `response_received`; the operator drafts and confirms a verdict for each claim, and once every claim has a confirmed verdict, the invoice auto-advances to `reviewed`. From there it goes to either `awaiting_reattestation` (if any verdict was Approved or Partial) or directly to `closed`. Re-attestation completion moves it to `closed`. Hold is a flag, not a phase, that pauses the auto-advancement.

That's the description on a whiteboard. No "well, it depends on whether `closure_reason` is null AND `reattestCompletedAt` is null AND..."

**What this doesn't answer:**
- Cross-invoice workflows (e.g. trip-overriding error types that bind multiple invoices). Out of scope; today these are modelled in `error_types` and don't need topology change.
- Per-claim verdict drafting UX. The verdict draft model is unchanged; only the column it writes to (`disposition` instead of `outcome`) differs.
- Submission retries, response reclassification, attestation cascade engagement — all internal to specific phases; their existing logic still runs, just bracketed by phase transitions instead of free-running cache writes.

---

## 12. Pointers

- **Contract being subsumed:** `docs/architecture/invoice-terminal-state.md` (terminal-state collapses into `phase=closed`)
- **Audit being healed:** `docs/architecture/state-vocabularies-audit.md` (drift bugs #1–#10 become unrepresentable; #11 fixed by `lib/observability`)
- **Cancelled lock-down plan:** `docs/architecture/state-migration-plan.md` (mapping tables in §B and §C still useful as the row census; the wave structure is superseded by §7 here)
- **Existing per-leg derivation:** `lib/leg-state/src/per-leg-sub-status.ts` — its sub-status logic is the seed of `deriveDisposition`
- **Existing macro-phase logic:** `artifacts/api-server/src/lib/macro-phase.ts` — its 7-value enum is the seed of `INVOICE_PHASES`
- **Existing transition skeleton:** `artifacts/api-server/src/lib/group-transitions.ts` — its 3 transition functions become the implementation kernel of `transitionInvoice`
