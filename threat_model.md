# Threat Model

## Project Overview

ClaimClear is a NEMT rejected-claims dispute tracker. It is a pnpm/TypeScript monorepo with a production Node.js/Express API (`artifacts/api-server`), PostgreSQL via Drizzle (`lib/db`), a React/Vite staff UI (`artifacts/claimclear`), and a static training guide served by the API. The API integrates with Replit Auth/OIDC for user login, Google Cloud/Object Storage for evidence files, Anthropic for classification and draft generation, Microsoft Outlook/Graph for email response handling, and Playwright automation for MAS portal submissions.

Production deployment is the `artifacts/api-server` artifact, which serves the API plus built static frontend assets. `artifacts/mockup-sandbox` and attached assets are development-only unless a production route explicitly reaches them. In production `NODE_ENV` is assumed to be `production`, and the platform terminates TLS.

## Assets

- **Claim and invoice data** -- rejected claim records, member/client numbers, invoice numbers, service dates, claim amounts, dispute status, workflow decisions, notes, and audit history. Unauthorized reads disclose sensitive operational and potentially regulated transport/health-related information; unauthorized writes can alter dispute outcomes.
- **Evidence and email attachments** -- uploaded screenshots, PDFs, and documents stored in object storage and linked to claims/groups. These may contain PII and claim-supporting documents.
- **User accounts and sessions** -- Replit OIDC identities, approval status, roles, session IDs, access tokens, and refresh tokens. Compromise allows impersonation or privilege abuse.
- **Admin controls** -- user approval/role management, backfills, system health, app settings, and audit exports. Admin routes can change access and sensitive operational state.
- **Bot service token and automation authority** -- `BOT_SERVICE_TOKEN` / previous token values authenticate internal scheduled callers. MAS portal automation can submit or alter external disputes.
- **External-service credentials and generated content** -- Anthropic API access, Outlook/Graph credentials, SMTP settings, GCS object access, and generated emails/portal descriptions.
- **Audit and state-event history** -- activity logs and state transitions needed for accountability and dispute traceability.

## Trust Boundaries

- **Browser to API** -- all browser requests cross from untrusted client code to the Express API. The API must authenticate, authorize, and validate every state-changing operation server-side.
- **Unauthenticated / pending / approved / admin users** -- `/api/health`, login, callback, and auth status are public; approved users reach most application routes; admin-only routes require `role === "admin"`. Pending users must not access protected application data.
- **Bot token to API** -- selected scheduled endpoints accept `x-bot-token` through `requireAuthOrBot`. Bot-token access bypasses human session checks and must remain narrowly scoped.
- **API to PostgreSQL** -- route parameters, query strings, import bodies, classifier outputs, and bot results are persisted through Drizzle. Raw SQL fragments must remain parameterized and must not concatenate user-controlled SQL.
- **API to object storage** -- clients request upload URLs, upload directly to storage, and later fetch `/api/storage/objects/*` through the API. Object names and ACL decisions must not permit unauthorized file reads or storage abuse.
- **API to external services** -- Anthropic, Outlook/Graph/SMTP, Replit Object Storage sidecar, and MAS portal automation receive data derived from claims and user input. Outbound requests need fixed destinations, timeouts, and safe handling of generated/untrusted content.
- **Bot worker to MAS portal browser context** -- Playwright code writes generated descriptions and evidence into a third-party portal. Text and HTML passed into the browser context must not execute script in the automation page.
- **Production / development boundary** -- mockup sandbox, test files, local scripts, attached assets, and generated `dist`/`node_modules` contents are out of production scan scope unless imported by the production server.

## Scan Anchors

- Production API entry points: `artifacts/api-server/src/index.ts`, `artifacts/api-server/src/app.ts`, `artifacts/api-server/src/routes/index.ts`.
- Authentication and authorization: `artifacts/api-server/src/routes/auth.ts`, `src/middlewares/requireAuth.ts`, `requireAdmin.ts`, `requireBotToken.ts`, `authMiddleware.ts`, `src/lib/auth.ts`, `src/lib/bot-token.ts`.
- Highest-risk routes: `routes/claims.ts`, `routes/invoice-groups.ts`, `routes/portal-submissions.ts`, `routes/claim-evidence.ts`, `routes/storage.ts`, `routes/response-tracker.ts`, `routes/import.ts`, `routes/admin.ts`, `routes/daily-brief.ts`.
- Storage and evidence handling: `src/lib/objectStorage.ts`, `src/lib/objectAcl.ts`, frontend upload call sites in `artifacts/claimclear/src/components/**`.
- Bot and external automation: `src/bot/batch-worker.ts`, `src/bot/portal-bot.ts`, `src/lib/batch-processor.ts`, Outlook and email libraries.
- Frontend rendering of untrusted content: `artifacts/claimclear/src/components/communication/*`, `conversations-card.tsx`, `portal-submission-drawer.tsx`, and shared email body render helpers.
- Dev-only: `artifacts/mockup-sandbox`, `attached_assets`, tests, generated `dist`, and `node_modules` should usually be ignored for production vulnerabilities.

## Threat Categories

### Spoofing

Users authenticate through Replit OIDC and are represented by database-backed session IDs. Sessions must be high entropy, stored only in secure HTTP-only cookies or deliberate bearer contexts, expire on idle/absolute timeouts, and be cleared on logout. Pending or denied users must not pass application authorization. Bot callers must present a valid `x-bot-token`, and bot-token endpoints must be limited to scheduled/internal use cases.

### Tampering

Claim statuses, invoice group outcomes, evidence links, notes, closure decisions, batch submission state, and user roles are business-critical. The API must validate request bodies with explicit schemas, enforce allowed state transitions server-side, ignore client-supplied authority such as roles or actor identities, and record audit events for sensitive transitions. Generated AI text and bot results must not be allowed to bypass readiness gates or overwrite protected fields without server-side checks.

### Repudiation

Claim and group workflows require accountability for dispute decisions, user approvals, role changes, submissions, email replies, and bot actions. Sensitive operations must log the actor, timestamp, target entity, and material before/after details without leaking secrets. Bot actions should be attributable to a bot/system actor distinct from human users.

### Information Disclosure

Claim records, evidence, email bodies, attachments, logs, session data, and external-service tokens must not be disclosed to unauthenticated or pending users. Admin-only operational data and user lists must remain admin-only. Object storage routes must enforce the intended visibility/ACL model. Error responses and logs should avoid exposing stack traces, session IDs, OIDC tokens, bot tokens, API keys, or sensitive claim contents beyond authorized operators.

### Denial of Service

Public and authenticated endpoints can trigger database searches, imports, file uploads, AI calls, email checks, SSE streams, and Playwright automation. The application should bound request sizes, uploaded object sizes and content types, expensive query parameters, concurrent bot jobs, AI prompt size, external-service timeouts, and retry loops. The 10 MB JSON limit and platform TLS are assumed, but storage upload URLs and long-running automation remain high-risk.

### Elevation of Privilege

Admin routes must require server-side admin checks on every operation. Approved regular users must not be able to approve users, change roles, run privileged backfills, bypass portal submission gates using system/bot actor paths, access arbitrary private evidence, or alter records outside their intended authority. SQL, command, path traversal, SSRF, unsafe HTML injection into the Playwright browser, and object-storage ACL bypasses are especially relevant because they can cross from ordinary authenticated input to broader application or infrastructure control.
