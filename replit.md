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
- **Claim Workflow & Statuses:** Claims progress through predefined statuses (e.g., New, Needs Review, Resolved, Denied) with a dedicated "Non-Issue" outcome for claims requiring triage.
- **Centralized Transitions:** All status and outcome changes for claims and invoice groups are processed through dedicated centralized functions (`claim-transitions.ts`, `group-transitions.ts`) to ensure audit logging, timeline notes, and real-time SSE events.
- **Post-Response Workflow:** After a payor response, claims enter a "Needs Review" state, requiring staff to choose actions like "Resolve," "Accept as Loss," or "Re-dispute."
- **Decision Trees:** Integrated workflow system for SOP logic, evidence collection, branching, and dispute reasons, with "hold" outcomes preserving tree state for later resumption.
- **Error Type Model:** Simplified model focusing on name, category, description, decision tree, and AI dispute instructions.
- **Evidence Management:** Supports object storage for evidence files, linked to decision tree nodes and collected for portal submissions.
- **Real-time Updates:** Server-Sent Events (SSE) provide real-time updates and collision detection for claims and presence.
- **API Security:** Role-based authentication middleware (`requireAuth`, `requireAdmin`, `requireBotToken`) protects API routes.
- **Database Indexes:** Key tables are indexed for optimal query performance.
- **Cron Jobs:** Scheduled jobs for processing portal submissions, sending daily briefs, and scanning for payor responses.
- **Bot Architecture:** A shared browser worker handles bot execution for both batch processing and standalone polling, managing login, form filling, evidence upload, and session persistence.
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

The bot service token authenticates internal API calls from the Playwright bots and from internal cron jobs (`x-bot-token` header). Rotate it safely with a grace window so bots can be restarted one at a time:

1. Generate a new random token (e.g. `openssl rand -hex 32`).
2. In Replit Secrets, set `BOT_SERVICE_TOKEN_PREVIOUS` to the **current** value of `BOT_SERVICE_TOKEN`, then set `BOT_SERVICE_TOKEN` to the **new** value.
3. Restart the API server workflow. The middleware reads both env vars per request, so any bot still using the old token continues to authenticate.
4. Restart each bot one at a time. They pick up the new token at startup.
5. Verify in Settings → "Bot Service Token" panel that "Last successful bot auth" is recent and the active hash prefix matches what you expect. The grace banner indicates `BOT_SERVICE_TOKEN_PREVIOUS` is still set.
6. Once all bots are confirmed on the new token, unset `BOT_SERVICE_TOKEN_PREVIOUS` in Replit Secrets and restart the API server one final time. The grace banner should disappear.

Notes:
- Never log or paste the raw token. The admin panel only ever shows the first 8 chars of `sha256(token)`.
- The token comparison is constant-time (`crypto.timingSafeEqual`) to avoid timing leaks.
- If you skip the grace step, every bot must be restarted simultaneously with the API server or polling will return 401 until they catch up.
