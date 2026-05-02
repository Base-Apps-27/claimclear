# ClaimClear Project

## Overview
ClaimClear is a full NEMT (Non-Emergency Medical Transportation) rejected claims dispute tracker platform. Its primary purpose is to streamline the claims dispute process, reduce financial losses, and improve operational efficiency for NEMT providers. Key capabilities include importing rejected claims, guiding staff through decision-tree workflows for dispute resolution, and automating dispute submissions to the MAS Transportation Provider Support Portal.

## User Preferences
I want to emphasize iterative development and prefer detailed explanations when new features are introduced or significant changes are made. I appreciate clear, concise communication and enjoy seeing functional programming paradigms where they enhance code readability and maintainability. Please ask before making any major architectural changes or introducing new external dependencies.

## System Architecture
The project is structured as a pnpm workspace monorepo utilizing TypeScript.

**Technology Stack:**
- **Monorepo:** pnpm workspaces
- **Backend:** Node.js 24, Express 5, PostgreSQL, Drizzle ORM, Zod
- **Frontend:** React, Vite, Tailwind CSS, shadcn/ui
- **Authentication:** Replit Auth (OpenID Connect with PKCE)
- **AI:** Anthropic Claude
- **Bot Automation:** Playwright
- **API Codegen:** Orval

**Core Architectural Decisions:**
- **Monorepo Structure:** Uses TypeScript composite projects and pnpm workspaces for type safety and dependency management.
- **UI/UX Design:** Adheres to an Agape brand color scheme (dark navy, blue, orange, gold) with a distinct logo, and utilizes densified detail surfaces for improved information display.
- **Centralized Error Handling:** Robust error handling for async Express routes to prevent information leakage.
- **Database Design:** PostgreSQL with Drizzle ORM, featuring 16 entities for comprehensive claim and user management, and optimized with database indexes.
- **Authentication:** Session-based authentication supporting general users, admins, and bot tokens.
- **Frontend Serving:** React + Vite frontend served as static files by the Express API server from a single port.
- **Claim Workflow & Statuses:** Claims progress through predefined statuses (e.g., New, Needs Review, Resolved, Denied) with centralized transition functions to ensure consistent audit logging, timeline notes, and real-time SSE events. A dedicated "Non-Issue" outcome handles claims requiring classification.
- **Invoice Grouping:** Claims are grouped by invoice number, forming the primary unit for dispute resolution, with group-level statuses, outcomes, and evidence tracking.
- **Response Tracking & Classification:** `portal_responses` tracks incoming responses, auto-matching them to claims using a tiered approach. A classifier pipeline uses phrase-signature matching as a primary method, falling back to Anthropic Claude for AI-powered classification when phrases abstain. Acknowledgments are separated from actionable responses.
- **Per-Leg/Per-Invoice State Machine:** Replaced legacy workflow blobs with discrete, typed columns for managing `claims` and `invoice_groups` state. Leg sub-status is always derived, not stored, ensuring consistent state representation.
- **Included-in-Dispute Management:** Explicit transitions and importer defaults manage `claims.included_in_dispute`, allowing for clear exclusion/inclusion of legs from disputes.
- **Per-Leg Investigation UI:** Dedicated UI for detailed per-leg investigation, including SOP-advance player, context editor, and hold/reclassify actions.
- **Portal Submission Readiness Gates:** Enforces ordered readiness gates (phase, readback, preview, legs) for operator-initiated submissions, with a system/bot actor path bypassing some gates.
- **Per-Leg Hold (Partial Submissions):** Allows individual legs within a multi-claim invoice group to be put on hold, enabling partial submissions.
- **Post-Response Workflow:** Claims enter a "Needs Review" state after a payor response, prompting staff to choose actions.
- **Sibling-Duplicate Sub-Status:** Allows marking a leg as a sibling duplicate within the same invoice group under specific conditions, affecting its sub-status derivation.
- **Decision Trees (SOP Logic):** Integrated workflow system for SOP logic, evidence collection, branching, and dispute reasons, with an "SOP-Hold Escape Hatch" to clear holds and resume workflows.
- **Error Type Model:** Simplified model for error types, including a "Submission Path" picker (MAS Portal - Other/GPS, or Direct Email) to determine the dispute submission method.
- **Evidence Management:** Supports object storage for evidence files, linked to decision tree nodes and collected for portal submissions.
- **Real-time Updates:** Server-Sent Events (SSE) provide real-time updates and collision detection.
- **API Security:** Role-based authentication middleware protects API routes.
- **Cron Jobs:** Scheduled jobs for processing portal submissions, daily briefs, and payor response scanning.
- **Portal Worker (on-demand):** In-process Playwright bot for MAS Portal interaction, launching a fresh browser for each invocation to process pending submissions.
- **System Health Rollup:** Provides a consolidated view of system health, including connector probes, cron freshness, worker status, and overdue submissions.
- **Header Batch Status Pill:** Persistent UI element displaying live queued-claim count, next batch countdown, and in-flight indicators.
- **Summary Analytics Page:** Provides time-range-aware analytics, including activity trends, recovery trends, team productivity, and breakdowns by status/outcome/error types.
- **Repeat Offenders Aggregation:** Aggregates rejection statistics per driver/member, excluding "Non-Issue" outcomes to focus on actual dispute-worthy claims.
- **Schema Drift Guard:** Automated script to prevent silent divergence between Drizzle schema files and generated SQL migrations.
- **Deploy-time DB Migrations:** Explicit, idempotent SQL migration runner applied before JS build in production, ensuring schema consistency.
- **Communication Components:** Integrated email thread components for group and leg detail pages, including rich HTML rendering, metadata, and Tiptap-powered rich text reply composer.

## External Dependencies
- **PostgreSQL:** Primary relational database.
- **Anthropic Claude:** AI for SOP analysis, dispute note generation, and email generation (via Replit AI Integrations proxy).
- **Playwright:** Browser automation for interacting with the MAS Transportation Provider Support Portal.
- **Google Cloud Storage (GCS):** Object storage for evidence files.
- **Microsoft Outlook (Graph API):** For sending daily brief emails and tracking payor responses (with SMTP fallback).
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

## Communication (Email Thread) Components

The invoice-group and leg detail pages now include graduated communication components:

- **`components/communication/group-communication-thread.tsx`** — Full email thread card for the group detail page. Renders message bodies as rich HTML (sanitized via DOMPurify with `prose prose-sm`), shows message metadata (sender, timestamps, attachments, leg mentions), and includes a Tiptap-powered rich text reply composer. Wired to real data via `useGetInvoiceGroupEmailThread` + `mapToGroupConversations`; the v2 detail surfaces also pass `onSyncInbox` (calls `useCheckEmailResponses({ hoursBack: 24 })`).
- **`components/communication/response-received-banner.tsx`** — Amber "New response from [payor]" banner used on `responses-awaiting-review`. The v2 invoice-group detail inlines an equivalent banner inside its `.cc-scope` chrome.
- **`components/communication/rich-text-editor.tsx`** — Tiptap-based rich text editor with bold, italic, lists, blockquote, link, undo/redo toolbar. Used in the group thread reply composer.
- **Dependencies:** `@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/extension-link`, `@tiptap/extension-placeholder`, `@tiptap/pm` (installed in `@workspace/claimclear`). CSS for Tiptap placeholder and blockquote styles added to `index.css`.

## Densified detail surfaces (Task #263)

Both detail pages were re-densified 1:1 from the cohesion-sweep mockups in `artifacts/mockup-sandbox/src/components/mockups/cohesion-sweep/` (`LegDetailRedensified.tsx` and `GroupDetailRedensified.tsx`):

- **`.cc-scope` primitives** are defined in `artifacts/claimclear/src/index.css` (scoped — they don't bleed into the rest of the app). They expose pre-resolved colour aliases (`--cc-bg`, `--cc-fg`, `--cc-card`, `--cc-border`, `--cc-muted`, `--cc-purple-*`, `--cc-amber-*`, etc.) plus `.cc-card`, `.cc-btn`, `.cc-input`/`.cc-textarea`, `.mono` so the same JSX from the mockups works inside the real app unchanged.
- **`components/claim-detail-v2.tsx`** renders the leg-detail layout: breadcrumb → accent header → 8/4 grid with cards in this order — Per-leg context · Decision tree (SOP advance player) · Leg details · Evidence · Communication mentions (filtered from the parent group's email thread by `confNumber`) · Notes (real, via `useListClaimNotes`/`useCreateClaimNote`) · Audit timeline (real, via `useListClaimAuditLogs`) · Claim verdict · MAS action card · Hold/Reclassify/Exclude rail.
- **`components/invoice-group-detail-v2.tsx`** renders the group-detail layout: breadcrumb → accent header (with header-mounted "Ready to package" CTA) → response-received banner → KPI strip (Total exposure / In dispute / Excluded / Recovered / Days in queue, computed client-side from `detail.rides`) → 8/4 grid: Aggregate context · Group details + evidence (two-up) · Rides & legs table with **All / Disputed only** filter · Submission preview (mounts the existing `InvoiceGroupSubmissionGauntlet` for real submit/readback/preview behavior) · Communication thread (real `GroupCommunicationThread` with **Sync inbox** wired to `useCheckEmailResponses({ hoursBack: 24 })` and the existing **Draft from context** affordance inside the composer) · Payor responses & verdict; right rail: MAS reattest · Ready to package detail card · Notes (display-only from `detail.notes`) · Audit timeline (from `detail.auditLogs`) · Close this group (mounts `ClosureActions`).
- The shared subcomponents `GroupAggregateContextPanel`, `InvoiceGroupSubmissionGauntlet`, and `ResponseReceivedBanner` are still used by `pages/queue.tsx` (inline workspace) and `pages/responses-awaiting-review.tsx` — only the v2 detail pages were re-flowed; the inline workspace continues to render its existing chrome.
- The previous mock-only files `components/communication/mock-data.ts` and `components/communication/leg-communication-mentions.tsx` were removed; mentions are now derived from the real email thread inside `claim-detail-v2.tsx`.

## Troubleshooting the on-demand portal worker

- **Submissions sit in `pending` and never run.** First, remember `pending` is intentional now — rows wait for the next scheduled sweep or an admin batch click rather than firing immediately. If you expected something to have gone out, either click "Process Pending" / "Process Selected" on the Portal Submissions page, or wait for the next scheduled `portal_batch_sweeper` tick (8am / 11am / 2pm / 6pm ET, Mon–Fri). If a sweep ran and rows still didn't move, open System Health → Worker Activity and check the "Pending due" / "Overdue" tiles; if overdue is non-zero the rollup banner will say "degraded" — click into the Worker Activity card to see the last run's `lastError`, and confirm `portal_batch_sweeper` has fresh runs in the Scheduled Jobs table (most failures are Playwright login or Neon cold-start).
- **Manually kick a run.** Use Portal Submissions → "Process Pending" (the admin batch). Each kick is gated, so if a run is already in flight the new kick is coalesced. The progress card and "Queued" row badges are broadcast via SSE (`/api/portal-submissions/batch-events`), so every viewer of the page sees the same shared run, who triggered it, and which rows are locked. Other users get disabled action buttons with a "Batch already running by {user}" tooltip while the run is in flight.
- **Worker says "Last run failed".** Drill into the most recent batch from the Worker Activity card and inspect `lastError`. Common causes: portal session cookies expired (re-run `pnpm --filter @workspace/api-server run bot:save-session`), MAS portal returning 5xx, or a stuck submission row that the half-hourly `stuck_submission_reset` cron will clear automatically.
- **Stale Playwright session ("Session expired" / login redirect loop).** The saved storage state lives in `artifacts/api-server/bot-session/state.json`. If the worker keeps failing with auth-redirect or "session expired" errors after a token rotation or upstream MAS-portal session purge, delete (or rename) `artifacts/api-server/bot-session/state.json`, then re-run `pnpm --filter @workspace/api-server run bot:save-session` to capture a fresh login. Restart the API server so the in-process worker picks up the new state on its next run. This is the first thing to try whenever the auth-related `lastError` doesn't go away on its own.
- **Manual one-shot run from a shell.** `pnpm --filter @workspace/api-server run bot:run` triggers a single in-process worker run via `triggerWorkerRun` (same code path as the cron) and exits with the job result. Useful for local troubleshooting without waiting for the next sweep tick.
- **No worker runs since boot.** Expected after a fresh restart — the worker no longer fires on row-level events. The next `portal_batch_sweeper` tick (8am / 11am / 2pm / 6pm ET, Mon–Fri) will pick up anything pending; admins can also click "Process Pending" on the Portal Submissions page to trigger a run immediately.

## "File today" hardening (Task #298)

The dashboard "File today" hero and the Queue urgency hero used to disagree on busy days because the `daysRemaining` math was being done against a UTC `Date`. The deployment container runs UTC, which meant Saturday 02:00 UTC (still Friday 22:00 ET) would already roll over the office calendar by a day, off-by-one'ing every `isUrgentDeadline` check.

The fix:

- **`artifacts/api-server/src/lib/dates.ts`** — every helper (`daysRemaining`, `effectiveDaysRemaining`, `isUrgentDeadline`, `serverTodayKey`, `shiftDeadlineForOfficeClosure`, `nextBusinessDay`) is now ET-anchored. Each accepts an optional `tz` arg defaulting to `America/New_York` and does YYYY-MM-DD calendar arithmetic via `Intl.DateTimeFormat`. Coverage in `__tests__/dates-timezone.test.ts` (UTC-Sat=ET-Fri, EST/EDT, spring-forward, fall-back).
- **TZ pinned to `America/New_York`** in `artifacts/api-server/.replit-artifact/artifact.toml` for both `services.development.env` and `services.production.run.env`. Also exported in the api-server `test` script so existing tests are deterministic.
- **`artifacts/api-server/src/lib/urgent-snapshot.ts`** — single source of truth for "is this group urgent right now?": `computeUrgentSnapshot()` returns `{ urgentCount, totalActionable, byStatus, urgentGroupIds, todayKey }`. `snapshotUrgentCounts()` writes a `dashboard_urgent_snapshot` row to `state_events` with that metadata. The `URGENT_SNAPSHOT` cron entry (`0 8-20 * * *` ET) is registered in `lib/cron-schedule.ts` and fires before each `DAILY_BRIEF` and `PORTAL_BATCH_SWEEPER` run so the sparkline always has fresh data points around operator activity.
- **`GET /dashboard/urgent-today/transitions`** in `routes/dashboard.ts` returns: `currentlyUrgent` (from the snapshot), `clearedToday` (audit_logs `group_status_changed` rows from the ET day where `from` was actionable, `to` left the actionable set, AND the parent group's earliest service date made it deadline-urgent today — a re-categorisation like New→Needs Evidence does NOT count, and an early-submit on a not-yet-urgent group does NOT count either), `clearedSummary { total, byToStatus, actors }`, `snapshots` (today's `dashboard_urgent_snapshot` rows for the inline sparkline), and `wasUrgentToday`/`maxUrgentToday` (UI suppression guards so the Why-line vanishes on calm days). Each cleared row carries `clientNumber` (payor), `source` (operator/bot/auto-after-classify from audit metadata), `reason`, and a pre-formatted `timestampET`. The ET-day window uses `etMidnightUtcInstant(addDaysToYMD(todayKey, 1))` for the upper bound so DST days remain 23h or 25h instead of forced to 24h. Backend coverage in `__tests__/urgent-today-transitions.test.ts` (deadline-filter, payload shape, DST 23h/24h/25h).
- **`artifacts/claimclear/src/lib/urgent-today-why.ts`** — pure `deriveUrgentTodayWhy(input)` state machine that decides the Why-line copy. Hides the line entirely when `wasUrgentToday=false` (so calm days render nothing instead of "quiet day…"). Covered by `urgent-today-why.test.ts`, including Dashboard ↔ Queue parity (same input ⇒ same copy across all 3 hero tones).
- **`artifacts/claimclear/src/components/urgent-today-why.tsx`** — exports `UrgentTodayWhyLine` (the inline "Why? 4 cleared today by Avery, Tom" line + 60×16 SVG sparkline rendered via shadcn `Sheet` trigger; uses `deriveUrgentTodayWhy` for copy) and `UrgentTodayActivityPanel` (the Sheet body listing currently-urgent groups; today-cleared rows surface invoice + payor + source badge + ET timestamp + actor + optional reason quote). Mounted on both heroes — Dashboard via a new `headerExtra` slot on `HeroCard`, Queue inside each `QueueUrgencyHero` tone branch (red, amber, green). Both heroes call the same hook (`useGetDashboardUrgentTodayTransitions` from the regenerated `@workspace/api-client-react`) so they cannot drift.
