# ClaimClear Project

## Overview
ClaimClear is a full NEMT (Non-Emergency Medical Transportation) rejected claims dispute tracker platform. Its primary purpose is to streamline the claims dispute process, reduce financial losses, and improve operational efficiency for NEMT providers by importing rejected claims, guiding staff through decision-tree workflows for dispute resolution, and automating dispute submissions to the MAS Transportation Provider Support Portal.

## User Preferences
I want to emphasize iterative development and prefer detailed explanations when new features are introduced or significant changes are made. I appreciate clear, concise communication and enjoy seeing functional programming paradigms where they enhance code readability and maintainability. Please ask before making any major architectural changes or introducing new external dependencies.

## System Architecture
The project is structured as a pnpm workspace monorepo utilizing TypeScript.

**Technology Stack:**
- **Monorepo:** pnpm workspaces
- **Backend:** Node.js 24, Express 5, PostgreSQL, Drizzle ORM, Zod
- **Frontend:** React, Vite, Tailwind CSS, shadcn/ui
- **Authentication:** Replit Auth (OpenID Connect with PKCE)
- **AI:** Anthropic Claude (via Replit AI Integrations proxy)
- **Bot Automation:** Playwright
- **API Codegen:** Orval
- **Build Tool:** esbuild

**Core Architectural Decisions:**
- **Error Handling:** Centralized error handling for async Express routes to log errors and prevent information leakage.
- **Authentication:** Session-based authentication with timeouts, managed via the database, supporting general users, admins, and bot tokens.
- **Frontend Serving:** React + Vite frontend served as static files by the Express API server from a single port (8080) for both development and production.
- **Database Design:** PostgreSQL database with Drizzle ORM, managing 16 entities including users, claims, invoice groups, and audit logs.
- **Invoice Groups:** Claims are grouped by invoice number, forming the primary unit for dispute resolution, with group-level statuses, outcomes, and evidence tracking.
- **Response Tracking:** `portal_responses` table tracks incoming responses (email/portal/manual), auto-matching them to claims via `lib/response-matcher.ts` (tiered matching: portal ticket ID → invoice/conf/ref number → payor email + identifier). Every matched email is also AI-classified by `lib/inbound-email-classifier.ts` (Claude Sonnet) which extracts a 1-2 sentence `aiSummary`, a refined `responseType`, the dollar `extractedAmount`, any `extractedDeadline`, and the `requestedAction` the payor is asking us to take — all persisted on the row alongside `classifierSource` ("ai" | "keyword" | "manual") and `classifierConfidence`. The classifier is best-effort: on failure the keyword detector takes over and `classifierSource` stays "keyword". **Acknowledgments are split off from real responses**: when `responseType === "acknowledgment"` (the AI's call when an email is just "we received your request — under review") the row is still stored and a "MAS acknowledged on … (proof of receipt — no action required)" timeline note is added, but the claim/group is **not** moved to Needs Review (the audit action becomes `response_acknowledged` instead of `response_received`). Every other type — approval / denial / partial_approval / info_request / other — still drives a Needs Review transition. The UI surfaces the AI summary as a headline above the raw body, with `requestedAction` / `extractedAmount` / `extractedDeadline` as inline labels, and shows "Receipt only — no action" + "AI summarized" badges so reviewers can tell at a glance which responses actually need work. Staff review is still required before claims are resolved or denied.
- **Claim Workflow & Statuses:** Claims progress through predefined statuses (e.g., New, Needs Review, Resolved, Denied) with a dedicated "Non-Issue" outcome for claims requiring classification (called "triage" in internal code — see Terminology note below). Outcomes include `Denied` (true payer denial after a recorded response) and `Withdrawn` (staff-initiated closure) — both carry a `closure_reason` field (`payer_denied`, `not_contestable`, `accepted_loss`, or `non_issue`) so the dashboard, daily brief, and audit trail can distinguish a payer denial from an internal decision to stop disputing.
- **Structured Closure Foundation (Task #130):** When a Withdrawn (`not_contestable`) or Non-Issue closure is filed, both `claims` and `invoice_groups` capture the full closure rationale via nullable `closure_category`, `closure_root_cause`, `closure_narrative`, `closure_accountability_tags` (jsonb), `closure_drivers`/`closure_dispatchers` (jsonb), `closure_communicated_to`, plus the review cycle columns `closure_review_state` (`pending`/`addressed`), `closure_addressed_*`, and `closure_review_notes`. `claim_evidence` carries `closure_scope` (`tree` vs `closure`) and `closure_reason_at_attach` so we can reconstruct exactly which evidence was on file at closure time. The canonical `CreateClosureRequest` zod validator in `artifacts/api-server/src/lib/closure-validation.ts` is shared by `PATCH /claims/{id}/outcome` and `PATCH /invoice-groups/{id}/outcome`; `outcome_changed`/`status_and_outcome_changed` audit metadata embed a `closure` sub-object via `closureAuditPayload(...)`. A dedicated `POST /claim-evidence/closure` endpoint persists evidence rows with the closure tags and writes a `closure_evidence_attached` audit log. `PATCH /claims/{id}` and `PATCH /invoice-groups/{id}` auto-advance a row from New / Needs Review → Needs Evidence whenever staff first sets `errorTypeId` (audit `source = "auto_after_classify"`).
- **Centralized Transitions:** All status and outcome changes for claims and invoice groups are processed through dedicated centralized functions (`claim-transitions.ts`, `group-transitions.ts`) to ensure audit logging, timeline notes, and real-time SSE events. Group closure (`Resolved`/`Denied`) is blocked by `ensureNoHeldLegsBeforeClosure` whenever any child leg is `On Hold`.
- **Per-Leg Hold (Partial Submissions):** A multi-claim invoice group can submit one leg while another sits on hold. The legs table on the group detail page exposes inline `Hold` / `Remove Hold` actions per row (reusing the same dialog as the single-claim page). Portal preview (`POST /portal-submissions/generate-preview`) skips legs that are `On Hold` or that already have an active submission for the same group; if any are skipped, the group is flagged `isPartial: true` and the UI shows a `Partial` badge plus a hint footer.
- **Post-Response Workflow:** After a payor response, claims enter a "Needs Review" state, requiring staff to choose actions like "Resolve," "Accept as Loss," or "Re-dispute."
- **Decision Trees:** Integrated workflow system for SOP logic, evidence collection, branching, and dispute reasons, with "hold" outcomes preserving tree state for later resumption.
- **Error Type Model:** Simplified model focusing on name, category, description, decision tree, and AI dispute instructions. Each error type also carries a **Submission Path** picker (admin-editable on the Error Types & SOPs page) — a single 3-way mutually-exclusive selector backed by two boolean columns (`useGpsControlDeviation`, `useDirectEmail`). The three paths: (1) **MAS Portal — Other Issue or Question** (default Freshdesk form), (2) **MAS Portal — GPS Control Deviation** (the only form with the GPS Breadcrumbs Available field), (3) **Direct Email** (bypasses the portal entirely; emails the dispute with attachments to the global recipient configured in Settings → Direct Email, e.g. `tripinvresolution@medanswering.com`). `determineIssueType` in `routes/portal-submissions.ts` reads both flags (email wins over GPS if both are set) and returns one of `"Direct Email" | "GPS Control Deviation" | "Other Issue or Question"`. The batch processor (`processViaExternalBot` in `lib/batch-processor.ts`) branches on `"Direct Email"` to call `sendDirectEmailDispute` (in `lib/direct-email-dispatch.ts`) instead of the Playwright worker; both paths share the same Portal Submissions queue, the same batch cron (8/11/2/6pm ET), the same AI-generated body (with email-style framing for the email path), and the same status transitions. For email submissions, the Outlook `messageId` is stored in `portalTicketId` so the existing UI surfaces a meaningful reference. The Portal Submissions row shows a small "Email" or "Portal" badge so the dispatch path is visible at a glance.
- **Evidence Management:** Supports object storage for evidence files, linked to decision tree nodes and collected for portal submissions.
- **Real-time Updates:** Server-Sent Events (SSE) provide real-time updates and collision detection for claims and presence.
- **API Security:** Role-based authentication middleware (`requireAuth`, `requireAdmin`, `requireBotToken`) protects API routes.
- **Database Indexes:** Key tables are indexed for optimal query performance.
- **Cron Jobs:** Scheduled jobs for processing portal submissions, sending daily briefs, and scanning for payor responses.
- **Portal Worker (on-demand):** Runs in-process inside the API server. Each invocation launches a fresh Playwright browser, processes pending submissions, and tears down. There is no continuous polling loop, no heartbeat, and no separate bot process to keep alive. Triggers: the `portal_batch_sweeper` cron (8am / 11am / 2pm / 6pm ET, Monday–Friday) and the admin "Process Pending" / "Process Selected" action on the Portal Submissions page. Submission transitions into `pending` (create / confirm / retry) intentionally do NOT auto-fire the worker — rows sit in `pending` until the next sweep or an admin batch click, so submissions go out in batches rather than one row at a time. A module-level gate (`triggerWorkerRun` / `isWorkerRunInProgress`) ensures only one run is in flight at a time so concurrent triggers coalesce. Fresh state per run — Playwright login on every invocation — eliminates the staleness bugs the old long-running bot suffered from.
- **System Health Rollup:** `/admin/system-health/rollup` combines connector probes, cron freshness (last run vs. last expected run), the most recent worker run status, and a count of pending submissions overdue beyond the 15-minute threshold into one `{overall, components, lastWorkerRun, overdueCount}` signal. The frontend `WorkerHealthBanner` reads this rollup and warns on the Command Center, System Health, and Portal Submissions pages whenever overall is `degraded` or `failed`.
- **Header Batch Status Pill:** Persistent pill on the right side of the app header (inside `AppLayout`, so auto-hidden on the auth/login screen) showing live queued-claim count, countdown to the next scheduled portal-submission batch, and an in-flight indicator when a batch is running. Backed by `GET /api/portal-submissions/queue-status` (auth-only, slim payload: `isRunning`, `nextBatchAt`, `prevBatchAt`, `queuedCount`, `runningCount`, `schedule[]`). Polls every 10s and subscribes to the existing `/api/portal-submissions/batch-events` SSE channel so batch lifecycle events (start / progress / complete / row status change) invalidate the query for instant updates. Pill states: idle (muted), queued+calm (blue), imminent ≤15min (amber + pulse), running (green + Zap), after-hours (muted with day prefix). Click opens a popover with today's batch schedule (8/11/2/6 ET, past firings struck through, "next" highlighted) and a quick link to the Portal Submissions page. Mobile collapses to count + icon.
- **Summary Analytics Page:** `/summary` shows a time-range-aware analytics view backed by two endpoints: `GET /dashboard/timeseries?days=N` (daily counts of claims created vs resolved/denied and dollars recovered) and `GET /dashboard/user-productivity?days=N` (per-user activity counts derived from `audit_logs.user_email` over the window). The page renders an Activity Trend area chart, a Recovery Trend bar chart (recharts), a Team Activity list with horizontal bars and per-user breakdowns (triaged / resolved / denied / drafts / submissions), and small mini-bar breakdowns for By Status / By Outcome / Top Error Types. A 7/30/90-day range selector at the top controls both new endpoints. Vendor pre-pay multiplier (~70%) is reused from the existing dashboard summary endpoint for the Total Exposure KPI.
- **Repeat Offenders Aggregation:** `aggregateRepeatOffenders` in `dashboard.ts` rolls up rejection stats per driver/member across EVERY claim in the window EXCEPT `outcome=Non-Issue`. This is the correct semantic for a claims-DISPUTE tool — every imported claim represents a payor rejection, so freshly-imported (Pending) claims, Withdrawn losses, and even Approved-after-dispute claims all count toward `rejectionCount`, `atRiskAmount`, `lastRejectionDate`, and `errorTypeCounts`. The win-rate calculation is independent: `winRate = approvedCount / (approvedCount + deniedCount)` where `approvedCount` includes "Partially Approved" — so a Partially Approved claim feeds both buckets (it was a rejection AND a partial dispute win). Only outcome=Non-Issue (the explicit "actually wasn't a rejection" escape hatch) is excluded from rejection rollups.
- **MAS Portal Integration:** Playwright bot interacts with the Freshdesk-based MAS portal, using specific form field IDs and leveraging authenticated sessions to bypass CAPTCHA.
- **UI/UX:** Adheres to an Agape brand color scheme (dark navy, blue, orange, gold) with a distinct logo.
- **TypeScript Monorepo:** Uses TypeScript composite projects and pnpm workspaces for type safety and dependency management.

## Terminology: "Classify" (UI) vs "Triage" (code)
The first stage of the claim workflow is shown to users as **"Classify"** — the action of deciding whether a Needs-Review claim/group is a real issue or a non-issue. Earlier copy called this "Triage" everywhere; the user-visible label was renamed to "Classify" / "Classification queue" / "Classification completed" across the live app, api-server audit reasons, mockups on the canvas, and the training-guide slide deck. **Internal code symbols intentionally still use the word `triage`** to avoid a churny refactor of stable APIs and persisted data: API routes (`POST /claims/:id/triage`, `POST /invoice-groups/:id/triage`), React hooks/handlers (`useTriageInvoiceGroup`, `handleTriage`, `triageGroup`, `triageAction`, `triageOutcome`, `triageNotes`, `triagedAt`), the audit event key `group_triaged`, the DB enum value `source: "triage"`, the stage object key `"triage"` in `CLAIM_STAGES`, the form mode `submit("triage")`, the dashboard `ACTION_BUCKETS` entry `"triaged"`, slide file names `TriageNonIssue.tsx` / `TriageIssueFound.tsx`, and Playwright `testId`s like `action-group-triage-non-issue` all stay as-is. When adding new code in this area, prefer "Classify" in any user-visible string and "triage" in code symbols. Existing audit-log rows in production written before the rename still read "Triaged as non-issue …"; new rows say "Classified as non-issue …" — both are valid historical records.

## Design decision in flight: claim lifecycle, payor responses, and the verdict model

A unified design has been agreed in principle but **not yet shipped**. The code today does NOT reflect it. This section is the single source of truth for the model and its consequences — any agent picking this up should read it end-to-end before touching response handling, closure reasons, or the Queue page.

### The mental model: two stages, two distinct decision sets

A claim has exactly two stages, and where it sits determines what verdicts can apply to it. Conflating these stages is the root cause of the current UI overload and backend bugs.

**Stage 1 — Front-end gate (before any dispute submission exists).** Three exclusive paths, decided by a human during classification:
- **Disputing** → we work it. (The default path; everything else here closes the claim out.)
- **Cannot Dispute** → closes out. No evidence, no path forward, we never tried.
- **Non-Issue** → closes out. Wasn't actually a billing error.

**Stage 2 — Back-end results (only reachable after a dispute submission exists).** Three possible payor outcomes, none of which the system may decide on its own:
- **Approved** (paid in full)
- **Partially Approved** (paid some)
- **Denied by Payor** (rejected)

`Cannot Dispute` and `Non-Issue` can only be set in Stage 1; `Denied by Payor` can only be set in Stage 2 with a recorded payor response on file. The transition rules in the API must enforce this.

### The verdict rule: every payor response is a hint, not a final state

In Stage 2, the human always picks the verdict. The system may *suggest* an outcome based on AI/keyword classification of the response email, but it must never auto-resolve, auto-deny, or otherwise decide on the operator's behalf. Even an apparent "approval" is a hint — at least one off-platform step is always required (re-attestation, payment confirmation, follow-up calls), so it must still land in front of a human. Acknowledgments (proof of receipt) are the only exception: they don't change status because no decision is owed.

### "Accepted Loss" doesn't exist as a closure reason

It's a *description* that applies to any claim ending in less than full approval — Partially Approved, Denied by Payor, and Cannot Dispute all qualify. Calling it out as its own closure reason was noise and is being removed. Task #156 just added "Accept as Loss" as a first-class trigger in the shared `<ClosureActions>` component; that addition needs to be reverted in line with this model.

The final closure-reason set is exactly three: `cannot_dispute`, `non_issue`, `denied_by_payor`. The six outcomes (Pending / Approved / Partially Approved / Denied / Withdrawn / Non-Issue) are unchanged; we're trimming reasons, not outcomes. `cannot_dispute` continues mapping to outcome `Withdrawn`; `denied_by_payor` maps to outcome `Denied`.

### What this means for the Queue page

Status `Needs Review` is currently overloaded because two unrelated workflow stages feed it:
1. **Stage 1 item not yet classified** (no `errorTypeId`) → operator action: classify it.
2. **Stage 2 substantive payor response received** → operator action: pick a verdict (continuation / resolution / closure).

These deserve separate surfaces because the operator's mental task is completely different in each case. As of commit `e0d51d3`, the **Classification Inbox** is now strictly Stage 1 items (filters to `!errorTypeId`). The Stage 2 items currently fall through the cracks (only findable from the detail page) and need their own surface.

**Agreed surface: a "Responses Awaiting Review" card sitting next to Classification Inbox.** Each row shows invoice#, urgency badges, response-type pill (Denial / Approval / Partial / Info Request / Other), AI summary if available, $amount, status. Click opens an inline panel with the response context plus three lanes of verdicts, organized by what they do to the workflow:

```
Response from <sender>, <when>     [AI hint pill: Denial / 87% conf]
─────────────────────────────────────────────
"<AI summary or first 2 lines of response body>"
[Open full response]
─────────────────────────────────────────────
What's the verdict?
  Continuation:    [Re-dispute]  [Re-attest]  [Submit new invoice]
  Resolution:      [Mark paid]
  Closure:         [Denied by Payor]
```

- **Continuation** reuses the existing `postResponseActions` returned by the API (`re_dispute`, `resolve_reattest`, `resolve_new_invoice`).
- **Resolution** is a new "Mark paid" path — see open question below.
- **Closure** on this surface offers only `Denied by Payor`, because `Cannot Dispute` and `Non-Issue` are Stage 1 decisions and can't legitimately fire here. This means the shared `<ClosureActions>` component needs to be aware of context (Stage 1 vs Stage 2) when rendering its triggers, or the response-review panel uses a thinner closure trigger that only exposes `Denied by Payor`. Either is fine — implementer's call when scoping the task.

### Backend changes required

1. **Fixed in Task #161.** `artifacts/api-server/src/routes/response-tracker.ts` no longer auto-transitions on manual tagging. All four `responseType` values (`approval`, `denial`, `partial_approval`, `info_request`) now map to `{ status: "Needs Review", outcome: "Pending" }`, and the chosen tag is recorded as a hint string in the audit log (action `response_tagged`, details `Response #N tagged as <type> — AI hint: <Hint>, awaiting human review`) and as a matching timeline note. The UI buttons now read **Tag as Approval / Tag as Denial / Mark Reviewed** with tooltips clarifying that tagging never decides the verdict, and the recommended-action banners on both the claim and invoice-group detail pages explain that the AI hint is a suggestion only — the human still picks the verdict from the action rail. The auto-email matcher (`artifacts/api-server/src/lib/response-matcher.ts`) already followed this rule and was not changed.

2. **Trim the closure-reason set.** In `lib/closure-options/src/index.ts`: remove `accepted_loss` from `ClosureReasonKey` and from `CLOSURE_REASON_BANNER`. Rename `not_contestable` → `cannot_dispute` for accuracy. Add `denied_by_payor` as the third reason. Final set: `cannot_dispute | non_issue | denied_by_payor`.

3. **Revert the "Accept as Loss" trigger in `<ClosureActions>`** (Task #156's addition).

4. **Tighten transition rules in the API.** `cannot_dispute` and `non_issue` may only be set when no dispute submission exists for the claim/group; `denied_by_payor` may only be set when there's a recorded payor response on file. Both `transitionClaimStatus` and `transitionGroupStatus` need to enforce this.

5. **Update DB enum / validation / UI labels / training-guide / intake dialog** to match the new reason set.

6. **Migrate existing rows.** Re-bucket any existing `accepted_loss` rows as `denied_by_payor` (since by the new definition they always followed a denial response).

### Open questions still on the table

- **First-class "Mark paid" action?** Does "Payer agreed and we got paid offline" need a dedicated button on the response-review panel that flips status to `Resolved` with outcome `Approved`? Or is manual status → Resolved good enough? The proposal above includes "Mark paid"; user has not yet confirmed.
- **Re-bucket confirmation.** Existing `accepted_loss` → `denied_by_payor` is the leaning, but user hasn't confirmed.
- **Outcome alignment confirmation.** `cannot_dispute` → `Withdrawn`, `denied_by_payor` → `Denied`. User leaning yes; not yet confirmed.

## Disputed-leg cascade and rollup (fixed Apr 30, 2026)

A bug let claim status drift away from invoice-group status mid-lifecycle, and let clean rides drag the group's stepper backwards. Mechanism:

- `syncChildRides` (`artifacts/api-server/src/lib/group-transitions.ts`) used to early-return for any non-terminal status, so a group going to "Portal Queued" / "Generating Email" / "Awaiting Response" / "Ready to Review" silently left disputed children frozen in their previous status. Header badges, top stepper, and right-pane "Step X of N" labels on the claim page all read from `claim.status` and showed stale data.
- `getGroupCurrentStageKey` (`artifacts/claimclear/src/pages/invoice-group-detail.tsx`) rolled up the earliest stage across **all** rides on the invoice. Clean rides (no `error_type_id`) sit at "triage" forever, so a single disputed leg pushed all the way through still showed the group at STEP 1 Classify.

Fix shipped:

1. **Cascade rule rewritten.** `syncChildRides` now cascades any non-On-Hold group transition down to **disputed legs only** (`error_type_id IS NOT NULL`). Held legs and clean legs are never touched. Per-child audit rows are written so each claim's timeline shows "Status changed from X to Y (cascaded from invoice group)".
2. **Rollup filtered.** `getGroupCurrentStageKey` and `buildGroupStages` now operate on disputed legs only, with a fallback to all rides for the pre-classification case (so we don't divide by zero when nothing's been classified yet). The rule "if any leg has an issue the entire invoice can't be submitted" is preserved — the slowest disputed leg defines the invoice's stage; clean legs are trivially done.
3. **Production backfill.** A one-shot block in `artifacts/api-server/src/index.ts` runs on prod boot only, scans for disputed legs whose status drifted from their group's status (in any of the system-controlled or terminal statuses), and re-syncs them with a backfill-tagged audit row. Idempotent — the next prod restart finds zero drift.

This was a single root cause masquerading as "we have two parallel solution paths" — there's only one write path; it just had a guard clause and a rollup function that were silently dropping work.

## External Dependencies
- **PostgreSQL:** Primary relational database.
- **Anthropic Claude:** AI for SOP analysis, dispute note generation, and email generation, accessed via Replit AI Integrations proxy.
- **Playwright:** Browser automation for interacting with the MAS Transportation Provider Support Portal.
- **Google Cloud Storage (GCS):** Object storage for evidence files.
- **Microsoft Outlook (Graph API):** For sending daily brief emails and tracking payor responses, with SMTP as a fallback.
- **Replit Auth:** OpenID Connect for user authentication.
## Rotating BOT_SERVICE_TOKEN

The bot service token authenticates internal `x-bot-token` calls from the manual `npm run bot:run` developer tool and from internal cron jobs that hit the API over HTTP. The on-demand portal worker runs in-process and does **not** use this token. Rotate safely with a grace window:

1. Generate a new random token (e.g. `openssl rand -hex 32`).
2. In Replit Secrets, set `BOT_SERVICE_TOKEN_PREVIOUS` to the **current** value of `BOT_SERVICE_TOKEN`, then set `BOT_SERVICE_TOKEN` to the **new** value.
3. Restart the API server workflow. The middleware reads both env vars per request, so any caller still using the old token continues to authenticate.
4. If you have any external callers (e.g. the manual `bot:run` developer tool, an external automation), restart them with the new token.
5. Once everything is on the new token, unset `BOT_SERVICE_TOKEN_PREVIOUS` in Replit Secrets and restart the API server one final time.

Notes:
- Never log or paste the raw token.
- The token comparison is constant-time (`crypto.timingSafeEqual`) to avoid timing leaks.

## Troubleshooting the on-demand portal worker

- **Submissions sit in `pending` and never run.** First, remember `pending` is intentional now — rows wait for the next scheduled sweep or an admin batch click rather than firing immediately. If you expected something to have gone out, either click "Process Pending" / "Process Selected" on the Portal Submissions page, or wait for the next scheduled `portal_batch_sweeper` tick (8am / 11am / 2pm / 6pm ET, Mon–Fri). If a sweep ran and rows still didn't move, open System Health → Worker Activity and check the "Pending due" / "Overdue" tiles; if overdue is non-zero the rollup banner will say "degraded" — click into the Worker Activity card to see the last run's `lastError`, and confirm `portal_batch_sweeper` has fresh runs in the Scheduled Jobs table (most failures are Playwright login or Neon cold-start).
- **Manually kick a run.** Use Portal Submissions → "Process Pending" (the admin batch). Each kick is gated, so if a run is already in flight the new kick is coalesced. The progress card and "Queued" row badges are broadcast via SSE (`/api/portal-submissions/batch-events`), so every viewer of the page sees the same shared run, who triggered it, and which rows are locked. Other users get disabled action buttons with a "Batch already running by {user}" tooltip while the run is in flight.
- **Worker says "Last run failed".** Drill into the most recent batch from the Worker Activity card and inspect `lastError`. Common causes: portal session cookies expired (re-run `pnpm --filter @workspace/api-server run bot:save-session`), MAS portal returning 5xx, or a stuck submission row that the half-hourly `stuck_submission_reset` cron will clear automatically.
- **Stale Playwright session ("Session expired" / login redirect loop).** The saved storage state lives in `artifacts/api-server/bot-session/state.json`. If the worker keeps failing with auth-redirect or "session expired" errors after a token rotation or upstream MAS-portal session purge, delete (or rename) `artifacts/api-server/bot-session/state.json`, then re-run `pnpm --filter @workspace/api-server run bot:save-session` to capture a fresh login. Restart the API server so the in-process worker picks up the new state on its next run. This is the first thing to try whenever the auth-related `lastError` doesn't go away on its own.
- **Manual one-shot run from a shell.** `pnpm --filter @workspace/api-server run bot:run` triggers a single in-process worker run via `triggerWorkerRun` (same code path as the cron) and exits with the job result. Useful for local troubleshooting without waiting for the next sweep tick.
- **No worker runs since boot.** Expected after a fresh restart — the worker no longer fires on row-level events. The next `portal_batch_sweeper` tick (8am / 11am / 2pm / 6pm ET, Mon–Fri) will pick up anything pending; admins can also click "Process Pending" on the Portal Submissions page to trigger a run immediately.
