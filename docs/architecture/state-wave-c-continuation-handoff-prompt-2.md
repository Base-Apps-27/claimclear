# Wave C continuation #2 — picking up after the response-tracker switch

This is the SECOND continuation of Wave C (Task #517). It supersedes the
"next steps" half of `state-wave-c-continuation-handoff-prompt.md` —
that file's spec / design rationale is still authoritative; only the
"what to do next" pointer has moved here.

## What ships in this slice (already merged on `main`)

All edits are reader-only. No schema change. The legacy writers + the
0034/0035 trigger keep `status` / `outcome` / `disposition` / `phase`
in sync, so every switched read returns the same answer the legacy
read would have, just sourced from the canonical column.

| File | Switch |
| --- | --- |
| `lib/expiring-filter.ts` | Group-level actionable / stuck predicates → phase + Portal-Queued residual |
| `lib/urgent-snapshot.ts` | Urgent group set → same phase predicate (drops `GROUP_EXPIRING_ACTIONABLE_STATUSES` import) |
| `routes/dashboard.ts` | `expiringStatusFilter` (line 412) + `stuckStatusFilter` (line 467) → phase predicates |
| `routes/response-tracker.ts` | `isClaimResolved` → `disposition ∈ verdict_* ∪ final_* ∪ duplicate`; `isGroupResolved` → `isPhaseAtLeast(group.phase, "reviewed")` (drift bugs #12 + #13) |
| `routes/daily-brief.ts` (line 354) | Comment-only — claim-level filter intentionally kept on status (see §3.B residual rationale below) |
| `lib/day-complete.ts` | Comment-only — overlapping in-flight + actionable sets need Wave D writer rewire (see §3.C below) |
| `__tests__/email-thread-conversation.test.ts` | Local `createSeedClaim` now derives `disposition` from `(status, outcome)` so the new reader sees a consistent fixture |

Validated:
- `pnpm --filter @workspace/api-server typecheck` — clean
- `dashboard-expiring` 45/45, `urgent-today-transitions` 17/17
- `email-thread-conversation` 22/22, `group-email-thread` 6/6, `email-thread-html-body` 7/7
- 3 pre-existing TZ flakes in `parity` tests are unchanged (must-file-today + 2× list-count-past-deadline). Confirmed by re-running the HEAD baseline before any edits.

## What's still open

### T005 — remaining backend reads

These are NOT yet switched. Each is a clean follow-up; none are blocking.

1. **`lib/group-packaging.ts`** — heavy `sopOutcome` reads (lines 39-231). The phase/disposition equivalent is `claim.disposition` for the per-leg readiness checks (`disposed_*` for terminal-triage legs, `disposed_withdraw` / `disposed_nonissue` for the dispute-vs-exclusion split). Requires care: `DISPUTE_OUTCOMES` and `EXCLUSION_OUTCOMES` are `sopOutcome` value sets — translate via the existing per-leg-state mapping in `lib/leg-state/src/per-leg-sub-status.ts`.
2. **`lib/group-readiness.ts`, `lib/system-health-rollup.ts`, `lib/stuck-submissions.ts`, `lib/email-thread.ts`** — confirmed to contain `status`/`outcome`/`sopOutcome` references; haven't been audited line-by-line yet. Run `rg -n "claimsTable\.status|invoiceGroupsTable\.status|claimsTable\.outcome|invoiceGroupsTable\.outcome|sopOutcome" <file>` first to scope.
3. **`routes/search.ts` (lines 57, 88, 187, 211, 220, 231)** — these are RESPONSE-SHAPE selects, not predicates. Per the original handoff "switch only phase-membership predicates, not response-shape aggregates", these can stay until Wave D's API-spec rewire OR be supplemented (add `phase` / `disposition` to the response shape) without removing the legacy fields.
4. **`routes/system-health.ts` + `routes/batch-jobs.ts`** — every `status` reference is on `portalSubmissionsTable`, NOT `claimsTable` / `invoiceGroupsTable`. This is the submission row's own state column, NOT a Wave C target. Skip.
5. **JS-side per-row decoration Sets in `routes/invoice-groups.ts` (lines 59, 81; used at 520, 536) and `routes/claims.ts` (lines 42, 50; used at 374, 390)** — leave as status-based per the original handoff: response-shape aggregates, not predicates.

### T006 — frontend reads

Not started. The original handoff §6.D enumerated the affected screens
(dashboard expiring widget, queue filters, claim detail badges). The
frontend should consume the canonical phase/disposition fields once the
API-spec rewire (T008) lands; doing it before that means duplicating the
status→phase map in TypeScript.

### T008 — slides / docs rewrite, T010 — gauntlet, T011 — docs

Untouched. These depend on T005 + T006 being substantively done.

## Why some legacy reads are intentionally kept

### §3.B (recap from continuation #1) — claim-level expiring filter

`routes/daily-brief.ts:354` keeps `eq(claimsTable.status, ...)` because
claims do not have their own `phase` column (phase lives on the parent
invoice group), and `claims.disposition` does not by itself encode
whether the parent has been submitted (a `disposed_portal` claim can
sit under either a pre-submit `ready_to_submit` group or a `submitted`
group). The status set IS the per-claim mirror of "parent phase ∈
{triage, ready_to_submit}". Switching to a disposition + parent-phase
JOIN here adds a hot-path subquery without changing semantics. **Wave D
will introduce a `submitted_via` (or equivalent) claim column so this
becomes a single-column read.**

### §3.C (new) — day-complete matcher overlapping sets

`lib/day-complete.ts:107-141`'s in-flight + concluded sets overlap with
the actionable set in non-trivial ways. `Generating Email` lives in
BOTH (it's "in-flight" from this matcher's POV because the operator
clicked "package", but it's also "still on the filing clock" from the
dashboard's POV). The clean phase translation is therefore NOT a
single phase membership check; it would need to encode the same
operator-intent residual (`status IN ('Portal Queued','Generating
Email','Awaiting Response')`) as a `phase + status` predicate. Since
this matcher is a low-traffic admin probe and the writer trigger keeps
`status`/`outcome` synced with `phase`, leaving the legacy reads in
place pending Wave D's writer rewire is the safer call.

## Operating instructions for the next session

1. **Pick up at T005 step 1** above (`lib/group-packaging.ts`). It's
   the largest remaining backend file and the highest-value because
   `sopOutcome` is one of the four legacy columns Wave C is supposed
   to phase out.
2. **Run tests individually**, not the full suite — full run is >2 min:
   ```
   cd artifacts/api-server && TZ=America/New_York \
     pnpm exec node --test --import tsx src/__tests__/<file>
   ```
3. **Fixtures pattern**: when a test fails because the new reader sees
   a default disposition the legacy reader didn't, extend the test's
   local `createSeedClaim` helper to derive `disposition` from
   `(status, outcome)` (see the worked example in
   `email-thread-conversation.test.ts:109-156`). The trigger
   `validate_disposition_against_phase` is permissive when
   `invoice_group_id IS NULL`, so any valid enum value is accepted on
   parent-less fixtures.
4. **DO NOT use git stash** — it's destructive and behind the sandbox
   wall. To baseline a file before editing, use:
   ```
   git --no-optional-locks show HEAD:<path> > /tmp/baseline.ts
   ```
5. Keep the user's directive in mind: **"Ship it correctly, not fast."**
   Partial-but-correct is the goal. If a switch needs a fixture
   migration or a JOIN that changes hot-path latency, leave a Wave D
   comment and move on.
