# ClaimClear Architecture Transition: Per-Claim → Per-Invoice

**Status:** Design committed, implementation in flight
**Last updated:** 2026-04-30
**Owners:** Adam (product), agent team (engineering)

---

## Why this document exists

The platform is mid-flight on a structural change to how disputes are modeled. Until now, the **claim** (a single ride/trip/leg) has been the canonical unit of work — workflows live on claims, statuses live on claims, the workflow player drives a claim through stages, and groups have been a passive container for batched submission. The portal we submit to does not work that way: **MAS accepts one dispute submission per invoice**, and the payor responds at the invoice level, not per-leg.

That mismatch has produced a long tail of surface-area bugs: two control surfaces (claim-level and group-level workflow players), two writeup paths (per-claim and per-group submission generators), two closure dialogs, mis-attributed cascades, "Needs Review" with two different meanings, status drift between groups and their disputed legs, and operators having to mentally reconcile per-leg state against per-invoice realities.

We are committing to **the invoice (group) as the canonical unit of dispute**, with **per-leg work preserved as an inner-tier sub-status** inside the group's pre-submit phase. This document captures the model, the rationale, the page-by-page and workflow-by-workflow impact, and what's already aligned vs. what still needs to change. It exists because:

1. The transition touches every page, every state machine, the schema, and the operator's mental model. We need a record of decisions and trade-offs that survives any individual task or PR.
2. Tasks are landing in pieces over many weeks, with multiple agents and multiple operator-product conversations. Without a single source of truth describing the target state, drift between tasks is inevitable.
3. There are operational concepts (MAS cancellation, re-attestation, partial-payout) that are not visible in the codebase and must be captured here so engineering decisions stay grounded in how the operators actually work.
4. Several already-shipped surfaces (#160, #162, #163, #164, #165, #168, #169) were built with hooks pointing at this target state. Future contributors need to know that's intentional, not coincidence.

---

## The portal contract (the immovable constraint)

Everything that follows is downstream of three facts about MAS, the upstream portal:

1. **One dispute submission per invoice.** You cannot file one dispute per leg. If an invoice has 4 problematic legs with 4 different error types, the operator must produce one writeup that handles all 4 in a single submission.
2. **MAS does not deal with amounts.** This department is verifying whether a claim can be processed at all, not pricing or dollar adjustments. Per-leg verdicts (Approved / Denied / Partial) are *processing* outcomes, not financial ones. There is no "approved for $X of $Y" workflow with MAS.
3. **MAS re-attestation is the universal terminal action.** Once the dispute is resolved (or partially resolved, or denied for some legs), the operator must go to a separate MAS portal interface, **cancel** any leg that was Denied or that was dropped pre-submit as `cannot_dispute`, and then **re-attest** the modified invoice so the remaining payable legs can flow through the normal payment cycle. This is done manually, outside our system. The only invoices that skip re-attestation are those where every leg ended Denied or `cannot_dispute` (nothing left to pay out).

If MAS changed any of the three above, large parts of this design would need to be revisited. So far they are stable.

---

## What we are NOT changing

- **Claims still exist as line items.** Every leg keeps its own row. Per-leg evidence, per-leg notes, per-leg audit history all stay.
- **Per-error-type decision trees still drive investigation.** `error_types.decision_tree` is still the SOP. A leg with `errorTypeId = 5` walks tree 5; its sibling leg with `errorTypeId = 7` walks tree 7. The trees themselves are unchanged.
- **Most existing schema columns.** We are reshaping `claims.workflow_progress` and `invoice_groups.workflow_progress` (both JSONB) and tightening one trigger on `attestationState`. We are not changing IDs, foreign keys, or core relational structure.
- **The bot submission pipeline.** The bot still picks up groups in a queued state and produces a single submission per invoice. The handoff signal moves slightly (operator-driven generation gate), but the bot's contract with the system is unchanged.
- **#160's three-reason closure model** (`cannot_dispute`, `non_issue`, `denied_by_payor`). We're extending the use of `cannot_dispute` and `non_issue` as per-leg drop reasons too, but the vocabulary is intentionally the same.
- **#168's understanding-readback gate** (operator confirms the AI understands their special circumstances before generating the dispute). Stays at the group level, where it always belonged.
- **#165's attestation queue** (admin review surface for "did the payor actually pay us"). Mechanism unchanged, only its auto-trigger gate moves (see §6).

---

## The two-tier state machine

The whole transition can be described as: **collapse the parallel claim/group control surfaces into one outer tier (the group's lifecycle) plus one inner tier (per-leg investigation, only meaningful inside the outer's pre-submit phase).**

### Outer tier: invoice/group lifecycle

```
┌──────────────┐   ┌──────────────┐   ┌──────────────────┐   ┌──────────────┐   ┌──────────────────┐   ┌────────┐
│  Pre-submit  │──▶│  In-flight   │──▶│ Response Pending │──▶│ MAS Action   │──▶│  Awaiting Payout │──▶│ Closed │
│ (operator    │   │ (bot         │   │ (per-leg verdict │   │ Required     │   │ (next payment    │   │        │
│  investiga-  │   │ submitted,   │   │ capture, AI-     │   │ (operator    │   │ cycle, #165's    │   │        │
│  tion +      │   │ awaiting     │   │ suggested,       │   │ does cancel  │   │ attestation      │   │        │
│  writeup)    │   │ response)    │   │ operator-        │   │ + re-attest  │   │ tracking)        │   │        │
│              │   │              │   │ confirmed)       │   │ in MAS)      │   │                  │   │        │
└──────────────┘   └──────────────┘   └──────────────────┘   └──────────────┘   └──────────────────┘   └────────┘
       │                                                            ▲
       │                                                            │
       └────── all legs dropped pre-submit (no portal submission) ──┘
```

**Edge case 1:** Every disputed leg is Dropped pre-submit (some `cannot_dispute`, some `non_issue`). There is no portal submission. The group skips In-flight and Response Pending and goes straight from Pre-submit → MAS Action Required → Awaiting Payout (if any `non_issue` legs are payable) or → Closed (if all `cannot_dispute`).

**Edge case 2:** All-denied terminal. Every leg ends Denied or `cannot_dispute`. MAS Action still happens (the cancellations) but Awaiting Payout is skipped — there's nothing to pay. The group closes as `denied_by_payor`.

**On Hold** is a parallel pause that can interrupt any phase. It is not a phase itself, it is a flag with a typed reason. "Awaiting evidence" is an On-Hold reason, not a separate state. Per-leg holds (e.g. one leg is blocked on a GPS report that takes a day to arrive) do not cascade to siblings.

### Inner tier: per-leg investigation (only inside Pre-submit)

```
                      ┌──────────────────────┐
                      │ needs_classification │   (no errorTypeId yet)
                      └──────────┬───────────┘
                                 │ classify
                                 ▼
                      ┌──────────────────────┐
                      │   investigating      │   (walking decision tree)
                      └──────────┬───────────┘
                                 │
            ┌────────────────────┼────────────────────┐
            ▼                    ▼                    ▼
      ┌──────────┐         ┌──────────┐    ┌──────────────────────┐
      │  ready   │         │ blocked  │    │  dropped              │
      │ (will be │         │ (on Hold │    │  reason: cannot_dispute│
      │  in      │         │ for      │    │       or  non_issue   │
      │ writeup) │         │ evidence)│    │                       │
      └──────────┘         └──────────┘    └──────────────────────┘
```

A leg's sub-status is shown wherever the leg is rendered (claim row, list table, queue card). Once the group submits, all sub-statuses freeze — the leg's investigation snapshot is preserved as part of submission #N's history. Post-response, sub-status either stays frozen or carries the per-leg verdict (see §5).

### The bridge: when can the group leave Pre-submit?

The group's "Generate Submission Preview" CTA unlocks when **every disputed leg has resolved its inner-tier work** to one of: `ready`, `dropped(cannot_dispute)`, `dropped(non_issue)`. `blocked` and `investigating` legs gate the group. The CTA's disabled-state tooltip names the gating reason explicitly ("2 of 4 legs still investigating") so the operator knows where to look.

Once the operator generates and approves the writeup, the group transitions to In-flight, all sub-statuses freeze.

---

## Per-leg outcome model

A leg's outcome is not one value, it is a sequence of three values written at three different lifecycle moments:

### 1. Pre-submit outcome (set during investigation)

| Value | Meaning | MAS action eventually needed |
|---|---|---|
| `(none)` — leg is `ready` | Will be in the writeup | Determined by post-response verdict |
| `dropped(cannot_dispute)` | Operator concluded we can't dispute it | **Cancel in MAS** (operationally a denial) |
| `dropped(non_issue)` | Original error flag was wrong; leg is fine | None — leg is clean, rolls into normal payment |

### 2. Post-response verdict (set during Response Pending phase)

Captured per leg, AI-suggested, operator-confirmed. Only legs that were `ready` (i.e. actually in the submission) get a verdict.

| Value | Meaning | MAS action eventually needed |
|---|---|---|
| `Approved` | MAS approved processing | None per-leg (re-attest covers it) |
| `Denied` | MAS denied processing | **Cancel in MAS** |
| `Partial` | MAS approved with caveats / acknowledgment | Treated as Approved for cancel purposes; caveats captured in note |

There are no dollar amounts in the verdict — MAS does not deal with amounts at this stage. Pricing is upstream/downstream of this department.

### 3. Post-MAS action (set during MAS Action Required phase)

Operator marks per-leg cancel completion and group-level re-attest completion. System records who/when. This is the audit trail for "did the operator actually do the MAS work."

### Group outcome (computed from the per-leg set)

| Per-leg set | Group outcome |
|---|---|
| All `Approved` (or `Approved + non_issue`-dropped) | `Approved` |
| Mix of `Approved` and `Denied`/`cannot_dispute`-dropped | `Partially Approved` |
| All `Denied` (or `Denied + cannot_dispute`-dropped) | `Denied (denied_by_payor)` |
| All `non_issue`-dropped + nothing was disputed | `Withdrawn` (narrow case, no actual dispute happened) |
| Otherwise (verdicts not yet captured) | `Pending` |

---

## The MAS Action Required phase

This is the new macro phase that did not exist before. It is the operational reality that has been invisible in the system until now.

**What happens.** The operator goes to a separate MAS portal interface (not the dispute portal) and:

1. **Cancels** every leg whose final per-leg state is in the cancel set:
   - `dropped(cannot_dispute)` legs from pre-submit
   - `Denied` legs from the response
2. **Re-attests** the modified invoice (the original invoice minus the cancelled legs) so the remaining payable legs can flow into the next payment cycle.

**Batching.** All MAS work for an invoice happens in one consolidated session **after** the dispute response comes back. A `cannot_dispute`-dropped leg from pre-submit does not get cancelled in MAS immediately — it sits in a quiet "cancel queued" sub-state until the rest of the invoice resolves, and is then bundled into the same MAS session as the post-response cancellations. This matches how operators actually work (one trip to MAS per invoice, not many).

**System role.** Tracking only. We surface the per-leg cancel checklist + the group re-attest checkbox, the operator marks completion, we audit who/when. There is no MAS API and no integration. If MAS ever exposes a signal we can read, that becomes a future enhancement; until then, manual.

**Skip conditions.**
- All-denied invoice: still passes through MAS Action (the cancellations) but Awaiting Payout is skipped. Group closes as `denied_by_payor`.
- All-`non_issue`-dropped + nothing disputed: no cancellations needed, no re-attest needed (the invoice was never modified from MAS's perspective). Group closes as `Withdrawn`.

---

## Schema reshape

### `claims.workflow_progress` — new shape (JSONB)

```typescript
{
  // Inner-tier per-leg investigation state
  status: "needs_classification" | "investigating" | "blocked" | "ready" | "dropped",
  decisionTreeNodeId?: string,    // bookmark in the tree, for resume
  answers: { [nodeId: string]: string },
  perLegContext?: string,          // leg-specific narrative for the writeup
  evidenceCollected?: string[],    // refs into claim_evidence
  readyAt?: string,                // ISO ts when operator marked Ready
  dropReason?: "cannot_dispute" | "non_issue",
  dropNote?: string,
  droppedAt?: string,

  // Post-response per-leg verdict (only for legs that were ready+submitted)
  legVerdict?: {
    suggested?: { outcome, confidence, reasoning, suggestedAt },  // AI-filled
    confirmed?: { outcome: "Approved" | "Denied" | "Partial", note?, by, at },
  },

  // MAS action tracking
  masAction?: {
    required: "cancel" | "none",       // derived from dropReason or legVerdict
    completedAt?: string,
    completedBy?: string,              // user id
  },
}
```

### `invoice_groups.workflow_progress` — simplified (JSONB)

```typescript
{
  // Group-level inputs to the writeup
  groupContext?: string,              // aggregate special circumstances
  understandingReadback?: string,     // from #168
  understandingReadbackAt?: string,
  generatedAt?: string,               // when writeup was generated
  generatedBy?: string,

  // Group-level MAS re-attest tracking
  reAttest?: {
    required: boolean,                // derived: any payable legs remain?
    completedAt?: string,
    completedBy?: string,
  },
}
```

The `currentStep` concept on the group is removed. The group's macro phase is computed from `(disputed-leg statuses, portal_submissions presence, response presence, verdict completeness, masAction state, attestationState)` — not stored.

### `claims.attestationState` — trigger refinement (#165)

Today: auto-pushed to `pending` the moment a verdict hits Approved.

New: auto-pushed to `pending` only when **(verdict = Approved/Partial) AND (group.reAttest.completedAt is set)**. Otherwise the attestation queue fills with rows that haven't actually been asked for payment yet, and the question "did the payor pay us?" is premature.

### `claims.status` — read-side computed

`claims.status` becomes a read-side projection of `(group's macro phase, leg's sub-status)`. Direct writes to `claims.status` outside of the cascade and the inner-tier transitions are deprecated. The single source of truth for display is the lifecycle-phase module from #169.

---

## Page-by-page impact

### Queue page (`queue.tsx`) — operator's day-one surface

**Before:** Two triage cards (Classification Inbox, Responses Awaiting Review) plus six lifecycle tabs.

**After:** Same shape, with refined lane definitions and a third triage lane:

- **Classification Inbox** — unchanged. Invoices with at least one `needs_classification` leg.
- **Responses Awaiting Review** — already exists from #162. Lists invoices in `Response Pending`. Verdict capture happens here or by clicking through.
- **MAS Action Required** *(new)* — replaces the currently-flagged-off "Resolution (Mark Paid)" lane in #162. Lists invoices where verdicts are captured but MAS work is outstanding. Per-leg cancel checklist + group re-attest checkbox surfaced inline.
- Lifecycle tabs (`LIFECYCLE_TABS` from #169) — extend to recognize the new MAS Action Required and Awaiting Payout phases.

The "Ready to Generate" lane (all legs Ready/Dropped, writeup not yet generated) is a new visibility surface for the bottleneck between investigation and submission. Probably an inline indicator on the Pre-submit lane rather than its own card; TBD.

### Claims top-level page (`claims.tsx`)

**Role shifts** from "list of work in progress" to "forensic search across all legs." Tab strip changes from macro lifecycle (which belongs to the group) to per-leg sub-status filters: `Needs Classification` / `Investigating` / `Blocked` / `Ready` / `Dropped` / `Frozen (in flight or later)`. Macro status remains visible per row but is read-only and inherited.

### Invoice Groups top-level page (`invoice-groups.tsx`)

**Becomes the primary list view for operators tracking dispute work.** Tab strip is the macro lifecycle (already true after #169). Each row's status pill shows the macro phase; a small breakdown indicator shows per-leg sub-status counts ("3 ready, 1 investigating, 0 dropped") for invoices in Pre-submit.

### Claim Detail page (`claim-detail.tsx`)

**Becomes a focused per-leg investigation view.**

- Breadcrumb back to parent invoice.
- Macro status displayed read-only (cascaded from group).
- Per-leg decision-tree walker (the existing `decision-tree/` component, refocused).
- Per-leg context box (special circumstances narrative for this leg).
- Per-leg evidence collection.
- Two terminal actions: **Mark Ready** or **Drop from Dispute** (with reason picker).
- Per-leg hold action (with typed reason).
- **Removed:** independent Generate Submission Preview CTA. Removed: independent closure dialog. Removed: independent group-level lifecycle controls. All of those move to the parent invoice.
- Post-response: per-leg verdict picker (AI-suggested + operator-confirmed). Per-leg MAS cancel checkbox if applicable.
- Post-MAS: read-only attestation status (links into #165's queue).

### Invoice Group Detail page (`invoice-group-detail.tsx`)

**Becomes the macro workflow surface — the operator's primary "do the dispute" page.**

- Header: macro phase + group-level verdict actions when relevant.
- Aggregate context box (group-level special circumstances, in Pre-submit only).
- **Legs Queue** *(new)* — list of disputed legs with per-leg sub-status pill on each. Click expands or navigates to the per-leg investigation. Operator works the queue.
- "Generate Submission Preview" CTA, gated on all legs being Ready or Dropped, with explicit disabled-state reason.
- Post-submission: response display, group-level verdict summary computed from per-leg confirmed verdicts.
- MAS Action checklist (per-leg cancels + group re-attest).
- Attestation status summary (links into #165's queue).
- Closure dialog (the only place closure happens, per #160).

### Responses Awaiting Review page (`responses-awaiting-review.tsx`)

**3-tab workspace for the verdict-to-payout pipeline.** From #164:

- **Tab 1: Verdict Pending** — already shipped. Per-leg verdict capture surface with AI suggestions (#180 expanded).
- **Tab 2: MAS Action** *(new)* — invoices with verdicts captured, MAS work outstanding. Per-leg cancel checklist + group re-attest checkbox.
- **Tab 3: Attestation** — already proposed as #186. The attestation queue from #165, embedded here for one-stop verdict-to-payout work.

### Attestation Queue page (`attestation-queue.tsx`)

Standalone page from #165 stays. Entry point for admins doing payment-cycle reconciliation. The page itself is unchanged in this transition; the only change is when rows arrive (after MAS re-attest completion, not after verdict capture).

### Dashboard page (`dashboard.tsx`)

Tile counts shift to reflect the new macro phases:

- Add "MAS Action Required" tile (count of groups in that phase).
- "Awaiting Attestation" tile from #165 stays but its denominator changes (only counts post-MAS, not post-verdict).
- "Resolved" tile only graduates groups once attestation is fully done (already true after #165).

### Withdrawals page (`withdrawals.tsx`)

The group-level closure surfaces (`denied_by_payor`, plus the operator-initiated `cannot_dispute` and `non_issue` paths). After this transition, the per-leg drop-from-dispute action is **not** a closure — it's a per-leg state inside Pre-submit. So withdrawals stays group-only, but the page should make clear that per-leg drops are visible elsewhere (linked from the group detail).

### Sidebar / Layout (`layout.tsx`)

Nav badges:

- Classification Inbox count (existing).
- Responses Awaiting Review count (existing, from #164).
- MAS Action Required count *(new)*.
- Attestation pending + queued counts (existing, from #165).

Five badge types is the upper bound of what's tolerable; if it gets crowded, MAS Action could collapse into the Responses Awaiting Review count as a sub-pill.

### Portal Submissions page (`portal-submissions.tsx`)

The submission detail view should make clear which legs were `ready` at submission time (the snapshot frozen into `workflowHistory`). After the transition, `portal_submissions.invoice_group_id` is the canonical link; `claim_id` becomes vestigial.

---

## Workflow-by-workflow impact

### Classification

**Today:** Operator assigns `errorTypeId` to clean-imported rides one at a time on the Claims page or Queue.

**After:** Unchanged in mechanism. The leg moves from `needs_classification` to `investigating` (the first sub-status of the inner tier). Operator can classify multiple legs in the same invoice in one sitting.

### Per-leg investigation

**Today:** The "workflow" runs at the claim level — the workflow player walks the operator through SOP steps for that one claim, ending at "Generate Submission Preview" which produces a per-claim writeup.

**After:** The workflow player runs the inner tier — walks the SOP steps for one leg, ends at **Mark Ready** or **Drop from Dispute** (with reason). No writeup generation happens here. The operator can leave and come back; progress is persisted in `claims.workflow_progress` per leg. This is the "loop" that operators run for each disputed leg in an invoice.

### Writeup generation

**Today:** Two paths. Per-claim and per-group, with subtle drift between them.

**After:** One path. Group-level only. CTA on the invoice detail page, gated on all legs Ready/Dropped + #168's understanding-readback. Aggregates evidence and per-leg context across all `ready` legs, plus group-level context. Bot picks up the approved writeup and submits one ticket per invoice.

### Bot submission

**Today:** Bot picks up groups in `Portal Queued` status. After this transition, unchanged in contract — operator-driven generation gate moves the group into the queued state, bot picks it up. Bot still produces one submission per invoice.

### Response handling

**Today:** Group enters `Needs Review`, operator picks a single group-level outcome (Approved / Denied / Partial / etc.).

**After:** Group enters Response Pending (macro phase). AI classifier reads the response and writes per-leg suggested verdicts into each `claims.workflow_progress.legVerdict.suggested`. Operator opens the verdict picker, sees the AI suggestions per leg, confirms or overrides each one. Group outcome is computed from the confirmed set. Verdict capture is the gate to MAS Action Required.

### MAS action *(new workflow)*

Operator opens the MAS Action checklist on the group detail page (or from the MAS Action tab on the Responses Awaiting Review page). Per-leg cancel checkboxes + group re-attest checkbox. Operator does the work in MAS, comes back, marks each item complete with a note (and any reference numbers MAS produces). System records who/when. When all items are checked, group transitions to Awaiting Payout (or directly to Closed for all-denied).

### Attestation (payout reconciliation, #165)

**Today:** Auto-engages on Approved verdict. Admin queue for confirming "did the payor actually pay us."

**After:** Auto-engages only after MAS re-attest is marked complete. Admin queue otherwise unchanged. The "completed" terminal state graduates the group to Closed.

### Closure

**Today:** From #160, three-reason model (`cannot_dispute`, `non_issue`, `denied_by_payor`). Two paths into it (per-claim closure intake, group-level closure).

**After:** Only group-level closure. The per-claim closure dialog is removed. Per-leg `cannot_dispute` and `non_issue` are not closures — they are per-leg drop-from-dispute reasons inside Pre-submit. `denied_by_payor` is the only group-level closure path that doesn't come from a verdict-capture flow.

---

## What's already aligned

These tasks shipped before the design was fully articulated, but each was built with hooks pointing at the target state. Future contributors should treat them as load-bearing.

- **#160 (3-reason closure consolidation)** — the closure vocabulary already matches the per-leg drop reason vocabulary. Reuse, don't extend.
- **#163 (training deck rewrite)** — teaches the AI-hint + 3-reason-closure model. Will need a v2 update to teach the per-invoice + MAS Action model, but the foundation is right.
- **#168 (special circumstances + AI readback gate)** — already at the group level (where it belongs). The per-leg context box is additive, not a replacement.
- **#169 (lifecycle-phase consolidation, ResponseActionsCard, LIFECYCLE_TABS)** — created `lib/lifecycle-phase.ts` as the single source of truth for macro phases. The per-claim workflow player already short-circuits to compact summaries in the post-pre-submit phases — it's halfway to becoming a read-only mirror of the parent group's player.
- **#162 (Responses Awaiting Review card on Queue)** — has the gated `MARK_PAID_LANE_ENABLED` Resolution lane, which becomes the MAS Action lane.
- **#164 (Responses Awaiting Review page)** — tabs container with reserved slot for the Attestation tab. Becomes the 3-tab verdict-to-payout workspace.
- **#165 (attestation tracking)** — the mechanism is right; only the auto-trigger gate moves.

---

## What needs to be (re)scoped

### The architectural shift (the big task split)

Seven sub-tasks, sequenceable, each independently shippable:

1. **Schema migration + per-leg state machine + sub-status derivation.** Reshape `claims.workflow_progress`, simplify `invoice_groups.workflow_progress`, add the per-leg state machine module, derive `claims.status` from the new model.
2. **Per-leg investigation UI on claim-detail.** The inner-tier walker, with Mark Ready / Drop from Dispute / Block (Hold) terminal actions. Removes the per-claim Generate Submission Preview CTA, the per-claim closure dialog, the per-claim group-level lifecycle controls.
3. **Legs Queue + "Ready to Generate" indicator on invoice-group-detail and queue.** The macro workflow surface for an invoice. Group-level Generate Submission Preview gated on all-legs-resolved.
4. **Per-leg verdict picker with AI suggestions.** Absorbs #180 and #185. Lives in the Verdict Pending tab on Responses Awaiting Review, in the Queue card, and in the Invoice Group Detail post-response section.
5. **MAS Action Required phase + tracking UI.** New macro phase, per-leg cancel checklist, group re-attest checkbox, audit. Surfaces on Queue (lane), Responses Awaiting Review (tab), Invoice Group Detail (section).
6. **Refocus #165's attestation auto-trigger.** Gate on `group.reAttest.completedAt`, not just verdict=Approved. Small, isolated change.
7. **Deprecate the per-claim submission code path.** Remove the per-claim writeup generator, remove `portal_submissions.claim_id` writes (keep the column for backfill reads), tighten `routes/portal-submissions.ts` to require `invoiceGroupId`.

### Deconfliction with proposed-but-not-merged tasks

- **#180 (verdict picker)** → keep, scope to per-leg + AI-suggested. Lands as part of sub-task 4.
- **#184 (mark response paid offline)** → cancel as a separate task. Manual paid-mark is already covered by #165's self-confirm action; this becomes redundant once attestation auto-trigger is gated on MAS completion.
- **#185 (group-level post-response action)** → cancel. Subsumed by sub-task 4.
- **#186 (Attestation tab in Responses Awaiting Review)** → keep, becomes the third tab.
- **#187 (send-follow-up button in page header)** → keep, uncontroversial.
- **#172, #173, #177–#183** → review individually; most are uncontroversial training-deck or minor-UX work that doesn't conflict with the shift.

---

## Open questions

These are not blocking the design but are worth flagging for future iteration.

- **Does MAS expose any signal we can read** (email confirmation, scrapeable portal page, future API) for cancel and re-attest completion? If so, we can elevate the manual completion-tracking to detection-with-manual-fallback. Currently no.
- **Re-submission with additional evidence on a denied leg.** When the operator wants to add evidence and re-submit a leg that the payor questioned, instead of treating it as Denied. Today's path: drop the leg in MAS, accept the loss, move on. Eventual path: clone the original draft into a new pre-submit cycle for selected legs only, generate a delta writeup, link the resubmission to the original. Significant scope; deferred.
- **Per-leg payment cycle data ingestion.** Currently #165's "did the payor pay us" is operator-confirmed. If we can ingest per-leg payment data from the payment cycle, we can upgrade attestation to suggested-with-operator-override. Deferred until upstream data is available.
- **Bulk per-leg verdict capture** when payor responds with the same outcome on dozens of legs. Probably a "select all" affordance in the verdict picker. Add when first complaint surfaces.

---

## Appendix: vocabulary

- **Claim** — single ride/trip/leg of an invoice. The line item.
- **Invoice / Group** — a batch of claims that share an invoice number. The unit of dispute, the unit of submission, the unit of MAS attestation.
- **Disputed leg** — a claim with `errorTypeId` set, marked for inclusion in (or drop from) the group's dispute submission.
- **Clean leg** — a claim with no `errorTypeId`. Not part of any dispute, flows through the normal payment cycle.
- **Pre-submit drop** — operator concludes during investigation that a leg should not be in the dispute. Reasons: `cannot_dispute` (treated as a denial in MAS), `non_issue` (the original error flag was wrong, leg is clean).
- **Per-leg verdict** — outcome of a leg that was actually submitted in the dispute. AI-suggested from the response; operator-confirmed. Values: `Approved`, `Denied`, `Partial`. No dollar amounts.
- **MAS Action Required** — macro phase where the operator does the manual cancel + re-attest work in the secondary MAS portal.
- **Re-attestation** — the operator re-submits the modified invoice (original minus cancelled legs) to MAS so the remaining legs flow into the next payment cycle. Universal terminal action except for all-denied invoices.
- **Attestation** (in #165's sense) — admin reconciliation of "did the payor actually pay us" after the next payment cycle runs. Distinct from MAS re-attestation despite the name overlap. Worth being precise: MAS re-attestation is operator-driven and outside the system; #165 attestation is admin-driven and inside the system.
- **Awaiting Payout** — macro phase between MAS re-attest completion and final payout reconciliation. Where #165's attestation queue draws from.
- **Closed** — single terminal state. Either successfully reconciled (with whatever per-leg outcome combination) or all-denied terminal.
