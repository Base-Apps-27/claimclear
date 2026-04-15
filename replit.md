# ClaimClear Project

## Overview
ClaimClear is a full NEMT (Non-Emergency Medical Transportation) rejected claims dispute tracker platform. It is designed to import rejected claims, guide staff through decision-tree workflows for dispute resolution, and automate the submission of disputes to the MAS Transportation Provider Support Portal using Playwright bots. The project aims to streamline the claims dispute process, reduce financial losses, and improve operational efficiency for NEMT providers.

## User Preferences
I want to emphasize iterative development and prefer detailed explanations when new features are introduced or significant changes are made. I appreciate clear, concise communication and enjoy seeing functional programming paradigms where they enhance code readability and maintainability. Please ask before making any major architectural changes or introducing new external dependencies.

## System Architecture
The project is structured as a pnpm workspace monorepo utilizing TypeScript.

**Technology Stack:**
- **Monorepo:** pnpm workspaces
- **Backend:** Node.js 24, Express 5, PostgreSQL, Drizzle ORM, Zod for validation
- **Frontend:** React, Vite, Tailwind CSS, shadcn/ui
- **Authentication:** Replit Auth (OpenID Connect with PKCE)
- **AI:** Anthropic Claude (via Replit AI Integrations proxy)
- **Bot Automation:** Playwright
- **API Codegen:** Orval (from OpenAPI spec)
- **Build Tool:** esbuild

**Core Architectural Decisions:**
- **Error Handling:** All async route handlers are wrapped to catch unhandled rejections and forward them to a global Express error handler, which logs errors and returns generic JSON responses to prevent information leakage.
- **Authentication:** Session-based authentication with both absolute and idle timeouts. Session validity is managed via the database, not OIDC token expiry. Specific middleware exists for general authentication, admin roles, and bot token verification.
- **Frontend Serving:** The React + Vite frontend is built as static files and served by the Express API server. In development, the API server serves the production build from `artifacts/claimclear/dist/public/`. In production, the same approach is used. This unified serving approach ensures both API and frontend are on the same port (8080), avoiding port detection issues.
- **Database Design:** A PostgreSQL database managed by Drizzle ORM stores 15 entities including users, sessions, claims, notes, audit logs, error types, portal submissions, portal responses, bot instances, presence logs, evidence types, claim evidence, and AI conversations.
- **Response Tracking:** The `portal_responses` table tracks incoming responses from both email inbox monitoring and portal polling. Responses are auto-matched to claims via ticket IDs, confirmation numbers, reference numbers, or payor email addresses. Each response has a source (email/portal/manual), response type (approval/denial/partial_approval/info_request/acknowledgment/other), and confidence level. Auto-detected responses update claim status automatically (e.g., approval → Resolved, denial → Denied, info_request → Needs Review). Staff can review, override, or manually link unmatched responses. Routes: `artifacts/api-server/src/routes/response-tracker.ts`. Matcher logic: `artifacts/api-server/src/lib/response-matcher.ts`.
- **Claim Workflow & Statuses:** Claims progress through statuses like New, Needs Review, Needs Evidence, Portal Queued, Awaiting Response, On Hold, Resolved, or Denied. The "Needs Review" status is auto-assigned to claims imported with no error details — these require manual portal review and triage. The triage flow has two outcomes: "Non-Issue" (resolved, $0 financial impact) or "Issue Found" (assign error type and move to normal workflow). The "Non-Issue" outcome is a dedicated outcome type that zeroes out the claim amount.
- **Decision Trees (Single Workflow System):** The decision tree IS the workflow system — it handles SOP logic, evidence collection (inline at each node), branching, and dispute reasons (via outcome labels). There is no separate evidence requirements editor, dispute reasons library, or SOP text — all of this lives in the tree. If a claim's error type has no tree, the queue blocks processing and tells the user a workflow must be assigned. The queue uses a 3-step flow: Review → Follow Workflow → Act.
- **Hold & Resume:** When a workflow reaches a "hold" outcome (or the user manually holds), the full decision tree state (steps taken, current node, evidence collected) is saved to `workflowProgress.treeState`. When the hold is removed, the claim returns to "Needs Evidence" (Action Required queue) and the TreePlayer restores from the saved snapshot — the user resumes at the exact decision point where they paused. The TreePlayer uses `forwardRef`/`useImperativeHandle` to expose `getState()` and accepts an `initialState` prop for restoration.
- **Error Type Model:** Simplified to: name, category, description, decision tree (core), and dispute instructions (AI writing guidelines). Legacy fields (guidance, recommendedActions, emailTemplate, disputeReasonsLibrary, evidenceRequirements) remain in the DB schema for backward compatibility but are not surfaced in the editor UI.
- **Evidence Management:** Supports object storage (GCS-backed presigned URLs), a reusable evidence types library, and claim-specific evidence collection linked to decision tree nodes.
- **Real-time Updates (SSE):** Server-Sent Events are used to push claim changes and presence updates to connected clients in real-time, enabling features like collision detection and instant UI updates.
- **Collision Detection:** Advisory-only presence system using heartbeats and SSE to notify users of others viewing or bots processing the same claim. Bot presence map auto-purges stale entries older than 10 minutes.
- **API Security:** Routes are protected with specific authentication middleware (`requireAuth`, `requireAdmin`, `requireBotToken`) based on their function.
- **Database Indexes:** All major tables have indexes on frequently queried columns (claims: status, confNumber, date, createdAt; portal_submissions: claimId, status; audit_logs: claimId; notes: claimId; claim_evidence: claimId; bot_activity_log: submissionId).
- **Cron Jobs:** Midnight EST batch job processes pending portal submissions. Weekday 7 AM EST daily brief sends summary email via Outlook/SMTP. Every 30 minutes during business hours (8 AM - 6 PM EST, weekdays) the response tracker scans the Outlook inbox for payor responses and auto-links them to claims.
- **Bot Architecture:** Two bot execution paths share a single browser worker (`batch-worker.ts`): (1) **Batch path** — the primary path used by the midnight cron and manual batch triggers via `batch-processor.ts`, runs in-process; (2) **Standalone bot** (`portal-bot.ts`) — an external polling process (via `pnpm run bot:run`) that claims work via API and delegates browser work to the same `runBatchWorker()` function. Both paths handle login, form filling, GPS conditional fields, mandatory evidence upload with retries, and session persistence. On successful submission, the claim status advances to "Awaiting Response", a note is created, and `disputeEmailSent` is set.
- **Evidence → Attachments Pipeline:** Evidence images collected during the decision tree workflow are stored in the `claim_evidence` table (with `image_url` pointing to `/objects/uploads/uuid.ext` in GCS object storage). When portal submissions are created, the `collectEvidenceUrls()` helper queries `claim_evidence` for the claim's image URLs and merges with any legacy `claims.evidence_files` JSON data. The bot's `downloadToTemp()` function handles three URL types: (1) `/objects/` paths — downloaded directly from GCS via `ObjectStorageService.downloadObjectToTemp()`, (2) local file paths — used as-is, (3) full HTTP URLs — fetched via `fetch()`.
- **GPS Breadcrumbs Resolution:** The `resolveGpsBreadcrumbs()` helper defaults to "Yes" for GPS Control Deviation issues when no valid value is configured in app settings. Valid values are "Yes", "No", "Unknown".
- **MAS Portal (Freshdesk):** The portal at `tpissues.medanswering.com` is a Freshdesk instance. The bot navigates directly to `/support/tickets/new?ticket_form=<slug>` to skip the issue-type dropdown (which causes a full page reload). All form fields use Freshdesk-specific IDs with account suffix `_4128361` (e.g., `#helpdesk_ticket_custom_field_cf_tp_name_4128361`). **Important:** Logging in removes reCAPTCHA, so authenticated sessions can submit tickets without CAPTCHA blocking. The bot persists session state to `state.json` to reuse login across runs. Issue types map to URL slugs: GPS Control Deviation → `gps_control_deviation`, Custom Payment Request → `custom_payment_request`, etc. The description field uses a rich text editor (Froala/CKEditor); bot tries textarea fill, then Froala `.fr-element`, then contenteditable fallback.
- **UI/UX:** The application adheres to an Agape brand color scheme (dark navy, blue, orange, gold) with a distinct logo.
- **TypeScript Monorepo:** Utilizes TypeScript composite projects and `pnpm workspaces` for robust type-checking and dependency management across packages.

**Project Structure:**
- `artifacts/api-server/` — Express API server, also serves the built frontend static files
- `artifacts/claimclear/` — React + Vite frontend (built to `dist/public/`, served by API server)
- `artifacts/mockup-sandbox/` — Design/component preview sandbox (port 8081)
- `lib/` — Shared libraries: `db` (Drizzle ORM), `api-spec` (OpenAPI), `api-zod` (Generated Zod schemas), `api-client-react` (Generated React Query hooks), `integrations-anthropic-ai` (Anthropic AI SDK client)
- `scripts/` — Utility scripts

**Port Configuration:**
- Port 8080: API Server (Express) — serves both `/api/*` routes AND static frontend at `/`
- Port 8081: Mockup Sandbox (Vite) — design preview at `/__mockup`
- Port 5173: ClaimClear Vite dev server (development only, not used in production)

**Production Build:**
- The production build first builds the ClaimClear frontend (`pnpm --filter @workspace/claimclear run build`), then builds the API server (`pnpm --filter @workspace/api-server run build`)
- The API server's `app.ts` serves static files from `artifacts/claimclear/dist/public/` and falls back to `index.html` for SPA routing

## External Dependencies
- **PostgreSQL:** Primary database.
- **Anthropic Claude:** AI capabilities for SOP analysis, dispute note generation (portal submissions), and email generation, accessed via Replit AI Integrations proxy. Portal dispute notes are generated at queue time (not in the bot process) using the error type's `disputeInstructions` field for tone/content guidelines and the decision tree's `outcomeLabel` as the specific dispute reason.
- **Playwright:** Browser automation for interacting with the MAS Transportation Provider Support Portal. Chromium is a production dependency installed during the build step. The `ensureBrowsersInstalled()` fallback attempts multiple CLI paths if the binary is missing at runtime.
- **Google Cloud Storage (GCS):** Used for object storage of evidence files.
- **Microsoft Outlook (Graph API):** Primary email sending via Replit connector (Office 365). Used for daily brief emails and response tracking (reading inbox for payor responses). Falls back to SMTP for sending if Outlook is unavailable. Utility: `artifacts/api-server/src/lib/outlook.ts` exports `sendEmail()`, `isOutlookConnected()`, `searchInboxEmails()`, and `getEmailById()`.
- **Replit Auth:** OpenID Connect with PKCE for user authentication.
