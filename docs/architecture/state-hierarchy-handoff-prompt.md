# Handoff prompt: Hierarchical state machine refactor

**Purpose:** Comprehensive context for a fresh main agent picking up this project. Read this in full before taking any action. The previous session built up the plan; you execute it.

---

## 0. Who you are and what this is

You are a Replit main agent in the ClaimClear monorepo, picking up a project that the previous agent (running short on context budget) handed off cleanly at a wave boundary. **All planning is done.** The brief is locked. The execution plan is locked. Your job is execution discipline, not re-planning.

You are in **Build mode**. The user operates the app and reviews work; they do not write code. They are technical enough to engage on architecture but expect plain-language updates and per-wave checkpoints. They have **full platform control** — no external API consumers to placate, no deprecation windows.

---

## 1. Mandatory reading (in this order, before any action)

1. **`replit.md`** — project overview, conventions, "State model" section pointing at the four state docs
2. **`docs/architecture/state-hierarchy-v1.md`** — THE MODEL. Plan of record. 7 invoice phases, claim dispositions per phase, transition functions, what gets deleted, schema diff, mapping from today's tuples to (phase, disposition).
3. **`docs/architecture/state-hierarchy-execution-plan.md`** — THE EXECUTION PLAN. Wave-by-wave (0 → A → B → C → D → E), with blast radius (~120 files inventoried), 7 named anti-slop audits, per-wave sign-off checklist. **This is your operational playbook.**
4. **`docs/architecture/state-vocabularies-audit.md`** — the drift census that triggered this work (8 pgEnums, 12 text-as-state cols, 12 catalogued drift bugs, 6-layer state model). Reference when you need to understand "why is the model the way it is."
5. **`docs/architecture/invoice-terminal-state.md`** — the terminal-state contract that gets subsumed into `phase=closed`. Reference for the historical 7-way truth-table predicate.
6. **`docs/architecture/state-migration-plan.md`** — **CANCELLED.** Kept only for the row census in §B (162 group + 102 claim drift rows). Do NOT execute anything from this document. Its waves and step numbers are obsolete.

After reading the four state docs (~2-3 hours of human reading; faster for you), you should be able to answer:
- "Why is the invoice the noun and not the claim?"
- "What is the entry condition for `phase=ready_to_submit`?"
- "What does `setClaimDisposition` do that direct `db.update(claims)` doesn't?"
- "Why do `denormalized-cache.ts`, `macro-phase.ts`, `lifecycle-phase.ts` get deleted?"
- "What is anti-slop audit A2 and when does it fire?"

If you can't answer those after reading, re-read before doing anything.

---

## 2. What was decided (DO follow these)

| Decision | Where it's recorded |
|---|---|
| Invoice = noun that moves through 7 sequential phases (`triage, ready_to_submit, submitted, response_received, reviewed, awaiting_reattestation, closed`) | brief §1 |
| Claim = work item with `disposition` valid only within parent's current phase, enforced by DB trigger | brief §2, §5.2 |
| Two writer functions: `transitionInvoice(invoiceId, toPhase, ctx)` and `setClaimDisposition(claimId, toDisposition, ctx)` — single source for all state writes | brief §3 |
| `maybeAdvanceInvoice(invoiceId)` is the only auto-advancement code path | brief §3.2 |
| Hold becomes a flag (`hold_reason IS NOT NULL`), not a phase. It pauses `maybeAdvanceInvoice`. | brief §1, §9.6 |
| 5-wave execution: A (foundations) → B (schema+backfill) → C (switch reads + training) → D (switch writes + delete cache) → E (drop columns) | execution-plan §3-§8 |
| 4 publishes: separate publish after each of A, B, C, D, E. C and D do NOT bundle. | execution-plan §6, §7 |
| Migration B is atomic: schema + backfill + trigger in one transaction | execution-plan §5.B.2 |
| SSE payloads carry BOTH old and new state fields B → D, then E removes old | execution-plan §1.10, §5.B.3, §8.E.5 |
| Training guide updates ship in same publish as Wave C | execution-plan §1.9, §6.C.4 |
| One project task: "Hierarchical state machine refactor (Waves A-E)" — not five separate tasks | (verbal in handoff session, not written elsewhere) |
| `lib/observability` package fixes drift bug #11 (audit/state-event registry) and is built as part of Wave A2 | execution-plan §4.A.2 |
| Custom ESLint rule `no-direct-state-update` blocks bypass of transition functions | execution-plan §7.D.3 |

## 3. What was rejected (DO NOT propose these again)

| Rejected idea | Why |
|---|---|
| Task #512 lock-down-only plan (heal drift, leave topology) | Cleans data but leaves the bidirectional cache + 6 group writers + 5 claim writers. Doesn't answer counsel's "describe it as a hierarchy" question. State-migration-plan.md is the cancelled artifact. |
| Big-bang single publish (do all 5 waves, ship once) | Worst rollback profile. Discovering a bug means reverting 5 waves' worth of change with all of them already touching prod. |
| Per-wave isolated task agents (5 separate project tasks, each in its own branch) | Waves are strictly sequential (B blocked by A, etc.). No parallelism to exploit. Splitting creates 5 merge moments where reviewers re-load context. |
| Bundling C + D in one publish | Wave C is reversible (UI reads change); Wave D is one-way (cache file deleted). Need ≥24h of C in prod to spot UI regressions before topology change ships. |
| Soft-deprecation windows for the OpenAPI status/outcome fields | No external API consumer. Drop fields in same PR that stops using them. |
| Boot-time backfill scripts | The user explicitly cited "Task #74 burn." Backfills go in the migration UP, atomically. Never in app boot. |
| "Drop `claims.attestation_state` column" (from original audit) | Has heavy live consumers (~50 OpenAPI refs, dashboard, routes/claims, routes/invoice-groups, lib/attestation). KEPT — gets renamed to `disposition` in the migration; data preserved. |
| Splitting `lib/observability` work into a separate pre-project | Small enough to bundle into Wave A2; folding in keeps the project scope coherent. |

## 4. User preferences and working style

These are non-negotiable:

- **Plain language.** Never refer to tool names or skill names in user-facing communication. "I'll search the codebase" not "I'll use ripgrep." "I'll save progress" not "I'll write to session_plan.md."
- **No boot-time scripts.** Ever. Migrations carry their own data backfill atomically.
- **No deprecation windows** for external consumers — there are none. But internal dual-write windows during a wave (e.g. SSE payload carrying both fields B→D) are correct and required.
- **Schema + data + code in one PR per wave.** No "schema PR → data PR → code PR" sequencing.
- **Full platform control.** Don't write defensive code that contorts around legacy shapes. Delete and replace.
- **Per-wave checkpoint.** Stop after each wave's audits, report results, ask for green light to publish. Do NOT charge through.
- **Verification discipline above speed.** The user explicitly wants anti-slop audits enforced. If an audit fails, STOP — do not fix the audit, fix the cause.
- **No emojis** in communication unless the user uses them first.
- **No comments in code** unless explicitly asked.
- **Communicate progress factually.** Not "I successfully completed step X!" but "Step X done. Audit A2 returns zero. Ready for your sign-off on publish #N."

The user expects to be able to stop mid-project and not lose progress. Use `.local/session_plan.md` to track wave progress if it would help, but only if the work is mid-wave and you need to checkpoint.

---

## 5. The discipline rules (the anti-slop framework)

From execution-plan §2, the seven named audits:

| ID | Audit | When it fires | What it catches |
|---|---|---|---|
| A1 | Census parity (pre/post row counts match through §6 mapping) | After Wave B | Backfill silently skipped rows |
| A2 | Zero-rg-result (specific ripgrep queries return no matches) | End of every wave | Missed call site / unmigrated reference |
| A3 | Conformance script (`check-invoice-state-derivation.ts` against prod) | Every PR after Wave A | Production data violates a rule |
| A4 | SSE payload contract test | Waves B, E | Field shape regression |
| A5 | Test fixture audit (count old-vocab vs new-vocab fixtures) | Waves C, D, E | Tests still using stale shape |
| A6 | Manual smoke runbook (specific operator flows in running app) | Waves C, D, E | Behavior regressions tests can't catch |
| A7 | Lint rule effectiveness (deliberately violate, confirm rejection) | Waves A, D | Lint rule not actually wired |

**Operating principle: every audit must pass before publishing. No exceptions.** If an audit fails:
1. Do not publish.
2. Investigate the cause.
3. Fix the cause (not the audit — the audit is the spec).
4. Re-run the audit until green.
5. Then proceed.

The execution plan §10 has a per-wave sign-off checklist. Use it literally — do not paraphrase or skip items.

---

## 6. What you should do FIRST (Wave 0)

Wave 0 is the pre-flight census. Detailed in execution-plan §3.

**Goal:** Prove the §6 mapping in `state-hierarchy-v1.md` covers every prod row before any code is written.

**Steps:**

1. Run two read-only SQL queries against prod via `execute_sql` with `environment: "production"`:
   - Census of `(status, outcome, reattest_required, reattest_completed_at IS NOT NULL, closure_reason, hold_reason IS NOT NULL)` tuples in `invoice_groups`
   - Census of `(status, outcome, sop_outcome, attestation_state, included_in_dispute, duplicate_of_claim_id IS NOT NULL, drop_reason IS NOT NULL)` tuples in `claims`
2. Run the §6.1 mapping SQL (in execution-plan §3 step 3) against prod — must return zero NULL rows.
3. Run the §6.2 mapping SQL — must return zero NULL rows.
4. Save outputs to `docs/architecture/state-pre-migration-census.md` with §A (invoice census) and §B (claim census).
5. Report to user: total invoice count, total claim count, distinct phase distribution per §6.1 mapping, distinct disposition distribution per §6.2 mapping, any rows that mapped to NULL (should be zero).

**If §6.1 or §6.2 returns ANY non-zero rows:** STOP. Do not proceed. The mapping has a gap. Surface it to the user with the offending tuples; the brief must be revised before code is written. Treat this as expected — better to find a gap now than after Wave B's migration runs.

**Do NOT touch code in Wave 0.** Read-only census only.

**After Wave 0:** Report findings, then await user green light for Wave A.

---

## 7. What you must NOT do

- **Do NOT skip the mandatory reading.** The four state docs encode decisions you don't have context for otherwise.
- **Do NOT propose alternatives to decisions in §2 above** without strong new evidence. They were debated.
- **Do NOT propose any of the rejected ideas in §3 above.**
- **Do NOT execute anything from `state-migration-plan.md`.** It's cancelled. Reading it for the row census is fine; following its waves is wrong.
- **Do NOT publish without the §10 sign-off checklist complete and user green light.**
- **Do NOT bundle scope.** A wave's PR contains exactly that wave's work. If you discover a tempting "small fix" mid-wave, note it for follow-up, do not include it.
- **Do NOT run DDL or data-mutating SQL directly against prod.** Migrations ship via the deploy process. Read-only `execute_sql` against prod is fine for census + verification.
- **Do NOT skip the manual smoke runbook (A6)** because tests pass. Tests can't catch SSE payload shape regressions or micro-interaction silent failures.
- **Do NOT fix an anti-slop audit by tweaking the audit.** The audit is the specification. Fix the underlying cause.
- **Do NOT invent new project tasks.** This work runs as one task per the handoff agreement. If the user is in Plan mode, follow the project_tasks skill; if Build mode, execute directly.
- **Do NOT add code comments** unless explicitly asked.
- **Do NOT use emojis in communication** unless the user uses them first.
- **Do NOT charge through wave boundaries** without checkpoint with the user.
- **Do NOT delete or rewrite this handoff doc.** It's the contract between sessions.

---

## 8. The blast-radius hot spots (reread before each relevant wave)

Three areas the previous agent flagged as silent-failure risks. The execution plan has full detail; this is the reminder list:

**Micro-interaction engine (Task #509)** — execution-plan §1.6
- `cohesion/tone.ts` `toneForStatus()` — 13-case switch on raw status strings. Wave C must rewrite as `toneForPhase` + `toneForDisposition` with deprecated passthrough.
- `useActorCausedTransition` watches `.status` field — if field renamed, no transitions detected, micro-interactions silently fail.
- 6 specific celebrations at risk (decision-tree checkmark, group-cleared fade, day-complete confetti, save breath, number ticker, bulk row shimmer). Manual smoke runbook A6 includes verifying each.

**SSE payload contract** — execution-plan §1.10
- `broadcastClaimEvent` and `broadcastGroupEvent` payloads carry status fields that 12+ client subscribers destructure.
- Strategy: payloads carry BOTH old + new fields from B → D, then E removes old after `rg "event\.status|event\.outcome" artifacts/claimclear/src/` returns zero.
- A4 contract test enforces this at each transition.

**Training guide artifact** — execution-plan §1.9
- 10 slides reference the current vocabulary. `StatusLifecycle.tsx` is dedicated to teaching the 13-status model.
- MUST ship in same publish as Wave C — otherwise operators see UI that doesn't match training.
- Not optional, not deferrable.

---

## 9. Communication template with the user

After each significant action, report in this shape:

```
## What I did
- [factual list]

## Audits
| Audit | Result |
|---|---|
| A2: rg "denormalized-cache" returns zero | ✓ zero results |
| A3: conformance script | ✓ green, prod returned 0 violations |
| ... | ... |

## What's next
[1-2 sentences on the next action AND whether it requires your sign-off]
```

When asking the user to make a decision, give them clear options. When reporting findings, use tables. Reference doc sections by number when explaining ("per execution-plan §5.B.2…").

When the user is checking work in prod and reports an issue, take it seriously and investigate before proposing a fix. Do not be defensive about the plan.

---

## 10. Tools you'll use most

- **`execute_sql`** — for prod census (Wave 0) and post-publish verification (Waves A onward). Always `environment: "production"` for prod, never default. ALWAYS read-only.
- **`bash`** with `rg` — for A2 zero-result audits. The plan specifies exact `rg` queries per wave.
- **`read`** — for the four state docs and any file you're about to modify.
- **`write` / `edit`** — for code changes. Prefer `edit` for surgical changes; `write` for new files.
- **`refresh_all_logs`** — after Wave B/C/D publishes, check the workflow logs for trigger errors, missed migrations, etc.
- **`screenshot`** — for A6 manual smoke (visual verification of micro-interactions per Wave C).
- **`fetch_deployment_logs`** — after each publish, check production for unexpected errors.

You have access to the Replit skill set (delegation, design, mockup-sandbox, etc.). Most of this work is straight engineering — you'll use those skills sparingly. The DESIGN subagent might help on the training-guide rewrite in Wave C.

---

## 11. State of the world right now (handoff snapshot)

- **Current wave:** none yet started. Wave 0 is next.
- **Active tasks:** none. (Task #512 was cancelled at handoff; no replacement task exists yet.)
- **Mode:** Build mode.
- **Workflows running:** api-server, claimclear (web), training-guide (web), mockup-sandbox.
- **Last commit:** `65e51d8` — "Write a detailed plan to update how statuses are handled" (this handoff doc + the execution plan).
- **Outstanding open questions from brief §9:** 6 items, none blocking Wave 0. Surface them to the user when relevant per wave.

---

## 12. Your first message to the user

After reading the mandatory docs (§1) end-to-end, your first message should:

1. Confirm you've read the four docs and can answer the §1 self-check questions
2. Summarize what you understand the project to be (one paragraph, in your own words — proves you read, not just skimmed)
3. Confirm Wave 0 is what you'll do next, summarize what Wave 0 produces
4. Ask the user to confirm they want you to start Wave 0, OR raise any concerns from your reading

Do NOT start executing Wave 0 until you have explicit user confirmation. The previous agent left this checkpoint deliberately.

---

## 13. If anything in the plan looks wrong on closer reading

The previous agent built this plan over a single session. They could have made mistakes. If you notice something that looks wrong — a mapping in §6 that doesn't make sense, an audit that wouldn't actually catch what it claims, a missed file in the blast radius — RAISE IT TO THE USER before executing.

The plan is the plan. But the plan is also a hypothesis. If your fresh eyes spot a problem, that's exactly when it should be spotted.

Do not, however, treat "I would have planned this differently" as "the plan is wrong." Re-planning is not your job. Execution discipline is.

---

End of handoff prompt. Begin by reading `replit.md`, then the four state docs in §1 order.
