# Invoice-as-state-machine: hierarchical state model v1.1

**Date:** 2026-05-09.
**Status:** Plan-of-record. Supersedes `state-hierarchy-v1.md` (preserved as historical reference).
**Predecessors:**
- `docs/architecture/state-hierarchy-v1.md` — the v1 plan; this doc folds in prerequisites and corrections found during the 2026-05-09 adversarial review
- `docs/audits/state-readers-writers-2026-05-08-v2.md` — the audit that motivated this work
- `.local/tasks/reader-lockstep-finish.md` — the active hotfix shipping ahead of this plan

---

## 0. What changed from v1

v1 was correct in shape but had five hidden prerequisites and two unresolved contradictions that would have caused a Wave B–E executor to either fail mid-flight or introduce a new class of drift. v1.1:

1. **Adds Wave A.5** — adversarial fixture suite. The current conformance check passes 0/4006 only because today's writers and today's deriver share the same assumptions. That is not a correctness proof of the deriver against rare combinations not present in current production data.
2. **Adds Pre-Wave-B** — generated column unwind. `claims.is_open` and `invoice_groups.is_open` are `GENERATED ALWAYS AS (status IN OPEN_STATUSES)` columns. Postgres rejects `DROP COLUMN status` while a generated column references it. v1's Wave E cannot run without this prerequisite.
3. **Resolves the cross-row trigger contradiction.** v1 §5.2 proposes a deferrable trigger structurally identical to the recompute trigger explicitly rejected in `.local/tasks/single-writer-enforcement.md` on platform-stability grounds. v1.1 drops the trigger; validation moves to the application-layer transition functions, with a periodic conformance worker as the safety net.
4. **Restructures Wave C** — codegen is not "code-only and reversible." Regenerating the OpenAPI artifacts is atomic across every typed consumer. v1.1 sequences the spec change and the consumer migration explicitly, with a fixture-rewrite PR ahead of the read-switch.
5. **Adds Wave D.5** — rewrite `whats-next-derivation.ts`. v1 deletes `macro-phase.ts` server-side but leaves the 524-line client derivation engine in place. That engine is one of the three places drift currently lives; without rewriting it, the same bug class re-emerges on the client.
6. **Adds Wave E.5** — operator vocabulary change. The training-guide artifact teaches the legacy 13-status vocabulary by name across 13 slide files. Vocabulary collapse is an operator-documentation change, not just a code change. Schedules them as a single coordinated release.
7. **Adds three pre-flight operator decisions.** Hold semantics, auto-advance on verdict, and reverse-transition policy are operator-UX questions, not engineering ones. v1 deferred them implicitly; v1.1 names them explicitly as required sign-offs before Wave D.
8. **Adds lock-ordering contract.** v1's `transitionInvoice` and `setClaimDisposition` both lock the parent invoice; without a documented ordering, concurrent operators on different claims of the same invoice can deadlock. v1.1 names a single helper as the canonical lock acquirer.
9. **Adds rollback procedure for Wave D.** v1 admits Wave D is "one-way operationally" and stops there. v1.1 requires Wave D to ship behind a feature flag with both code paths live for at least one operator-week before the cache file is deleted.
10. **Adds continuous conformance worker.** v1's check is a CLI script. v1.1 promotes it to a 5-minute cron during the entire migration window.

The seven phases (§1), claim dispositions (§2), and transition API (§3) from v1 are unchanged. What follows replaces v1 §5 (schema diff), §7 (execution plan), and §10 (risk/reversibility).

---

## 1–3. Unchanged from v1

See `state-hierarchy-v1.md` §1 (seven phases), §2 (dispositions), §3 (transition API). The shape of the model is correct.

One clarification to §3.1: every transition function MUST acquire its locks via the canonical helper:

```ts
// lib/invoice-state/src/locking.ts
export async function lockInvoiceAndClaims(
  invoiceId: number,
  ex: DbExecutor,
): Promise<{ invoice: Invoice; claims: Claim[] }>;
```

Lock order is **always** parent invoice first, then children in `claim_id ASC` order. Every writer goes through this helper; raw `SELECT ... FOR UPDATE` against either table is banned by the lint rule from `single-writer-enforcement.md`.

---

## 4. What gets deleted (revised)

Same as v1 §4 with two corrections:

- **`whats-next-derivation.ts` is rewritten, not preserved.** The new implementation is ~50 lines: read the invoice's phase, look up legal next transitions in `INVOICE_TRANSITION_TABLE`, render them. No string-match gates. This is Wave D.5; without it, the third derivation engine remains a drift surface.
- **Generated `is_open` columns are migrated, not dropped in-place.** They become `GENERATED ALWAYS AS (phase != 'closed')` for invoices and `GENERATED ALWAYS AS (disposition NOT IN (final_*))` for claims. The transition happens in Pre-Wave-B; legacy `status`-based generated columns are dropped in Wave E.

---

## 5. Schema diff (revised)

### 5.1 New columns — unchanged from v1

### 5.2 Cross-row constraint — REPLACED

v1 proposed a deferrable trigger. **v1.1 drops the trigger.** Rationale: a bug in `validate_disposition_against_phase()` aborts every transaction system-wide, which is incompatible with the user's "platform must not go down" constraint and with the explicit rejection of recompute triggers in `single-writer-enforcement.md`.

Validation is enforced in three layers without trigger risk:
1. **Application-layer guard.** `setClaimDisposition` rejects invalid `(phase, disposition)` tuples before write. Same set as v1's `VALID_DISPOSITIONS_BY_PHASE`.
2. **Compile-time TypeScript constraint.** `setClaimDisposition`'s parameter is a discriminated union over phase, so invalid combinations don't typecheck.
3. **Continuous conformance worker.** A 5-minute cron runs `check-invoice-state-derivation.ts` against prod for the entire Wave B–E window. Any non-zero count pages on-call.

The application-layer check is identical in correctness to the trigger but fails one transaction at a time instead of all of them. The conformance worker catches anything the application missed.

### 5.3 Dropped after migration — unchanged from v1, but ordering changes

The DROP COLUMN sequence requires the generated-column unwind from Pre-Wave-B to have shipped first. See §7 for ordering.

---

## 6. Mapping today's data → new model — unchanged from v1

v1 §6 mapping tables stand. Adversarial fixtures (Wave A.5) extend §6's coverage to combinations not currently present in production.

---

## 7. Execution plan (revised)

Six waves plus three pre-flight gates. Each wave is independently shippable. **No wave starts until its preconditions are documented as met.**

### Pre-flight gate 0 — operator-UX decisions (must precede Wave D)

Three sign-offs required, in writing, from the team owning operator workflow:

| Decision | Default if no sign-off | Affected file |
|---|---|---|
| Does `setClaimDisposition` of the *last* unverdicted claim auto-advance the invoice from `response_received` → `reviewed`? | NO (operator clicks Re-attest manually, preserving today's behaviour) | `lib/invoice-state/src/disposition.ts` (`maybeAdvanceInvoice` definition) |
| Does `hold_reason IS NOT NULL` pause auto-advancement of the parent invoice through `INVOICE_TRANSITION_TABLE`? | YES (matches today's "frozen workflow" expectation) | `lib/invoice-state/src/transitions.ts` (early-return in `maybeAdvanceInvoice`) |
| Which reverse transitions are admins allowed to perform? Today: `routes/admin.ts:106` allows `Resolved → Awaiting Response` (i.e. `closed → submitted`). v1 only allows `closed → reviewed`. | Match today's superset; add `closed → submitted` and `closed → response_received` to `INVOICE_TRANSITION_TABLE` with `trigger: 'admin'` | `lib/invoice-state/src/transition-table.ts` |

### Wave A — Read-side foundations (already done; unchanged)

A1 (lib/invoice-state package), A2 (lib/observability), A3 (CI conformance check) shipped. Verified in `state-readers-writers-2026-05-08-v2.md`.

### Wave A.5 — Adversarial fixture suite (NEW)

**A.5.1.** Add fixtures to `lib/invoice-state/src/__tests__/derivation.test.ts` covering, at minimum:
- Every `(status, outcome, reattestRequired, reattestCompletedAt, closureReason)` tuple that currently has zero rows in production but is declarable through the writers
- Hold + every phase combination (today only certain phases are observed on hold)
- Every reverse-transition admin path called out in pre-flight gate 0
- Two-path collapse: rows where `included_in_dispute=false AND drop_reason IS NULL` (excluded path) AND rows where `included_in_dispute=true AND drop_reason='non_issue'` (dropped path) — the deriver must produce identical disposition for both
- Duplicate chains where `duplicate_of_claim_id` points at a claim that itself has been marked `disposition='blocked'`

**A.5.2.** Inventory every reader of `claims.included_in_dispute`. The two-path collapse drops this column in Wave E; any reader that queries on it gets a different answer post-migration. Document each reader and its replacement query.

**A.5.3.** Run the conformance check against prod with the extended fixtures injected as synthetic rows. Must pass.

Done looks like: extended fixture suite green; included-in-dispute reader inventory written; pre-flight gate 0 decisions checked into the transition table.

### Pre-Wave-B — Generated column unwind (NEW)

`claims.is_open` and `invoice_groups.is_open` are `GENERATED ALWAYS AS` columns referencing legacy `status`. Postgres rejects `DROP COLUMN status` while a generated column references it. This wave does the swap.

**Pre-B.1** Add new generated columns alongside the old ones:
```sql
ALTER TABLE invoice_groups ADD COLUMN is_open_v2 boolean
  GENERATED ALWAYS AS (phase != 'closed') STORED;
ALTER TABLE claims ADD COLUMN is_open_v2 boolean
  GENERATED ALWAYS AS (disposition NOT IN ('final_reattested','final_withdrawn','final_denied','final_nonissue')) STORED;
```
Both columns are populated by Postgres on every row immediately. Zero downtime.

**Pre-B.2** Audit and migrate every reader of `is_open`. Search for the column name and for the `OPEN_STATUSES` set in `lib/leg-state/src/openness.ts`. Each reader switches to `is_open_v2`.

**Pre-B.3** Drop `is_open`, rename `is_open_v2` → `is_open`. Update the schema TS files. Regenerate drizzle migrations.

This must ship and soak before Wave B begins. It cannot be combined with Wave B because Wave B depends on `phase` being populated, which Pre-Wave-B does not yet require.

### Wave B — Schema + dual-write backfill (revised)

Same as v1 §B1 except:
- Cross-row trigger from §5.2 is **dropped**. Validation is application-layer.
- Backfill runs in a single migration transaction as v1 specified.
- The conformance worker (see Pre-Wave-C below) is started as part of this PR's deploy script.

### Pre-Wave-C — Continuous conformance worker (NEW)

**Pre-C.1** Promote `scripts/check-invoice-state-derivation.ts` to a registered cron. Schedule: `*/5 * * * *` for the entire Wave B–E window. Surface drift count as a metric; non-zero pages on-call.

**Pre-C.2** Add a dashboard tile: "Invoices stuck in any phase >24h with all child verdicts recorded." This is the cheap leading indicator that catches future state-machine regressions within a day instead of weeks. Lives in production permanently — not just during migration.

### Pre-Wave-C.5 — Test fixture rewrite (NEW)

The 30+ test files hardcoding `"Needs Review"`/`"Ready to Review"`/`"MAS Eligible"`/etc. are migrated to a fixture builder that emits both legacy and canonical fields. Goal: any reader-switch in Wave C does not require simultaneous test changes.

Inventory (non-exhaustive, regenerate before starting):
- `artifacts/api-server/src/__tests__/fixtures/state.ts` (the central fixture)
- All `*-parity.test.ts`, `*-transitions.test.ts`, `*-target-status.test.ts` files
- `lib/invoice-state/src/__tests__/derivation.test.ts`
- `artifacts/claimclear/src/lib/transitions-partition.test.ts`

Fixture builder accepts a phase + disposition tuple and emits the matching legacy `(status, outcome)` per `derive-phase.ts`. Tests that need to assert behaviour against a specific legacy string keep one literal pinned.

### Wave C — Switch reads (revised)

Same as v1 §C1 with three additions:
- Test fixture rewrite (Pre-Wave-C.5) must be merged first.
- OpenAPI spec change ships in this PR. Both `(status, outcome)` and `(phase, disposition)` are present on every response; old fields are marked `deprecated: true` in the spec.
- Codegen artifacts (`lib/api-zod/src/generated/`, `lib/api-client-react/src/generated/`) are regenerated in the same commit. CI must pass for both backend and frontend in the single PR; there is no compatibility shim phase.

### Wave D — Switch writes (revised, behind feature flag)

Same as v1 §D1 with one critical change: **`denormalized-cache.ts` is NOT deleted in this PR.**

Wave D ships with both code paths behind a feature flag:
- `USE_TRANSITION_FUNCTIONS=true` (new path) — every writer calls `transitionInvoice` / `setClaimDisposition`
- `USE_TRANSITION_FUNCTIONS=false` (old path) — the existing canonical helpers continue to write legacy columns and refresh the cache

Both paths populate both column sets. The flag controls which path is canonical for *new* writes; reads in Wave C are already on `phase`/`disposition` so they don't care.

Soak time: minimum **one operator-week** with the flag on for 100% of traffic, conformance worker green, no incident reports tagged "state machine."

### Wave D.5 — Rewrite `whats-next-derivation.ts` (NEW)

The 524-line client derivation engine is replaced with a ~50-line implementation:
1. Read invoice's `phase` and `disposition[]` from the API response.
2. Look up legal next transitions in `INVOICE_TRANSITION_TABLE` (shared with the server via `lib/invoice-state`).
3. For each legal transition, compute its guard against the local data; if guard passes and trigger is `operator`, render its CTA; if trigger is `auto`, render an explanatory chip.
4. No string-match gates. No hand-written enable conditions.

This is the structural fix for the bug class that motivated this entire plan. Without it, the client retains its own gate logic that can drift from the server.

### Wave E — Drop the old columns (revised)

Same as v1 §E1, but `denormalized-cache.ts` deletion happens here, after Wave D's feature flag has been hard-coded to `true` for at least one full release cycle.

### Wave E.5 — Operator vocabulary change (NEW)

Coupled to Wave E by release calendar:
- Rewrite the 13 training-guide slide files to teach the 7-phase vocabulary
- Update operator-facing documentation in `replit.md` and any internal runbooks
- Send an operator changelog summarizing the new phase names and what the old status names map to

Ships in the same release as Wave E. Operators see the new vocabulary in both the app and the training guide on the same day.

---

## 8. Risk + reversibility per wave (revised)

| Wave | Schema risk | Data risk | Code blast radius | Reversibility |
|---|---|---|---|---|
| Pre-flight gate 0 | None | None | Three transition-table entries | Trivial — revert decisions |
| A.5 | None | None (test-only writes) | Test files + one inventory doc | Trivial |
| Pre-Wave-B | One column rename, zero data loss | None (new column auto-populated by Postgres) | Every `is_open` reader (~12 sites) | Reversible: re-add old generated column |
| B | Two new enums, two new columns, one txn backfill | All rows touched in one txn (~3700) | Read-only columns, no behaviour change | Reversible: drop columns + types |
| Pre-Wave-C | None | None | One new cron, one dashboard tile | Trivial |
| Pre-Wave-C.5 | None | None | ~30 test files | Trivial |
| C | None | None | ~30 read sites + ~15 client + codegen artifacts in one PR | Reversible: revert commit; old columns still populated |
| **D** | **None** | **Behaviour: writes go to new columns** | Every writer (~12) behind feature flag | **Reversible during soak**: flip flag; one-way only after Wave E |
| D.5 | None | None | One client file rewritten | Reversible: revert commit |
| E | DROP COLUMN ×7, DROP TYPE ×2 | None (data already migrated and unused) | OpenAPI codegen | One-way |
| E.5 | None | None | 13 slide files + docs | Trivial |

The single highest-risk step is now Wave D + E together. Wave D is reversible during its soak; Wave E is one-way. The feature-flag soak gives the entire team a defined window to catch regressions before the irreversible step.

---

## 9. Open questions — RESOLVED in v1.1

v1's §9 had six open questions. v1.1 resolves them:

1. **`phase_entered_at`** — yes, stored. Already added in Wave A schema; unchanged.
2. **`Generating Email`** — dropped from the phase enum. Modelled as a per-invoice `email_in_flight` boolean flag. Migrated in Pre-Wave-B; the email-send code reads/writes the flag instead of writing a status.
3. **Reverse transitions** — see Pre-flight gate 0.
4. **Per-claim phase exposure** — `disposition` is exposed directly with friendly labels. Design pass owned by the design subagent before Wave D.5.
5. **Email sends as phase trigger** — keep in `outbound_emails`; the guard for `submitted` aggregates that table. Cost is acceptable (sub-millisecond at current row counts).
6. **Hold semantics** — see Pre-flight gate 0. Default: hold pauses auto-advancement.

---

## 10. Pointers (unchanged from v1, plus)

- `.local/tasks/wave-a5-adversarial-fixtures.md` — Wave A.5 task plan
- `.local/tasks/pre-wave-b-generated-column-unwind.md` — Pre-Wave-B task plan
- `.local/tasks/state-machine-operational-alert.md` — Pre-Wave-C tile/cron task plan
- `.local/tasks/state-hierarchy-wave-b.md` — DEFERRED until preconditions met
