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

### Frontend Routing
The ClaimClear frontend is served through the API server via http-proxy-middleware in dev mode. In production, it's served as static files. The frontend is mounted at `/claimclear/` path.

### Database Entities (9 tables)
- `users` — Replit Auth users (varchar ID)
- `claims` — rejected claims (serial ID)
- `notes` — claim notes/comments
- `audit_logs` — full audit trail
- `error_types` — categorized denial reasons
- `portal_submissions` — MAS portal submission tracking
- `bot_instances` — Playwright bot instance registry
- `presence` — real-time user presence (heartbeat-based)
- `sessions` — auth session storage

### Status Flow
New → Needs Evidence → Portal Queued → Awaiting Response → On Hold/Resolved/Denied

### API Route Auth Architecture
- `/api/healthz`, `/api/auth/*` — Public (no auth)
- `/api/bot/*` — Bot service token only (`requireBotToken`)
  - `/api/bot/instances` — Bot instance CRUD (register, heartbeat, stop)
  - `/api/bot/portal-submissions/poll`, `/claim`, `/complete`, `/fail` — Bot workflow
- `/api/bot-instances` — Read-only listing for authenticated human users
- All other `/api/*` routes — Session auth required (`requireAuth`)
- Bot authenticates via `X-Bot-Token` header (env: `BOT_SERVICE_TOKEN`)

### Daily Brief
- Generates styled HTML email summary with pipeline stats
- Sends via SMTP when configured (`SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`)
- Recipients: queries users table for email addresses; falls back to `DAILY_BRIEF_RECIPIENTS` env var or `SMTP_USER`
- Returns `{ sent: boolean, message: string }` per OpenAPI spec

### CSS Theme
Indigo primary (243 75% 59%), dark indigo sidebar (243 85% 15%), light background (210 20% 98%)

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
- App setup: `src/app.ts` — mounts CORS, JSON/urlencoded parsing, proxy middleware, routes at `/api`
- Routes: claims CRUD, error types, CSV import, portal submissions, bot instances, presence, dashboard summary, daily brief, AI email generation, SOP analyzer, audit logs, notes
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
