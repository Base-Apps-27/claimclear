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
- **Response Tracking:** `portal_responses` table tracks incoming responses (email/portal/manual), auto-matching them to claims. Staff review is required before claims are resolved or denied.
- **Claim Workflow & Statuses:** Claims progress through predefined statuses (e.g., New, Needs Review, Resolved, Denied) with a dedicated "Non-Issue" outcome for claims requiring triage. Outcomes include `Denied` (true payer denial after a recorded response) and `Withdrawn` (staff-initiated closure) — both carry a `closure_reason` field (`payer_denied`, `not_contestable`, `accepted_loss`, or `non_issue`) so the dashboard, daily brief, and audit trail can distinguish a payer denial from an internal decision to stop disputing.
- **Centralized Transitions:** All status and outcome changes for claims and invoice groups are processed through dedicated centralized functions (`claim-transitions.ts`, `group-transitions.ts`) to ensure audit logging, timeline notes, and real-time SSE events.
- **Post-Response Workflow:** After a payor response, claims enter a "Needs Review" state, requiring staff to choose actions like "Resolve," "Accept as Loss," or "Re-dispute."
- **Decision Trees:** Integrated workflow system for SOP logic, evidence collection, branching, and dispute reasons, with "hold" outcomes preserving tree state for later resumption.
- **Error Type Model:** Simplified model focusing on name, category, description, decision tree, and AI dispute instructions.
- **Evidence Management:** Supports object storage for evidence files, linked to decision tree nodes and collected for portal submissions.
- **Real-time Updates:** Server-Sent Events (SSE) provide real-time updates and collision detection for claims and presence.
- **API Security:** Role-based authentication middleware (`requireAuth`, `requireAdmin`, `requireBotToken`) protects API routes.
- **Database Indexes:** Key tables are indexed for optimal query performance.
- **Cron Jobs:** Scheduled jobs for processing portal submissions, sending daily briefs, and scanning for payor responses.
- **Portal Worker (on-demand):** Runs in-process inside the API server. Each invocation launches a fresh Playwright browser, processes pending submissions, and tears down. There is no continuous polling loop, no heartbeat, and no separate bot process to keep alive. Triggers: midnight cron, retry sweeper cron (every 5 minutes), admin batch action, and any submission transition into `pending` (create / confirm / retry). A module-level gate (`triggerWorkerRun` / `isWorkerRunInProgress`) ensures only one run is in flight at a time so concurrent triggers coalesce. Fresh state per run — Playwright login on every invocation — eliminates the staleness bugs the old long-running bot suffered from.
- **System Health Rollup:** `/admin/system-health/rollup` combines connector probes, cron freshness (last run vs. last expected run), the most recent worker run status, and a count of pending submissions overdue beyond the 15-minute threshold into one `{overall, components, lastWorkerRun, overdueCount}` signal. The frontend `WorkerHealthBanner` reads this rollup and warns on the Command Center, System Health, and Portal Submissions pages whenever overall is `degraded` or `failed`.
- **MAS Portal Integration:** Playwright bot interacts with the Freshdesk-based MAS portal, using specific form field IDs and leveraging authenticated sessions to bypass CAPTCHA.
- **UI/UX:** Adheres to an Agape brand color scheme (dark navy, blue, orange, gold) with a distinct logo.
- **TypeScript Monorepo:** Uses TypeScript composite projects and pnpm workspaces for type safety and dependency management.

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

- **Submissions sit in `pending` and never run.** Open System Health → Worker Activity. Check the "Pending due" and "Overdue" tiles. If overdue is non-zero, the rollup banner will say "degraded" — click into the Worker Activity card to see the last run's `lastError`. Confirm the `portal_retry_sweeper` cron has fresh runs in the Scheduled Jobs table; if it's failing, the message column will explain why (most often a Playwright login failure or a Neon endpoint cold-start).
- **Manually kick a run.** Use Portal Submissions → "Process Pending" (the admin batch). Each kick is gated, so if a run is already in flight the new kick is coalesced and the UI shows a polling progress card.
- **Worker says "Last run failed".** Drill into the most recent batch from the Worker Activity card and inspect `lastError`. Common causes: portal session cookies expired (re-run `pnpm --filter @workspace/api-server run bot:save-session`), MAS portal returning 5xx, or a stuck submission row that the half-hourly `stuck_submission_reset` cron will clear automatically.
- **Stale Playwright session ("Session expired" / login redirect loop).** The saved storage state lives in `artifacts/api-server/bot-session/state.json`. If the worker keeps failing with auth-redirect or "session expired" errors after a token rotation or upstream MAS-portal session purge, delete (or rename) `artifacts/api-server/bot-session/state.json`, then re-run `pnpm --filter @workspace/api-server run bot:save-session` to capture a fresh login. Restart the API server so the in-process worker picks up the new state on its next run. This is the first thing to try whenever the auth-related `lastError` doesn't go away on its own.
- **Manual one-shot run from a shell.** `pnpm --filter @workspace/api-server run bot:run` triggers a single in-process worker run via `triggerWorkerRun` (same code path as the cron) and exits with the job result. Useful for local troubleshooting without waiting for the next sweeper tick.
- **No worker runs since boot.** Expected after a fresh restart with no pending submissions; the sweeper will fire within 5 minutes and the midnight cron will fire at 00:00 ET. Queue any pending submission to trigger an immediate run.
