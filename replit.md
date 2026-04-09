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
- **Database Design:** A PostgreSQL database managed by Drizzle ORM stores 14 entities including users, sessions, claims, notes, audit logs, error types, portal submissions, bot instances, presence logs, evidence types, claim evidence, and AI conversations.
- **Claim Workflow & Statuses:** Claims progress through statuses like New, Needs Evidence, Portal Queued, Awaiting Response, On Hold, Resolved, or Denied.
- **Decision Trees (Single Workflow System):** The decision tree IS the workflow system — it handles SOP logic, evidence collection (inline at each node), branching, and dispute reasons (via outcome labels). There is no separate evidence requirements editor, dispute reasons library, or SOP text — all of this lives in the tree. If a claim's error type has no tree, the queue blocks processing and tells the user a workflow must be assigned. The queue uses a 3-step flow: Review → Follow Workflow → Act.
- **Hold & Resume:** When a workflow reaches a "hold" outcome (or the user manually holds), the full decision tree state (steps taken, current node, evidence collected) is saved to `workflowProgress.treeState`. When the hold is removed, the claim returns to "Needs Evidence" (Action Required queue) and the TreePlayer restores from the saved snapshot — the user resumes at the exact decision point where they paused. The TreePlayer uses `forwardRef`/`useImperativeHandle` to expose `getState()` and accepts an `initialState` prop for restoration.
- **Error Type Model:** Simplified to: name, category, description, decision tree (core), and dispute instructions (AI writing guidelines). Legacy fields (guidance, recommendedActions, emailTemplate, disputeReasonsLibrary, evidenceRequirements) remain in the DB schema for backward compatibility but are not surfaced in the editor UI.
- **Evidence Management:** Supports object storage (GCS-backed presigned URLs), a reusable evidence types library, and claim-specific evidence collection linked to decision tree nodes.
- **Real-time Updates (SSE):** Server-Sent Events are used to push claim changes and presence updates to connected clients in real-time, enabling features like collision detection and instant UI updates.
- **Collision Detection:** Advisory-only presence system using heartbeats and SSE to notify users of others viewing or bots processing the same claim.
- **API Security:** Routes are protected with specific authentication middleware (`requireAuth`, `requireAdmin`, `requireBotToken`) based on their function.
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
- **Playwright:** Browser automation for interacting with the MAS Transportation Provider Support Portal.
- **Google Cloud Storage (GCS):** Used for object storage of evidence files.
- **Microsoft Outlook (Graph API):** Primary email sending via Replit connector (Office 365). Used for daily brief emails. Falls back to SMTP if Outlook is unavailable. Utility: `artifacts/api-server/src/lib/outlook.ts` exports `sendEmail()` and `isOutlookConnected()`.
- **Replit Auth:** OpenID Connect with PKCE for user authentication.
