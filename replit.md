# ClaimClear Project

## Overview
ClaimClear is a comprehensive NEMT (Non-Emergency Medical Transportation) rejected claims dispute tracker platform. Its main goal is to optimize the claims dispute process, minimize financial losses, and enhance operational efficiency for NEMT providers. It achieves this by enabling the import of rejected claims, guiding staff through decision-tree workflows for dispute resolution, and automating dispute submissions to the MAS Transportation Provider Support Portal. The project aims to significantly reduce the administrative burden associated with claim disputes and improve recovery rates for NEMT services.

## User Preferences
I want to emphasize iterative development and prefer detailed explanations when new features are introduced or significant changes are made. I appreciate clear, concise communication and enjoy seeing functional programming paradigms where they enhance code readability and maintainability. Please ask before making any major architectural changes or introducing new external dependencies.

## System Architecture
The project is structured as a pnpm workspace monorepo utilizing TypeScript, designed for scalability and maintainability.

**Technology Stack:**
-   **Monorepo:** pnpm workspaces
-   **Backend:** Node.js 24, Express 5, PostgreSQL, Drizzle ORM, Zod
-   **Frontend:** React, Vite, Tailwind CSS, shadcn/ui
-   **Authentication:** Replit Auth (OpenID Connect with PKCE)
-   **AI:** Anthropic Claude
-   **Bot Automation:** Playwright
-   **API Codegen:** Orval

**Core Architectural Decisions:**
- **Monorepo Structure:** Uses TypeScript composite projects and pnpm workspaces for type safety and dependency management.
- **UI/UX Design:** Adheres to an Agape brand color scheme (dark navy, blue, orange, gold) with a distinct logo, and utilizes densified detail surfaces for improved information display.
- **Centralized Error Handling:** Robust error handling for async Express routes to prevent information leakage.
- **Database Design:** PostgreSQL with Drizzle ORM, featuring 16 entities for comprehensive claim and user management, and optimized with database indexes.
- **Authentication:** Session-based authentication supporting general users, admins, and bot tokens.
- **Frontend Serving:** React + Vite frontend served as static files by the Express API server from a single port.
- **Claim Workflow & Statuses:** Claims progress through predefined statuses with centralized transition functions to ensure consistent audit logging, timeline notes, and real-time SSE events. A dedicated "Non-Issue" outcome handles claims requiring classification.
- **Invoice Grouping:** Claims are grouped by invoice number, forming the primary unit for dispute resolution, with group-level statuses, outcomes, and evidence tracking.
- **Response Tracking & Classification:** Tracks incoming responses, auto-matching them to claims using a tiered approach. A classifier pipeline uses phrase-signature matching, falling back to Anthropic Claude for AI-powered classification.
- **Per-Leg/Per-Invoice State Machine:** Uses discrete, typed columns for managing `claims` and `invoice_groups` state, with leg sub-status always derived.
- **Included-in-Dispute Management:** Explicit transitions and importer defaults manage `claims.included_in_dispute`, allowing for clear exclusion/inclusion of legs from disputes.
- **Per-Leg investigation UI:** Dedicated UI for detailed per-leg investigation, including SOP-advance player, context editor, and hold/reclassify actions.
- **Portal Submission Readiness Gates:** Enforces ordered readiness gates for operator-initiated submissions, with a system/bot actor path bypassing some gates.
- **Per-Leg Hold (Partial Submissions):** Allows individual legs within a multi-claim invoice group to be put on hold, enabling partial submissions.
- **Post-Response Workflow:** Claims enter a "Needs Review" state after a payor response, prompting staff to choose actions.
- **Decision Trees (SOP Logic):** Integrated workflow system for SOP logic, evidence collection, branching, and dispute reasons, with an "SOP-Hold Escape Hatch" to clear holds and resume workflows.
- **Error Type Model:** Simplified model for error types, including a "Submission Path" picker to determine the dispute submission method.
- **Evidence Management:** Supports object storage for evidence files, linked to decision tree nodes and collected for portal submissions.
- **Real-time Updates:** Server-Sent Events (SSE) provide real-time updates and collision detection.
- **API Security:** Role-based authentication middleware protects API routes.
- **Cron Jobs:** Scheduled jobs for processing portal submissions, daily briefs, and payor response scanning.
- **Portal Worker (on-demand):** In-process Playwright bot for MAS Portal interaction, launching a fresh browser for each invocation.
- **System Health Rollup:** Provides a consolidated view of system health, including connector probes, cron freshness, worker status, and overdue submissions.
- **Header Batch Status Pill:** Persistent UI element displaying live queued-claim count, next batch countdown, and in-flight indicators.
- **Summary Analytics Page:** Provides time-range-aware analytics, including activity trends, recovery trends, team productivity, and breakdowns by status/outcome/error types.
- **Repeat Offenders Aggregation:** Aggregates rejection statistics per driver/member, excluding "Non-Issue" outcomes.
- **Schema Drift Guard:** Automated script to prevent silent divergence between Drizzle schema files and generated SQL migrations.
- **Deploy-time DB Migrations:** Explicit, idempotent SQL migration runner (`lib/db/scripts/apply-migrations.mjs`) wired into `.replit`'s `[deployment.build]` pre-build hook so it runs **once per publish attempt, before any artifact-specific build**, in its own clearly-labelled build-log step. Migrations are intentionally **not** chained inside `api-server`'s `production.build` (where they used to live) so a single failed publish only ever advances the schema once and the migration step is greppable in the build log. Note: a failed publish can still leave prod with a forward schema if the migration succeeds but a later step fails — that's the same risk the previous setup had; the change just stops it from being hidden inside the api-server chain. See Task #340.
- **On-Clock Status Tiers (Task #352):** Two reconciled tiers avoid badge contradictions across dashboard/queue/claim surfaces. (1) **Pre-submit urgent** (`GROUP_EXPIRING_ACTIONABLE_STATUSES` = New, Needs Evidence, On Hold, Generating Email; claim-level adds Portal Queued + Processed) — drives `isUrgent`, red "Today" badge, Dashboard "File today" hero, Queue hero count. (2) **Submitted-but-unconfirmed** (`GROUP_SUBMITTED_STUCK_STATUSES` = Portal Queued; `CLAIM_SUBMITTED_STUCK_STATUSES` = Portal Queued + Processed) — drives `submittedStuck`, amber "Stuck" badge, Dashboard "Stuck after submission" hero, Queue `?expiring=stuck` filter. At the **group level** the two sets are disjoint (Portal Queued is pre-submit for claims but post-submit for groups). At the **claim level** submittedStuck is a strict subset of isUrgent. All surfaces use the same date math (effectiveDaysRemaining ≤ 0 = deadline slipped). The backend exports `GROUP_SUBMITTED_STUCK_STATUSES`, `CLAIM_SUBMITTED_STUCK_STATUSES` from `routes/dashboard.ts` and uses them in `lib/expiring-filter.ts` (`ExpiringMode = "soon" | "urgent" | "stuck"`), `routes/invoice-groups.ts`, and `routes/claims.ts`. The dashboard summary exposes `submittedStuckCount` and `submittedStuckGroups` alongside `urgentCount` and `expiringGroups`.
- **Production Build Topology:** Only `artifacts/api-server` is registered in `.replit`'s `[[artifacts]]` list (autoscale deployable). `api-server`'s `production.build` chains `claimclear`'s Vite build because `app.ts:71-80` statically serves both `claimclear/dist/public` (root + SPA catch-all) and `training-guide/dist/public` (mounted at `/training-guide`) at runtime — `api-server`'s own esbuild (`build.mjs`) only bundles the API. The chain also installs Playwright (required at runtime by `bot/batch-worker.ts` / `bot/save-session.ts` for MAS portal automation). `mockup-sandbox` is the Canvas / dev preview server and is intentionally **not** registered in `.replit`'s `[[artifacts]]` list — it has no production role. (`training-guide`'s static dist is currently expected to be present at runtime; if it is not auto-built by the deployer, add it to api-server's build chain or register it as its own deployable — Task #340 deferred this confirmation pending the next publish log.)
- **In-App Guided Tour (admin):** React-Joyride v3 driven product tour for the ClaimClear admin app. Steps are declared in `artifacts/claimclear/src/tour/tour-config.ts` (with a `CURRENT_TOUR_VERSION` string and per-step `target` CSS selectors / `route`); `AdminTourProvider` wraps the `AppLayout` in `App.tsx` and handles cross-page navigation (it pauses the run, calls `setLocation` via wouter, polls for the target el, then resumes). Auto-trigger logic: per-user server-side flag `users.tour_version_seen` (added in migration `0026_tour_version_seen.sql`) exposed via `GET/PATCH /api/auth/user/tour-state` (handlers in `artifacts/api-server/src/routes/auth.ts`, schema in `lib/api-spec/openapi.yaml`); when the stored version is missing or != `CURRENT_TOUR_VERSION` the tour starts automatically on first sign-in, and `finish()` PATCHes the new version. Replay anytime via the header **"Take the tour"** button (`data-tour="header-take-tour"` in `components/layout.tsx`). Bumping `CURRENT_TOUR_VERSION` re-runs the tour for every user once. Targets are wired with `data-tour="…"` attributes (sidebar, page-main, dashboard-kpis, dashboard-today, queue, responses-awaiting-review, attestation-queue). The previous standalone `artifacts/admin-walkthrough/` video artifact has been retired.
- **Communication Components:** Integrated email thread components for group and leg detail pages, including rich HTML rendering, metadata, and Tiptap-powered rich text reply composer.
- **Bot Service Token Storage:** `BOT_SERVICE_TOKEN` (the shared secret used by api-server's `requireBotToken` / `requireAuthOrBot` middlewares to authenticate internal bot/cron callers, e.g. `bot/batch-worker.ts` and `bot/cron-payor-response-scan.ts`) **must live in Replit Secrets, never in `.replit`'s `[userenv.*]` blocks**. Storing it in `.replit` puts it in source control / git history, which is how the original token leaked (Task #342). For zero-downtime rotation, set the new value as `BOT_SERVICE_TOKEN` and (optionally) keep the prior value in `BOT_SERVICE_TOKEN_PREVIOUS` — `lib/bot-token.ts:getValidTokens()` accepts both during a rollover window. To rotate: generate a new 32-byte hex token, set `BOT_SERVICE_TOKEN_PREVIOUS = <old>` and `BOT_SERVICE_TOKEN = <new>` as Secrets, redeploy, then once all bot callers are on the new value, delete `BOT_SERVICE_TOKEN_PREVIOUS`. Any token ever committed to `.replit` should be considered permanently compromised regardless of subsequent removal.

## External Dependencies
- **PostgreSQL:** Primary relational database.
- **Anthropic Claude:** AI for SOP analysis, dispute note generation, and email generation.
- **Playwright:** Browser automation for interacting with the MAS Transportation Provider Support Portal.
- **Google Cloud Storage (GCS):** Object storage for evidence files.
- **Microsoft Outlook (Graph API):** For sending daily brief emails and tracking payor responses (with SMTP fallback).
- **Replit Auth:** OpenID Connect for user authentication.
