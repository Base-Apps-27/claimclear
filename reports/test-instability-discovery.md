# Test Instability Discovery Report

## 0. Executive Snapshot

```json
{
  "project_type": "pnpm monorepo (web + api + slides + design canvas)",
  "language_runtime": "Node.js 24 (TypeScript via tsx) + Postgres 16",
  "package_manager": "pnpm (preinstall enforces it)",
  "monorepo": true,
  "test_frameworks": ["node:test (native, via tsx)", "@playwright/test"],
  "primary_test_command": "pnpm -r --if-present run test  (no root script defined; must be invoked per-package)",
  "single_file_test_command_template": "pnpm --filter <pkg> exec node --import tsx --test <path/to/file.test.ts>",
  "single_test_name_command_template": "pnpm --filter <pkg> exec node --import tsx --test --test-name-pattern='<regex>' <path/to/file.test.ts>",
  "supports_shuffle": true,
  "supports_repeat": true,
  "supports_json_output": true,
  "runs_parallel_by_default": true,
  "known_flake_pattern": "shared production Postgres pool reused across tests; test bodies seed/mutate real tables and depend on `pool.end()` running once at the end of each file",
  "highest_risk_shared_resources": [
    "single Postgres pool exported from @workspace/db (shared by every test that touches DB)",
    "process.env.BOT_SERVICE_TOKEN (set, never restored)",
    "module-level Anthropic client singleton (toggled via __setAnthropicClientForTesting)",
    "module-level Chromium / batch-worker / direct-email override hooks (__set*ForTests)",
    "node-cron schedules + setInterval keep-alives that fire on import of api-server/src/index.ts",
    "Playwright e2e webServer port 5174 with reuseExistingServer: true"
  ],
  "recommended_stress_axis": [
    "shuffle file order within a package",
    "repeat full per-package suite N×",
    "serial vs --test-concurrency=1 vs default parallel",
    "isolated single-file reruns of every file",
    "DB seed/clean variation (run with empty DB vs populated DB)",
    "env variation (BOT_SERVICE_TOKEN unset, DATABASE_URL unset, TZ varied)",
    "port randomization for the e2e suite (E2E_PORT)"
  ]
}
```

---

## 1. Project / Test Topology

| Item | Value | Evidence Path |
|---|---|---|
| language/runtime | Node.js 24, TypeScript 5.9 | `.replit` (`modules = ["nodejs-24", ...]`), root `package.json` |
| package manager | pnpm (workspaces) | `package.json` `preinstall`, `pnpm-workspace.yaml` |
| monorepo / workspaces | yes | `pnpm-workspace.yaml` (`artifacts/*`, `lib/*`, `lib/integrations/*`, `scripts`) |
| workspace/package names | `@workspace/api-server`, `@workspace/claimclear`, `@workspace/claimclear-app`, `@workspace/training-guide`, `@workspace/mockup-sandbox`, `@workspace/scripts`, `@workspace/db`, `@workspace/api-spec`, `@workspace/api-client-react`, `@workspace/api-zod`, `@workspace/observability`, `@workspace/replit-auth-web`, `@workspace/object-storage-web`, `@workspace/closure-options`, `@workspace/leg-state`, `@workspace/vocab`, `@workspace/payor-denial-reasons`, `@workspace/integrations-anthropic-ai`, `@workspace/invoice-state` | each `package.json` |
| app entry points | `artifacts/api-server/src/index.ts` (Express + cron), `artifacts/claimclear/src` (SPA), `artifacts/training-guide/src`, `artifacts/mockup-sandbox/src`, `artifacts/claimclear-app/src` | `package.json` `dev` scripts |
| test directories | `artifacts/api-server/src/__tests__/`, `artifacts/claimclear/src/{lib,components,components/decision-tree,components/decision-tree/terminals,pages,hooks}/`, `artifacts/claimclear/e2e/`, `scripts/src/__tests__/`, `lib/leg-state/src/__tests__/`, `lib/vocab/src/__tests__/`, `lib/observability/src/__tests__/`, `lib/invoice-state/src/__tests__/` | filesystem |
| test file patterns | `*.test.ts`, `*.test.tsx` (unit); `*.spec.ts` (Playwright e2e) | `package.json` `test` scripts; `playwright.config.ts` `testMatch: /.*\.spec\.ts$/` |
| CI workflow files | **None found.** No `.github/`, no `.gitlab-ci.yml`, no `Makefile`. Only `.replit` workflow (`schema-drift`) and `scripts/post-merge.sh`. | `find . -name .github` returns nothing |
| global setup files | **None.** No `vitest.setup.*`, `jest.setup.*`, `globalSetup`, `test-helpers/`, etc. | `find …` empty |
| global teardown files | **None.** Each file does its own `before/after`. | same |

Counts:
- 78 test files in `artifacts/api-server/src/__tests__/`
- ~50+ unit test files in `artifacts/claimclear/src/**`
- 3 Playwright spec files in `artifacts/claimclear/e2e/`
- 7 test files in `scripts/src/__tests__/`
- 7 test files across `lib/{leg-state,vocab,observability,invoice-state}/src/__tests__/`

---

## 2. Test Commands

```json
{
  "commands": {
    "test": null,
    "test_unit": "pnpm -r --if-present run test",
    "test_integration": null,
    "test_e2e": "pnpm --filter @workspace/claimclear test:e2e",
    "test_ci": null,
    "single_file": "pnpm --filter <pkg> exec node --import tsx --test <file>",
    "single_test_name": "pnpm --filter <pkg> exec node --import tsx --test --test-name-pattern='<regex>' <file>",
    "shuffle_or_random_order": "node --test --test-shuffle [--test-shuffle-seed=<n>]  (NOT wired into any package script)",
    "repeat": "no built-in flag in node:test; must wrap in shell loop",
    "json_or_junit_output": "node --test --test-reporter=tap | --test-reporter=spec | --test-reporter=junit (junit reporter requires opt-in)",
    "typecheck": "pnpm run typecheck  (root)",
    "build": "pnpm run build  (root)",
    "lint": null,
    "db_setup": "pnpm --filter @workspace/db run migrate",
    "db_seed": null,
    "db_reset": null,
    "services_start": "no aggregated start; .replit workflow `Project` only runs `schema-drift`"
  },
  "missing_commands": [
    "root `test` script",
    "lint",
    "db_seed / db_reset",
    "test_ci",
    "any orchestrated services_start (api-server + DB) for tests"
  ]
}
```

Per-package `test` scripts (verbatim from `package.json`):

| Package | Command |
|---|---|
| `@workspace/api-server` | `TZ=America/New_York node --import tsx --test src/__tests__/*.test.ts` |
| `@workspace/claimclear` | `TSX_TSCONFIG_PATH=./tsconfig.test.json node --experimental-test-module-mocks --import tsx --test --test-force-exit src/lib/*.test.ts src/lib/*.test.tsx src/components/*.test.ts src/components/*.test.tsx src/components/decision-tree/*.test.ts src/components/decision-tree/*.test.tsx src/components/decision-tree/terminals/*.test.ts src/components/decision-tree/terminals/*.test.tsx src/pages/*.test.ts src/pages/*.test.tsx src/hooks/*.test.ts src/hooks/*.test.tsx` |
| `@workspace/claimclear` | `playwright test --config=playwright.config.ts` (`test:e2e`) |
| `@workspace/scripts` | `node --import tsx --test src/__tests__/*.test.ts` |
| `@workspace/leg-state` | `node --import tsx --test src/__tests__/*.test.ts` |
| `@workspace/vocab` | `node --import tsx --test src/__tests__/*.test.ts` |
| `@workspace/observability` | `node --import tsx --test src/__tests__/*.test.ts` |
| `@workspace/invoice-state` | `node --import tsx --test src/__tests__/*.test.ts` |
| `@workspace/claimclear-app`, `@workspace/training-guide`, `@workspace/mockup-sandbox`, `@workspace/db`, `@workspace/api-spec`, `@workspace/api-client-react`, `@workspace/api-zod`, `@workspace/replit-auth-web`, `@workspace/object-storage-web`, `@workspace/closure-options`, `@workspace/payor-denial-reasons`, `@workspace/integrations-anthropic-ai` | **no `test` script defined** |

Note: `@workspace/claimclear` opts into Node's `--test-force-exit`, which strongly indicates the suite leaves open handles (timers, sockets) at exit.

---

## 3. Test Runner Capabilities

```json
{
  "test_runner": "node:test (built-in) for unit/integration; @playwright/test for e2e",
  "parallelism_default": "node:test runs each test FILE in a separate child worker in parallel; tests within a file are serial unless `concurrency: true` is passed",
  "parallelism_config_path": "controlled only via CLI flags (--test-concurrency); not configured in any package.json",
  "shuffle_supported": true,
  "shuffle_command": "node --test --test-shuffle [--test-shuffle-seed=<n>] <files>",
  "random_seed_supported": true,
  "seed_capture_method": "Node prints the chosen seed when --test-shuffle is used without an explicit seed; capture from stderr/stdout",
  "repeat_supported": false,
  "repeat_command": "no built-in; wrap in shell loop, e.g. `for i in {1..N}; do … done`",
  "json_output_supported": true,
  "json_output_command": "node --test --test-reporter=tap (default) or --test-reporter=spec; for JSON use `--test-reporter=node:test/reporters#tap` plus a TAP→JSON converter, or use --test-reporter=junit",
  "junit_output_supported": true,
  "junit_output_command": "node --test --test-reporter=junit --test-reporter-destination=junit.xml",
  "fail_fast_supported": false,
  "fail_fast_command": "no equivalent in node:test (Playwright supports --max-failures=1)",
  "single_file_supported": true,
  "single_test_supported": true,
  "timeout_defaults": "node:test: no timeout by default. Playwright: 30_000 ms per test, 5_000 ms per expect (artifacts/claimclear/playwright.config.ts).",
  "retry_config": "Playwright `retries: 0`; node:test has no retry config",
  "watch_mode": "node --test --watch (not used in any script)",
  "open_handle_detection": "node:test has no `--detectOpenHandles`. The `--test-force-exit` flag in @workspace/claimclear masks open handles by hard-exiting.",
  "notes": [
    "Node will run all 78 api-server test files in parallel by default. Each opens its own pool against the same DATABASE_URL — see Section 7.",
    "TSX_TSCONFIG_PATH=./tsconfig.test.json toggles JSX support for the claimclear suite.",
    "TZ=America/New_York is hard-pinned in the api-server test command — many tests assume Eastern time."
  ]
}
```

---

## 4. CI Behavior

| Workflow | Trigger | Commands | Services | Parallel/Sharded | Retries | Cache | Artifacts | Evidence Path |
|---|---|---|---|---|---|---|---|---|
| `.replit` `Project` workflow | manual `Run` button | `pnpm --filter @workspace/db run check-drift && bash lib/db/scripts/check-state-fingerprint.sh` (workflow `schema-drift`) | DB only | n/a | n/a | n/a | console only | `.replit` |
| `.replit` `[deployment]` build | publish | `pnpm --filter @workspace/db run migrate` (then artifact build) | DB | no | no | n/a | n/a | `.replit` |
| `.replit` `[postMerge]` | merge of a project task | `scripts/post-merge.sh` → `pnpm install --frozen-lockfile && pnpm --filter @workspace/db run migrate && pnpm --filter @workspace/scripts run check:vocab-drift && pnpm --filter @workspace/api-spec run codegen && pnpm exec tsc -b … --force` | DB | no | no | none | none | `scripts/post-merge.sh` |

**No CI runs the test suite.** No GitHub/GitLab/CircleCI/Buildkite config exists in the repo. Tests are only executed locally and via the Replit project task system (out-of-tree).

CI env vars (redacted): none discovered in committed configs (no CI files exist).

---

## 5. Known Failure Evidence

```json
{
  "known_failures": [],
  "skipped_or_quarantined_tests": [],
  "retry_usage": [
    {
      "where": "artifacts/claimclear/playwright.config.ts",
      "value": "retries: 0",
      "note": "explicitly zero — flakes will surface, not be hidden"
    }
  ]
}
```

`rg -n "test\.skip|describe\.skip|test\.only|describe\.only|it\.skip|FLAKY|quarantine"` across `artifacts/`, `lib/`, `scripts/` returned **no matches** (only matches were prose like "skipped count" inside assertions). No flaky-test markers, no quarantine list, no committed CI logs in `reports/`.

---

## 6. Shared Resource Inventory

| Resource Type | Resource Name | Created In | Reset/Cleanup In | Used By Tests | Risk | Evidence |
|---|---|---|---|---|---|---|
| database (Postgres) | `pool` (single `pg.Pool`) | `lib/db/src/index.ts:13` (`new Pool({ connectionString: process.env.DATABASE_URL })`) | each test file calls `await pool.end().catch(()=>undefined)` in its `after()` | every api-server `__tests__/*` file that imports `@workspace/db` (>40 files) | **critical** | grep `pool.end()` matches across api-server tests |
| database tables | `claimsTable`, `invoiceGroupsTable`, `portalSubmissionsTable`, `portalBatchRunsTable`, `errorTypesTable`, `auditLogsTable`, etc. (real schema) | inserted directly via drizzle in test `before()` blocks | partial — tests `inArray`-delete only the IDs they created in `after()` | every integration test (sample: `portal-submissions-completed-elsewhere.test.ts`, `closure-data-foundation.test.ts`, `urgent-today-transitions.test.ts`, `invoice-group-create.test.ts`) | **critical** | sample test code shown in Section 7 |
| HTTP server | ad-hoc `app.listen(0, …)` per test file | inside `before()` of each integration test | `server.closeAllConnections?.(); server.close()` in `after()` | ~25 api-server integration test files | medium (port 0 ⇒ random; pool teardown is the real risk) | `rg "app\.listen\(0," artifacts/api-server/src/__tests__` |
| timers/intervals | `setInterval` keep-alives (SSE), `setInterval(purgeStaleProcesses, 5*60*1000).unref()` (bot-presence), `setInterval(...).unref()` (authMiddleware), `setTimeout(...).unref()` in batch-processor | api-server src on import | `.unref()` on most; not all paths verified | any test that imports api-server src — e.g. importing routers transitively pulls these | medium | `artifacts/api-server/src/lib/bot-presence.ts:48`, `…/sse.ts:141,167,202,222,267,312`, `…/middlewares/authMiddleware.ts:43`, `…/lib/batch-processor.ts:310,330,874,902` |
| cron / schedulers | 8 `cron.schedule(...)` calls fire on import of `artifacts/api-server/src/index.ts` (URGENT_SNAPSHOT, DAILY_BRIEF, DAILY_BRIEF_BOUNCE_RECHECK, RESPONSE_TRACKER, OUTLOOK_HEARTBEAT, EXPIRED_SWEEP, STUCK_SUBMISSION_RESET, PORTAL_BATCH_SWEEPER) | `artifacts/api-server/src/index.ts:243…405` | **never cleaned up by tests**; tests bypass `index.ts` and import routers directly | tests do not import `index.ts`, but any test that mistakenly does will spawn live cron handles | high (latent) | grep above |
| HTTP servers / mock-servers | Playwright `webServer` on port 5174 with `reuseExistingServer: true` | `artifacts/claimclear/playwright.config.ts` | none — relies on reuse | all 3 e2e specs | medium (concurrent runners would conflict) | playwright config |
| browser contexts | Chromium via Playwright; `pw-browsers/` cache; bot uses real `chromium.launch` overridable via `__setChromiumForTests` | `artifacts/api-server/src/bot/batch-worker.ts:525` | `__setChromiumForTests(null)` called by tests that opt in | bot tests | medium | grep above |
| singletons | Anthropic client (`anthropic`), reply impl, batch worker, daily-brief send impl, chromium impl | `lib/integrations-anthropic-ai/src/client.ts:34`, `artifacts/api-server/src/routes/response-tracker.ts:39`, `artifacts/api-server/src/lib/batch-processor.ts:913`, `artifacts/api-server/src/lib/email-send.ts:93` | `__set*ForTesting(null)` called by tests; not all tests reset on failure paths | per-leg-state, sop-rewind, audit-prompt-leg-counters tests | high | grep above |
| in-memory maps | `activeBatches` Map (batch-processor) lives 24h after batch completes (`setTimeout(…delete…, 24*60*60*1000)`) | `artifacts/api-server/src/lib/batch-processor.ts:874,902` | timer is `.unref()` but the Map entry persists | any test that drives batch processing | medium | grep above |
| environment variables | `BOT_SERVICE_TOKEN` mutated and **not restored** | `submit-flow-gates.test.ts:31`, `endpoint-action-contract.test.ts:77` | none | downstream tests reading `BOT_SERVICE_TOKEN` (e.g. `daily-brief-route-outcome.test.ts:8`) | high | grep above |
| filesystem | Playwright `test-results/` dir (`artifacts/claimclear/test-results/`), screenshots-on-failure | playwright config | not cleared between runs | e2e | low | dir exists |
| feature flags | none discovered as runtime flags consumed by tests | n/a | n/a | n/a | low | n/a |
| external APIs | Outlook (Graph), Anthropic, OpenAI, GCS, Replit object storage, Clerk | api-server src | tests stub via `__set*ForTests` or `page.route()` mocking (e2e) | varies | medium | playwright config comment, `__set*ForTesting` hooks |
| ports | `8080` (api-server dev), `5173` (claimclear dev), `5174` (e2e built), random `:0` (per-test http) | `.replit [[ports]]`, vite/playwright configs | random port ⇒ low; e2e port fixed ⇒ medium | per-file http servers + playwright | medium | configs |

---

## 7. Database / Persistence Behavior

```json
{
  "database_type": "PostgreSQL 16 (single shared instance via DATABASE_URL)",
  "test_database_strategy": "NO separate test database. Tests connect to whatever DATABASE_URL is set (dev DB by default). They INSERT real rows then DELETE-by-id in after() hooks.",
  "test_db_url_env": "DATABASE_URL",
  "shared_database": true,
  "transaction_per_test": false,
  "rollback_after_test": false,
  "truncate_strategy": "none — per-id deletes only",
  "seed_strategy": "ad-hoc inserts inside each test's `before()` block",
  "migration_command": "pnpm --filter @workspace/db run migrate (apply-migrations.mjs)",
  "seed_command": null,
  "reset_command": null,
  "tables_frequently_mutated": [
    "claims", "invoice_groups", "portal_submissions", "portal_batch_runs",
    "error_types", "audit_logs", "users", "leg_state",
    "email_threads", "email_messages", "attestations"
  ],
  "tests_that_truncate_or_delete_shared_tables": [
    {
      "file": "artifacts/api-server/src/__tests__/portal-submissions-completed-elsewhere.test.ts",
      "hook": "afterAll (`after`)",
      "tables": ["portal_submissions", "portal_batch_runs", "claims", "invoice_groups"],
      "evidence": "after() uses inArray(...) deletes scoped to seeded IDs, but failure mid-test leaves rows behind"
    },
    {
      "file": "artifacts/api-server/src/__tests__/invoice-group-create.test.ts",
      "hook": "afterAll",
      "tables": ["invoice_groups", "claims"],
      "evidence": "same pattern; pool.end() at end"
    },
    {
      "file": "artifacts/api-server/src/__tests__/group-attestation-history.test.ts",
      "hook": "afterAll",
      "tables": ["attestations", "invoice_groups"],
      "evidence": "same pattern"
    },
    {
      "file": "artifacts/api-server/src/__tests__/closure-data-foundation.test.ts",
      "hook": "afterAll",
      "tables": ["claims", "invoice_groups", "audit_logs"],
      "evidence": "same pattern"
    }
  ],
  "tests_that_depend_on_global_seed_data": [
    {
      "file": "(none verified)",
      "seed_dependency": "uncertain — every observed test self-seeds",
      "evidence": "no fixture-loading helper found"
    }
  ],
  "hardcoded_ids_or_names": [
    {
      "file": "artifacts/api-server/src/__tests__/prompt-leg-inputs.test.ts",
      "value": "leg ids 501, 502 in `new Map([[501, transcriptTree]])`",
      "risk": "low (in-memory only, not DB)",
      "evidence": "lines 800–980"
    },
    {
      "file": "artifacts/api-server/src/__tests__/portal-submissions-completed-elsewhere.test.ts",
      "value": "TEST_USER email `completed-elsewhere-tester@example.com`",
      "risk": "medium — collisions across runs if tests crash before cleanup",
      "evidence": "line 33"
    },
    {
      "file": "artifacts/api-server/src/__tests__/submit-flow-gates.test.ts",
      "value": "TEST_BOT_TOKEN = `test-bot-service-token-210`",
      "risk": "medium — mutates process.env",
      "evidence": "lines 23, 31"
    },
    {
      "file": "artifacts/api-server/src/__tests__/endpoint-action-contract.test.ts",
      "value": "TEST_BOT_TOKEN = `test-bot-service-token-411`",
      "risk": "medium — mutates process.env",
      "evidence": "lines 55, 77"
    }
  ]
}
```

Sample test setup (`portal-submissions-completed-elsewhere.test.ts`):
```ts
import { db, pool, claimsTable, invoiceGroupsTable, portalSubmissionsTable, portalBatchRunsTable } from "@workspace/db";
…
before(async () => { …; server = app.listen(0, …); });
after(async () => {
  server.closeAllConnections?.();
  await new Promise<void>((r) => server.close(() => r()));
  await pool.end().catch(() => undefined);
});
```
Because node:test runs files in parallel child workers and **`pool` is a module-level singleton per worker**, each worker holds its own connection set against the **same** physical DB. There is no isolation strategy.

---

## 8. Environment Mutation

```json
{
  "env_mutations": [
    {
      "file": "artifacts/api-server/src/__tests__/submit-flow-gates.test.ts",
      "env_var": "BOT_SERVICE_TOKEN",
      "set_in": "before()",
      "restored": false,
      "restore_location": null,
      "risk": "high",
      "evidence": "line 31: process.env.BOT_SERVICE_TOKEN = TEST_BOT_TOKEN"
    },
    {
      "file": "artifacts/api-server/src/__tests__/endpoint-action-contract.test.ts",
      "env_var": "BOT_SERVICE_TOKEN",
      "set_in": "before()",
      "restored": false,
      "restore_location": null,
      "risk": "high",
      "evidence": "line 77"
    }
  ],
  "global_env_setup": [
    "TZ=America/New_York hard-coded in @workspace/api-server `test` script",
    "TSX_TSCONFIG_PATH=./tsconfig.test.json hard-coded in @workspace/claimclear `test` script",
    "DISPLAY_TIMEZONE / VITE_DISPLAY_TIMEZONE mutated in artifacts/claimclear/vite.config.ts (load-time)"
  ],
  "feature_flags_used_in_tests": [],
  "unrestored_env_risks": [
    "BOT_SERVICE_TOKEN: two suites permanently overwrite the value within a worker. If node:test ever adds intra-worker file batching, downstream tests in the same worker will see the wrong token. Even today, daily-brief-route-outcome.test.ts reads `process.env.BOT_SERVICE_TOKEN` at module load → its expectation depends on file evaluation order."
  ]
}
```

---

## 9. Server / Port / Socket Behavior

```json
{
  "servers": [
    {
      "file": "artifacts/api-server/src/__tests__/*.test.ts (≥25 files)",
      "server_type": "http (express via app.listen(0))",
      "port_strategy": "dynamic",
      "port_value": "0 (kernel-assigned)",
      "await_ready": true,
      "closed_after_test": true,
      "cleanup_location": "after() — server.closeAllConnections?.(); server.close(); pool.end()",
      "risk": "medium",
      "evidence": "grep `app.listen(0,` shows 25+ matches"
    },
    {
      "file": "artifacts/claimclear/e2e/serve-built.mjs",
      "server_type": "http (static SPA)",
      "port_strategy": "fixed (E2E_PORT or 5174)",
      "port_value": "5174",
      "await_ready": true,
      "closed_after_test": false,
      "cleanup_location": "Playwright spawns; reuseExistingServer:true keeps it across runs",
      "risk": "high",
      "evidence": "playwright.config.ts lines 32, 47–55"
    }
  ],
  "hardcoded_ports": [
    "5173 (claimclear dev / vite default)",
    "5174 (e2e built server)",
    "8080 (api-server dev / Replit external port)",
    "8081 → external 80 (Replit ports table)"
  ],
  "open_handle_risks": [
    "node:test for @workspace/claimclear is invoked with --test-force-exit, which proves the suite leaks handles (likely React-Query intervals, jsdom timers, sonner/toast timers, framer-motion RAF, or unflushed @testing-library cleanups).",
    "Cron/setInterval handles in api-server src will leak if any test imports artifacts/api-server/src/index.ts (none observed today, but a transitive import can introduce it)."
  ],
  "websocket_tests": []
}
```

---

## 10. Timers / Background Work

```json
{
  "timers_and_workers": [
    {"file": "artifacts/api-server/src/index.ts", "type": "cron", "created_in": "module top-level (lines 243,256,297,313,333,355,379,405)", "cleared_in": "never", "uses_fake_timers": false, "restores_fake_timers": false, "risk": "high (latent)", "evidence": "rg cron.schedule"},
    {"file": "artifacts/api-server/src/lib/bot-presence.ts:48", "type": "interval", "created_in": "module load", "cleared_in": "never (`.unref()`)", "uses_fake_timers": false, "restores_fake_timers": false, "risk": "low (unref'd)", "evidence": "setInterval(purgeStaleProcesses, 5*60*1000).unref()"},
    {"file": "artifacts/api-server/src/lib/sse.ts:141,167,202,222,267,312", "type": "interval", "created_in": "per-connection", "cleared_in": "on connection close", "uses_fake_timers": false, "restores_fake_timers": false, "risk": "medium", "evidence": "6 setInterval keep-alives"},
    {"file": "artifacts/api-server/src/middlewares/authMiddleware.ts:43", "type": "interval", "created_in": "module load", "cleared_in": "never", "uses_fake_timers": false, "restores_fake_timers": false, "risk": "medium", "evidence": "setInterval(...)"},
    {"file": "artifacts/api-server/src/lib/batch-processor.ts:874,902", "type": "timeout", "created_in": "per-batch", "cleared_in": "fires after 24h, `.unref()`", "uses_fake_timers": false, "restores_fake_timers": false, "risk": "medium", "evidence": "setTimeout(... 24*60*60*1000).unref()"},
    {"file": "artifacts/api-server/src/lib/batch-processor.ts:310,330", "type": "timeout", "created_in": "per-await", "cleared_in": "n/a (`.unref()` / short)", "uses_fake_timers": false, "restores_fake_timers": false, "risk": "low", "evidence": "polling waits"},
    {"file": "artifacts/api-server/src/lib/direct-email-dispatch.ts:119", "type": "timeout", "created_in": "retry backoff", "cleared_in": "natural", "uses_fake_timers": false, "restores_fake_timers": false, "risk": "low", "evidence": "retry sleep"},
    {"file": "artifacts/api-server/src/bot/batch-worker.ts:217,824", "type": "timeout", "created_in": "download abort + retry", "cleared_in": "abort or natural", "uses_fake_timers": false, "restores_fake_timers": false, "risk": "low", "evidence": "AbortController timers"}
  ],
  "uncleared_timer_risks": [
    "node-cron handles in artifacts/api-server/src/index.ts are NOT `.unref()`-ed and have no shutdown path. Any test that imports index.ts (directly or transitively) will leak them and prevent process exit without --test-force-exit.",
    "authMiddleware setInterval (line 43) has no .unref() check verified — would leak if its module is imported by a test."
  ]
}
```

No `useFakeTimers` / `MockTimers` / `t.mock.timers` usage was found in any test file.

---

## 11. Global State / Singletons

```json
{
  "global_state": [
    {
      "file": "lib/db/src/index.ts",
      "state_name": "pool",
      "state_type": "singleton (pg.Pool)",
      "mutated_by": ["every consumer"],
      "reset_method": "pool.end() — terminal, not resettable",
      "tests_call_reset": true,
      "risk": "critical",
      "evidence": "lib/db/src/index.ts:13"
    },
    {
      "file": "lib/integrations-anthropic-ai/src/client.ts",
      "state_name": "anthropic client",
      "state_type": "module-level cached singleton",
      "mutated_by": ["__setAnthropicClientForTesting"],
      "reset_method": "__setAnthropicClientForTesting(null)",
      "tests_call_reset": true,
      "risk": "high",
      "evidence": "line 34 (definition); used by per-leg-state.test.ts, sop-rewind.test.ts, audit-prompt-leg-counters.test.ts"
    },
    {
      "file": "artifacts/api-server/src/bot/batch-worker.ts",
      "state_name": "chromium impl",
      "state_type": "module-level override",
      "mutated_by": ["__setChromiumForTests"],
      "reset_method": "__setChromiumForTests(null)",
      "tests_call_reset": "uncertain (each call site responsible)",
      "risk": "high",
      "evidence": "line 525"
    },
    {
      "file": "artifacts/api-server/src/lib/batch-processor.ts",
      "state_name": "batch worker impl + activeBatches Map",
      "state_type": "module-level override + Map",
      "mutated_by": ["__setBatchWorkerForTests", "batch lifecycle"],
      "reset_method": "__setBatchWorkerForTests(null) + 24h timer",
      "tests_call_reset": "uncertain",
      "risk": "high",
      "evidence": "lines 874, 902, 913"
    },
    {
      "file": "artifacts/api-server/src/routes/response-tracker.ts",
      "state_name": "reply impl",
      "state_type": "module-level override",
      "mutated_by": ["__setReplyImplForTesting"],
      "reset_method": "__setReplyImplForTesting(null)",
      "tests_call_reset": "uncertain",
      "risk": "medium",
      "evidence": "line 39"
    },
    {
      "file": "artifacts/api-server/src/lib/email-send.ts",
      "state_name": "daily brief send impl",
      "state_type": "module-level override",
      "mutated_by": ["__setDailyBriefSendImplForTesting"],
      "reset_method": "__setDailyBriefSendImplForTesting(null)",
      "tests_call_reset": "uncertain",
      "risk": "medium",
      "evidence": "line 93"
    }
  ],
  "test_override_hooks": [
    {"file": "lib/integrations-anthropic-ai/src/client.ts", "hook": "__setAnthropicClientForTesting", "reset_hook": "(self, with null arg)", "used_by_tests": ["audit-prompt-leg-counters.test.ts","per-leg-state.test.ts","sop-rewind.test.ts"], "risk": "high"},
    {"file": "artifacts/api-server/src/bot/batch-worker.ts", "hook": "__setChromiumForTests", "reset_hook": "(self, null)", "used_by_tests": ["bot tests"], "risk": "high"},
    {"file": "artifacts/api-server/src/lib/batch-processor.ts", "hook": "__setBatchWorkerForTests", "reset_hook": "(self, null)", "used_by_tests": ["batch tests"], "risk": "high"},
    {"file": "artifacts/api-server/src/routes/response-tracker.ts", "hook": "__setReplyImplForTesting", "reset_hook": "(self, null)", "used_by_tests": ["response-matcher tests"], "risk": "medium"},
    {"file": "artifacts/api-server/src/lib/email-send.ts", "hook": "__setDailyBriefSendImplForTesting", "reset_hook": "(self, null)", "used_by_tests": ["daily-brief tests"], "risk": "medium"}
  ]
}
```

Notes:
- These overrides live on **module singletons**, but node:test runs each file in its own worker, so the singleton is **per-worker**. Risk materializes if (a) a worker batches multiple files (current node:test does run multiple files per worker pool) or (b) a test fails before its `after()` resets the singleton — subsequent tests in the same file/worker see stale state.

---

## 12. Mocking Behavior

```json
{
  "mocking_framework": "node:test built-in (`node --experimental-test-module-mocks`) for @workspace/claimclear; manual `__set*ForTesting` hooks for api-server; Playwright `page.route()` for e2e",
  "global_mocks": [
    {
      "file": "any test using __setAnthropicClientForTesting",
      "mocked_target": "@workspace/integrations-anthropic-ai default client",
      "restored": true,
      "restore_location": "after() with null arg",
      "risk": "high if test throws before after()"
    }
  ],
  "module_mocks": [
    {
      "framework": "node:test --experimental-test-module-mocks",
      "where_enabled": "@workspace/claimclear `test` script",
      "tests_using_t.mock.module": "uncertain — `rg t\\.mock` on api-server returned no matches; needs scan of claimclear suite"
    }
  ],
  "spies_not_restored_risks": [
    "Tests that call __set*ForTesting in `before()` rely on a single `after()` to restore. There is no `t.after`-style per-test cleanup — a thrown exception inside the `before()` body skips the `after()` registration in some patterns."
  ],
  "network_mocks": [
    "Playwright e2e suite stubs every /api/* via page.route() (per playwright.config.ts comment).",
    "No nock / msw / undici-mock-agent usage discovered."
  ],
  "date_timer_mocks": [
    "None. No useFakeTimers / MockTimers / t.mock.timers calls found anywhere."
  ]
}
```

---

## 13. Filesystem / Artifact Behavior

```json
{
  "filesystem_writes": [
    {
      "file": "artifacts/claimclear/playwright.config.ts (use.trace, use.screenshot)",
      "path_pattern": "artifacts/claimclear/test-results/**",
      "unique_per_test": true,
      "cleaned_before": false,
      "cleaned_after": false,
      "risk": "low (Playwright manages naming)",
      "evidence": "trace: 'retain-on-failure', screenshot: 'only-on-failure'"
    }
  ],
  "shared_artifact_risks": [
    "artifacts/claimclear/test-results/ accumulates over runs; never auto-pruned.",
    "artifacts/claimclear/dist/ + dist.bak/ — built once via webServer command (`pnpm run build`); reused via reuseExistingServer:true. Stale build can mask source changes between e2e runs."
  ]
}
```

No tests were found that write to `os.tmpdir()`, `mkdtemp`, or write fixture files at runtime.

---

## 14. Parallelism and Order-Dependence Risks

```json
{
  "parallel_unsafe_tests": [
    {
      "file": "artifacts/api-server/src/__tests__/submit-flow-gates.test.ts",
      "reason": "writes process.env.BOT_SERVICE_TOKEN at module load and never restores",
      "shared_resource": "process.env",
      "evidence": "line 31"
    },
    {
      "file": "artifacts/api-server/src/__tests__/endpoint-action-contract.test.ts",
      "reason": "writes process.env.BOT_SERVICE_TOKEN at module load and never restores",
      "shared_resource": "process.env",
      "evidence": "line 77"
    },
    {
      "file": "artifacts/api-server/src/__tests__/daily-brief-route-outcome.test.ts",
      "reason": "reads process.env.BOT_SERVICE_TOKEN at module load — captures whatever was set by an earlier test in the same worker",
      "shared_resource": "process.env",
      "evidence": "line 8 (`const TOKEN = process.env.BOT_SERVICE_TOKEN ?? \"\"`)"
    },
    {
      "file": "all api-server integration tests using @workspace/db",
      "reason": "share the same DATABASE_URL; per-id deletes only; pool.end() is terminal — first file to finish kills the pool for any later test in the same worker",
      "shared_resource": "Postgres pool + tables",
      "evidence": "Section 7"
    },
    {
      "file": "all tests using __setAnthropicClientForTesting / __setChromiumForTests / __setBatchWorkerForTests",
      "reason": "module singletons; mid-test failure leaves stale impls",
      "shared_resource": "module-level overrides",
      "evidence": "Section 11"
    },
    {
      "file": "artifacts/claimclear/e2e/*.spec.ts",
      "reason": "fullyParallel:false, workers:1, fixed port 5174 with reuseExistingServer:true — multiple e2e invocations from different shells will collide",
      "shared_resource": "port 5174 + dist/public artifact",
      "evidence": "playwright.config.ts"
    }
  ],
  "order_dependency_risks": [
    {"file": "daily-brief-route-outcome.test.ts", "risk_type": "env_leak", "description": "TOKEN value depends on whether a sibling test already mutated BOT_SERVICE_TOKEN", "evidence": "line 8"},
    {"file": "every test that imports @workspace/db", "risk_type": "shared_db_delete", "description": "Two tests inserting overlapping fixture rows (e.g. same hardcoded email) will collide; deletion is by id so collisions present as unique-constraint failures", "evidence": "TEST_USER email constants"},
    {"file": "*.test.ts using pool.end()", "risk_type": "singleton_leak", "description": "Calling pool.end() in a worker that is later asked to run another file (node:test reuses workers) will fail subsequent DB queries with 'Cannot use a pool after calling end on the pool'", "evidence": "Section 7"},
    {"file": "claimclear unit suite", "risk_type": "timer_leak", "description": "Suite uses --test-force-exit, indicating uncleaned setInterval/setTimeout/RAF in jsdom", "evidence": "package.json test script"},
    {"file": "playwright e2e", "risk_type": "port_conflict", "description": "Fixed port 5174 + reuseExistingServer:true means a stale build is silently reused across runs", "evidence": "playwright.config.ts"},
    {"file": "tests that toggle Anthropic / chromium / batch-worker", "risk_type": "singleton_leak", "description": "If after() doesn't run (failure), next test in same module sees stale stub", "evidence": "Section 11"}
  ]
}
```

---

## 15. Existing Cleanup Hooks

| File | Hook | What It Cleans | What It Does Not Clean | Risk |
|---|---|---|---|---|
| `artifacts/api-server/src/__tests__/portal-submissions-completed-elsewhere.test.ts` | `after` (file-level) | seeded rows by id; closes server; `pool.end()` | env vars; unrelated rows orphaned by mid-test crash | high |
| `artifacts/api-server/src/__tests__/group-attestation-history.test.ts` | `after` | server.close + pool.end + id-scoped deletes | same | high |
| `artifacts/api-server/src/__tests__/audit-prompt-leg-counters.test.ts` | `after` | `__setAnthropicClientForTesting(null)` + server close + pool.end | env; rows on partial failure | high |
| `artifacts/api-server/src/__tests__/per-leg-state.test.ts` | `after` | `__setAnthropicClientForTesting(null)` + server + pool | same | high |
| `artifacts/api-server/src/__tests__/sop-rewind.test.ts` | `after` (implied) | `__setAnthropicClientForTesting(null)` (per grep) | same | high |
| `artifacts/api-server/src/__tests__/submit-flow-gates.test.ts` | `after` | server + pool | **does NOT restore BOT_SERVICE_TOKEN** | high |
| `artifacts/api-server/src/__tests__/endpoint-action-contract.test.ts` | `after` | server + pool | **does NOT restore BOT_SERVICE_TOKEN** | high |
| `artifacts/claimclear/playwright.config.ts` | webServer | spawns built server | does not stop it (reuseExistingServer:true) | medium |
| All other api-server integration tests with `app.listen(0)` | `after` | server.closeAllConnections + close + pool.end | rows on partial failure; env | medium |

`rg "beforeEach|afterEach|beforeAll|afterAll|before\(|after\("` returned **95 hook invocations** across api-server + claimclear test suites — the dominant pattern is one `before` + one `after` per file. **No `beforeEach`/`afterEach` per-test isolation hooks were found in api-server tests.**

No global setup/teardown files exist (Section 1).

---

## 16. Candidate Stress Harness Design Inputs

```json
{
  "best_full_suite_command": "pnpm -r --if-present run test  (note: no root `test` script; this is the de-facto entry point)",
  "best_single_file_command_template": "pnpm --filter <pkg> exec env TZ=America/New_York node --import tsx --test <file>",
  "best_single_test_command_template": "pnpm --filter <pkg> exec env TZ=America/New_York node --import tsx --test --test-name-pattern='<regex>' <file>",
  "best_shuffle_command": "pnpm --filter <pkg> exec env TZ=America/New_York node --import tsx --test --test-shuffle <files>  (capture printed seed; reproduce with --test-shuffle-seed=<n>)",
  "best_json_output_command": "pnpm --filter <pkg> exec env TZ=America/New_York node --import tsx --test --test-reporter=junit --test-reporter-destination=junit.xml <files>",
  "stress_axes_to_try": [
    "shuffle_order",
    "repeat_full_suite",
    "serial_vs_parallel  (--test-concurrency=1 vs default)",
    "random_seed",
    "isolated_failed_file_reruns",
    "env_variation  (BOT_SERVICE_TOKEN set/unset; TZ=UTC vs America/New_York vs Asia/Tokyo)",
    "db_seed_reset_variation  (run against fresh DB vs DB primed with prior-run leftovers)",
    "port_randomization  (E2E_PORT for playwright; api-server tests already use port 0)"
  ],
  "must_capture_per_run": [
    "stdout",
    "stderr",
    "exit_code",
    "failed_file",
    "failed_test_name",
    "random_seed (printed by --test-shuffle)",
    "duration",
    "env_snapshot_redacted (DATABASE_URL host only, BOT_SERVICE_TOKEN length only, TZ, NODE_OPTIONS)",
    "open_handles_if_available  (run without --test-force-exit and detect hang)",
    "DB row counts pre/post per shared table (claims, invoice_groups, portal_submissions, audit_logs)"
  ],
  "likely_first_failures_to_surface": [
    "Cannot use a pool after calling end on the pool  (when worker is reused after pool.end)",
    "BOT_SERVICE_TOKEN mismatch in daily-brief-route-outcome.test.ts depending on file order",
    "Postgres unique-constraint violations from hardcoded TEST_USER email or hardcoded ids when prior runs left rows",
    "EADDRINUSE on port 5174 if the e2e built server is already running",
    "Test process hanging without --test-force-exit (claimclear suite) — indicates uncleaned timers/handles",
    "Stale Anthropic/Chromium/BatchWorker stub leaking across tests when an earlier test throws before its `after()` resets the singleton",
    "Cron-related leaks if any future test imports artifacts/api-server/src/index.ts"
  ]
}
```

---

## 17. Top Risks Ranked

| Rank | Risk | Evidence | Likely Symptom | Suggested Harness Probe |
|---|---|---|---|---|
| 1 | Shared production-shaped Postgres pool reused by every integration test in @workspace/api-server with no transactional isolation and per-id-only cleanup | `lib/db/src/index.ts:13`; ~25 files calling `app.listen(0)` + `pool.end()` | Unique-constraint errors, intermittent missing rows, pool-after-end errors when shuffled | Repeat full suite with `--test-shuffle`; pre/post-snapshot row counts of `claims`, `invoice_groups`, `portal_submissions`, `audit_logs` |
| 2 | `pool.end()` called per file on a module singleton; node:test workers can be reused → second file in same worker gets a closed pool | `pool.end()` calls in 6+ files | "Cannot use a pool after calling end" failures dependent on order | Run with `--test-concurrency=1` to force worker reuse; compare to default |
| 3 | `process.env.BOT_SERVICE_TOKEN` written without restore by 2 files; read at module load by another | `submit-flow-gates.test.ts:31`, `endpoint-action-contract.test.ts:77`, `daily-brief-route-outcome.test.ts:8` | `daily-brief-route-outcome` token check passes/fails based on file order | Shuffle the api-server suite repeatedly; correlate seed with fail/pass of `daily-brief-route-outcome` |
| 4 | `--test-force-exit` masks open handles in the @workspace/claimclear unit suite | `artifacts/claimclear/package.json` test script | Hangs / process never exits if flag removed; potential zombie timers writing to mocked DOM | Run claimclear suite without `--test-force-exit`; if it hangs, capture `process._getActiveHandles()` |
| 5 | Module-singleton overrides (`__setAnthropicClientForTesting`, `__setChromiumForTests`, `__setBatchWorkerForTests`, `__setReplyImplForTesting`, `__setDailyBriefSendImplForTesting`) reset only in file-level `after()` | grep matches in Section 11 | Mid-suite throw → next test sees prior stub; cross-file leakage if worker is reused | Inject a synthetic throw inside one of the `before()`s under shuffle and verify whether downstream tests detect the stale stub |
| 6 | No separate test database — tests run against `DATABASE_URL` (often dev DB) | `lib/db/src/index.ts:7-13`; absence of `TEST_DATABASE_URL` anywhere | Concurrent dev usage corrupts results; data persists between runs | Probe by running suite twice back-to-back without manual cleanup; diff row counts |
| 7 | Playwright e2e uses fixed port 5174 with `reuseExistingServer: true` and a stale `dist/public` | `playwright.config.ts` | Stale build hides regressions; EADDRINUSE on collision | Probe by deleting `dist/` between runs and by setting `E2E_PORT=$(get-free-port)` |
| 8 | Cron jobs in `artifacts/api-server/src/index.ts` are not `.unref()` and have no shutdown — test may import it transitively | `index.ts:243…405` (8 schedules) | Open-handle leak; cron firing during tests mutates DB | Static-import audit: rerun suite while logging which test loaded `src/index.ts` |
| 9 | Hardcoded fixture identifiers (TEST_USER email, TEST_BOT_TOKEN strings) | Section 7 | Unique-constraint collisions between concurrent runners or after partial cleanup | Run suite twice concurrently against the same DB; observe duplicate-key errors |
| 10 | No CI runs the test suite at all | Section 4 | All flake/order discovery has been ad-hoc; regressions land unblocked | Probe by running shuffled full suite N times in a row and recording failure-rate baseline |

---

## 18. Missing Information

```json
{
  "missing": [
    {"item": "Existence of a dedicated TEST_DATABASE_URL or test schema", "why_needed": "Determines whether harness can safely TRUNCATE between runs", "how_to_collect": "Ask owner: is there a separate DB for tests? Inspect Replit secrets for TEST_DATABASE_URL."},
    {"item": "Whether claimclear unit suite uses node:test --experimental-test-module-mocks via t.mock.module", "why_needed": "Determines whether mocks leak across files in the same worker", "how_to_collect": "rg 't\\.mock\\.module|mock\\.module' artifacts/claimclear/src — currently returned no matches; confirm by walking each test file"},
    {"item": "Concrete recent CI-style test runs / failure history", "why_needed": "There is no CI; without history, the harness cannot baseline flake rates", "how_to_collect": "Ask the team for any local scratch logs in /tmp/logs or screenshot/exports directories"},
    {"item": "Which api-server tests transitively import src/index.ts (and thus spin cron schedules)", "why_needed": "Cron leaks could explain hangs / DB churn", "how_to_collect": "Run each test file with `--cpu-prof` or instrument node-cron's schedule() with a console.log and rerun the suite"},
    {"item": "Whether `pool` re-imports refresh the singleton per worker or share via a module cache", "why_needed": "Determines blast radius of pool.end()", "how_to_collect": "Add a one-shot test that calls pool.end() then a sibling file that queries; observe error"},
    {"item": "Behavior of node:test worker reuse policy in this Node version (24.x)", "why_needed": "Determines whether one file can poison another via singletons", "how_to_collect": "node --experimental-test-isolation=process|none probe; capture worker pids per test"},
    {"item": "Whether `vitest`-style global setup is needed for jsdom in claimclear suite", "why_needed": "May explain --test-force-exit need", "how_to_collect": "Search src for `import 'jsdom'` global setup; confirm absence and impact"},
    {"item": "Total wall-clock duration of each per-package test suite", "why_needed": "Repeat-N×N harness sizing", "how_to_collect": "Run each package's test once, record duration; not collected by this report (no execution performed)"}
  ]
}
```

---

## 19. Notes (per Final Output Rules)

- All file paths above are exact relative paths from repo root.
- All quoted commands are copy-pasteable.
- No secrets are present; environment variable values are referenced by name only (`DATABASE_URL`, `BOT_SERVICE_TOKEN`, etc.) — none of their values are in this report.
- No fixes recommended.
- No harness designed yet.
- No code modified.
- "Uncertain" is used wherever a determination required execution rather than static inspection.
