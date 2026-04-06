# Workspace

## Overview

pnpm workspace monorepo using TypeScript. ClaimClear — a full NEMT rejected claims dispute tracker platform. Imports rejected claims, guides staff through decision-tree workflows, and submits disputes via Playwright bot automation to the MAS Transportation Provider Support Portal.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)
- **Frontend**: React + Vite + Tailwind CSS + shadcn/ui
- **Auth**: Replit Auth (OpenID Connect with PKCE)
- **AI**: Anthropic Claude (via Replit AI Integrations proxy)
- **Bot automation**: Playwright

## Structure

```text
artifacts-monorepo/
├── artifacts/
│   ├── api-server/         # Express API server (port 8080)
│   │   └── src/bot/        # Playwright bot scripts
│   └── claimclear/         # React + Vite frontend (proxied through API server)
├── lib/
│   ├── api-spec/           # OpenAPI spec + Orval codegen config
│   ├── api-client-react/   # Generated React Query hooks
│   ├── api-zod/            # Generated Zod schemas from OpenAPI
│   ├── integrations-anthropic-ai/ # Anthropic AI SDK client
│   └── db/                 # Drizzle ORM schema + DB connection
├── scripts/
│   └── src/
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── tsconfig.json
└── package.json
```

## Architecture Notes

### Error Handling
All async route handlers are wrapped in `asyncHandler()` (see `src/lib/asyncHandler.ts`) which catches unhandled rejections and forwards them to Express's error handler. The global error handler in `app.ts` logs errors via pino and returns clean `{ error: "Internal server error" }` JSON responses — no stack traces leak to clients.

### Auth Middleware
- `requireAuth` — checks session auth + approval status
- `requireAdmin` — checks session auth + admin role (replaces inline admin checks)
- `requireBotToken` — checks `X-Bot-Token` header
- `requireAuthOrBot` — accepts either session auth or bot token
- **Session validity is based on DB session TTL, NOT OIDC token expiry.** OIDC tokens are only used during login for identity verification.
- **Absolute TTL**: 8 hours (`SESSION_ABSOLUTE_TTL`) — max session lifetime regardless of activity
- **Idle timeout**: 30 minutes (`SESSION_IDLE_TIMEOUT`) — session expires after 30 min of inactivity; each request resets the idle timer (via `touchSession`, throttled to 1 DB write/min)
- **Expiry detection**: `getSession()` returns `{ data, expiry }` where expiry is `"expired_absolute"` | `"expired_idle"` | `null`. The `/auth/user` endpoint passes `sessionExpiry` to the frontend, which shows context-specific messages on the login screen.
- **Frontend 401 handling**: QueryClient retries detect 401 and reload the page, which re-checks auth and shows the appropriate expiry message.

### Frontend Routing
The ClaimClear frontend is served at the root path `/`. In production, it's served as static files. Custom domain: `cc.agapeny.app`.

### Database Entities (12 tables)
- `users` — Replit Auth users (varchar ID)
- `sessions` — auth session storage (sid + JSON payload + expire)
- `claims` — rejected claims (serial ID)
- `notes` — claim notes/comments (with ownership tracking via `author`)
- `audit_logs` — full audit trail
- `error_types` — categorized denial reasons with decision trees
- `error_detail_mappings` — maps normalized error detail text to error type IDs (for auto-classification during import)
- `portal_submissions` — MAS portal submission tracking
- `bot_instances` — Playwright bot instance registry
- `bot_activity_log` — per-submission bot action log
- `presence_logs` — real-time user presence (heartbeat-based, unique on claim_id + user_email)
- `conversations` + `messages` — AI chat conversations

### Error Type Auto-Match & Bulk Assignment
- During import, a "Classify" step groups claims by unique error detail text and looks up previously saved mappings via `POST /api/error-detail-mappings/lookup`. Known matches are pre-filled; unrecognized error details can be assigned from existing error types. Confirmed mappings are saved via `POST /api/error-detail-mappings` for future imports.
- Fuzzy matching uses case-insensitive, whitespace-normalized text comparison.
- The All Claims page has multi-select checkboxes and a bulk "Assign Error Type" action (`POST /api/claims/bulk-assign-error-type`) that updates all selected claims and creates audit log entries.

### Status Flow
New → Needs Evidence → Portal Queued → Awaiting Response → On Hold/Resolved/Denied

### API Route Auth Architecture
- `/api/healthz`, `/api/auth/*` — Public (no auth)
- `/api/bot/*` — Bot service token only (`requireBotToken`)
  - `/api/bot/instances` — Bot instance CRUD (register, heartbeat, stop)
  - `/api/bot/portal-submissions/poll`, `/claim`, `/complete`, `/fail` — Bot workflow
- `/api/bot-instances` — Read-only listing for authenticated human users
- `/api/admin/*` — Admin middleware (`requireAdmin`)
- All other `/api/*` routes — Session auth required (`requireAuth`)
- Bot authenticates via `X-Bot-Token` header (env: `BOT_SERVICE_TOKEN`)

### Financial Model
- **Vendor prepayment rate**: ~70% approximate (`VENDOR_PREPAY_RATE = 0.70`). Actual rate varies per claim and can be 100%+.
- **Total Exposure** = claim amount × 1.70 (claim + ~70% vendor prepayment). This is an approximate total financial loss if a claim isn't recovered. Labeled as "approx." throughout the UI.
- Dashboard, Summary, and Daily Brief all show `totalExposure` alongside `totalClaimed` and `totalApproved`.

### Dashboard & Daily Brief
- Dashboard uses DB-level aggregation (`GROUP BY`, `SUM`, `COUNT`) — no full table scans
- Shared `daysRemaining()` utility in `src/lib/dates.ts`
- Daily brief generates styled HTML email with pipeline stats, expiring claims
- Sends via SMTP when configured (`SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`)

### Decision Trees
- Native `DecisionTree` format: `{ rootNodeId, nodes: Record<string, DecisionTreeNode> }` where each node has `id`, `question`, `helpText`, `options[]`, and `evidenceRequirements[]`
- SOP analyzer and build-tree-from-text AI endpoints convert legacy yes/no tree format to native DecisionTree format automatically
- Legacy format (`question/yesLabel/noLabel/yesChild/noChild`) still supported via `legacyToTree()` in frontend

### CORS
CORS origins allow Replit domains (`*.replit.dev`, `*.repl.co`, `*.replit.app`) and localhost by default. Override with `CORS_ORIGINS` env var (comma-separated list).

### Import
- Batch insert (up to 100 rows per batch) — no N+1 queries
- Duplicate detection via single `IN` query on conf numbers

### Presence & Collision Detection
- Uses `ON CONFLICT (claim_id, user_email) DO UPDATE` for atomic heartbeat upsert (no race conditions)
- `GET /api/presence/:claimId` returns `{ viewers: PresenceViewer[], botActivity: BotPresenceEntry[] }` — includes both human viewers and active bot operations (portal submissions with `in_progress` status)
- SSE presence events (`viewer_joined`, `viewer_left`, `bot_started`, `bot_completed`) broadcast via `broadcastPresenceEvent()` for instant UI updates
- Prominent blue collision banner at top of claim detail when other users are viewing
- Amber/orange bot activity banner when automated processes (portal submission, AI email) are active on the claim
- Viewer avatars have pulsating ring animation and styled Tooltip (not browser-native title)
- Both banners use slide-in/fade-out entrance/exit animations
- Advisory only — no hard locking or action blocking

### Real-Time Updates (SSE)
- Server-Sent Events push claim changes and presence updates to all connected viewers in real time
- `GET /api/claims/:id/events` — per-claim SSE stream for claim detail pages (events: `claim_update`, `presence_update`)
- `GET /api/claims/events` — global SSE stream for claims list/queue pages
- In-memory client tracking in `src/lib/sse.ts` with keep-alive pings every 25s
- All claim mutation routes (status, outcome, evidence, hold, workflow, notes) emit SSE events via `broadcastClaimEvent()`
- Presence routes and bot endpoints emit SSE events via `broadcastPresenceEvent()` for real-time collision detection
- Frontend `useClaimEvents(claimId)` hook: opens EventSource, invalidates React Query caches on `claim_update` and `presence_update` events, shows toast for remote changes
- Frontend `useClaimsListEvents()` hook: opens global EventSource, invalidates all claims list queries
- Indefinite exponential backoff reconnection (caps at 30s intervals, resets on successful connection)
- Toasts skip the current user's own actions to avoid redundant feedback

### User Management
- `upsertUser` uses `ON CONFLICT DO UPDATE` for atomic user creation/update
- First user auto-promoted to admin with approved status
- OIDC discovery uses singleton with promise-based mutex (no concurrent discovery calls)

### Bot
- Bot retry resets submission to "pending" before retrying (no double-processing of "in_progress" records)
- Notes are deletable only by their author or admin users

### CSS Theme
Agape brand: dark navy primary (221 50% 16%), blue interactive (219 85% 52%), orange accent (12 79% 57%), navy sidebar. Logo: Agape teardrop "A" mark with orange accent stroke. Brand hex values: navy #1B2A4A, blue #3478F6, orange #E85D3A, gold #E5A332.

## TypeScript & Composite Projects

Every package extends `tsconfig.base.json` which sets `composite: true`. The root `tsconfig.json` lists all packages as project references.

- **Always typecheck from the root** — run `pnpm run typecheck`
- **`emitDeclarationOnly`** — only emit `.d.ts` files during typecheck
- **Project references** — when package A depends on package B, A's `tsconfig.json` must list B in its `references` array

## Root Scripts

- `pnpm run build` — runs `typecheck` first, then recursively runs `build` in all packages
- `pnpm run typecheck` — runs `tsc --build --emitDeclarationOnly`

## Packages

### `artifacts/api-server` (`@workspace/api-server`)

Express 5 API server. Routes live in `src/routes/`. Proxies `/claimclear/` to the Vite dev server in development.

- Entry: `src/index.ts` — reads `PORT`, starts Express
- App setup: `src/app.ts` — mounts CORS, JSON/urlencoded parsing, proxy middleware, routes at `/api`, global error handler
- Middleware: `src/middlewares/` — authMiddleware, requireAuth, requireAdmin, requireBotToken
- Utilities: `src/lib/` — asyncHandler, auth (OIDC + sessions), dates, logger
- Routes: claims CRUD, error types, CSV import, portal submissions, bot instances, presence, dashboard summary, daily brief, AI email generation, SOP analyzer, audit logs, notes, anthropic conversations
- Bot routes: `src/routes/bot-portal.ts` (bot-only portal submission endpoints), `src/routes/bot-instances.ts` (bot instance management)
- Bot scripts: `src/bot/portal-bot.ts` (Playwright automation for MAS portal), `src/bot/save-session.ts` (session saver)
- Depends on: `@workspace/db`, `@workspace/api-zod`

### `artifacts/claimclear` (`@workspace/claimclear`)

React + Vite frontend with 10 pages:
- Dashboard, Queue (split-panel with decision-tree workflow player), All Claims, Claim Detail (portal submission tracking, bot activity timeline, evidence checklist), New Claim, Import (RFC-compliant CSV parser), Error Types (structured SOP builder with decision-tree editor), Portal Submissions, Summary, Settings
- Queue page: 4-step workflow (Review → Evidence → Decide → Submit), fetches error type's decision tree for guided branching, uses error type's evidence requirements for checklist. Decision tree player supports multi-option nodes, undo/back, help text, progress indicator, per-node evidence, and color-coded structured outcomes.
- Error Types: Tabbed editor (AI Analyzer, Basics, SOP & Guidance, Evidence & Reasons, Decision Tree) with AI-powered SOP analysis. AI Analyzer has 3 sub-tabs: SOP Analyzer (paste SOP text → generates all fields), Describe Workflow (natural language → AI generates tree), Guided Builder (conversational step-by-step wizard). Decision Tree tab uses visual card-based editor with multi-option nodes, outcome type dropdowns, help text, per-node evidence, collapse/expand, and templates.
- Decision tree components extracted to `src/components/decision-tree/` (types.ts, editor.tsx, player.tsx, index.ts). Supports new multi-option node format + backward-compatible legacy yes/no conversion.
- Uses `@workspace/api-client-react` for API hooks
- Uses `@workspace/replit-auth-web` for authentication
- Presence system with heartbeat hooks

### `lib/db` (`@workspace/db`)

Database layer using Drizzle ORM with PostgreSQL.

### `lib/api-spec` (`@workspace/api-spec`)

OpenAPI 3.1 spec and Orval codegen config.

### `lib/api-zod` (`@workspace/api-zod`)

Generated Zod schemas from the OpenAPI spec.

### `lib/api-client-react` (`@workspace/api-client-react`)

Generated React Query hooks and fetch client.

### `scripts` (`@workspace/scripts`)

Utility scripts package.

## Known Issues

- Claimclear Vite workflow reports FAILED status due to platform port detection timing — the dev server starts correctly but the port probe times out. The app works when the process is running.
