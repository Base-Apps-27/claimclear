# Test Stability Harness — API Server (Phase 1)

## Purpose

This harness exists to **expose** order-dependent, parallelism-dependent,
DB-state, env-leak, pool-lifecycle, and singleton-leak failures in the
`@workspace/api-server` test suite. It is **diagnostic**, not corrective:
it does not modify product code, does not patch tests, and does not change
the existing `test` script.

Outputs land under:

```
artifacts/test-stability/api-server/
├── run-<ts>-<n>.log          # full stdout+stderr per run
├── summary.json              # machine-readable session record
├── report.md                 # human-readable rollup (rendered on demand)
└── isolation/
    └── iso-<file>-<ts>-<n>.log
```

## Why api-server is the first target

The discovery report (`reports/test-instability-discovery.md`) ranked
api-server's instability risk highest because:

- A single `pg.Pool` from `@workspace/db` is shared by every integration test.
- Tests connect to whatever `DATABASE_URL` is set (no `TEST_DATABASE_URL`).
- No transactional isolation, no rollback, no global truncate.
- Many tests call `pool.end()` at file teardown — terminal on a singleton.
- `process.env.BOT_SERVICE_TOKEN` is mutated and never restored.
- `daily-brief-route-outcome` reads `BOT_SERVICE_TOKEN` at module load.
- Module-level overrides (`__setAnthropicClientForTesting`,
  `__setChromiumForTests`, `__setBatchWorkerForTests`,
  `__setReplyImplForTesting`, `__setDailyBriefSendImplForTesting`) reset
  only in file-level `after()` hooks.
- `node:test` runs files in parallel by default with no global setup/teardown.

Phase 1 just measures these. Phase 2+ fixes them.

## Commands

| Script | Mode | Description |
|---|---|---|
| `pnpm run test:stability:api` | default-parallel | Mirrors the production `test` command, repeated N times. |
| `pnpm run test:stability:api:shuffle` | shuffle | Harness-seeded Fisher-Yates shuffle of the file list (Node 24.13 here lacks `--test-shuffle`). Seed is recorded per run and reproducible via `STABILITY_SEED=<n>`. |
| `pnpm run test:stability:api:serial` | serial | Adds `--test-concurrency=1`. Forces worker reuse. |
| `pnpm run test:stability:api:suspects` | suspect-files | Runs only `scripts/test-stability/api-server-suspect-files.json` under shuffle. |
| `pnpm run test:stability:api:report` | (renderer) | Reads `summary.json`, writes `report.md`. |

### Environment knobs

| Var | Default | Meaning |
|---|---|---|
| `STABILITY_RUNS` | 10 | Number of repetitions per session. |
| `STABILITY_FAIL_FAST` | false | Stop session on first failed run. |
| `STABILITY_LOG_DIR` | `artifacts/test-stability/api-server` | Output dir. |
| `STABILITY_PATTERN` | (none) | Regex applied to file list (or single-file path in `single-file` mode). |
| `STABILITY_MODE` | shuffle | One of `shuffle`, `repeat`, `serial`, `default-parallel`, `suspect-files`, `single-file`. |
| `STABILITY_CONCURRENCY` | (none) | Force `--test-concurrency=N` on top of mode flags. |
| `STABILITY_ISOLATION_RERUNS` | 3 | Times each failed file is rerun in isolation. |
| `STABILITY_ENV_VARIANT` | (none) | `no-bot-token` or `tz-utc` to perturb the env. |
| `STABILITY_JSON_REPORT` | true | (always on currently) |
| `STABILITY_DB_SNAPSHOT` | true | If `DATABASE_URL` set, snapshot row counts pre/post each run. |
| `STABILITY_RUN_TIMEOUT_MS` | 900000 | Per-run hard kill timeout (15 min). |

### Examples

Suspect stress (recommended first probe):
```
STABILITY_RUNS=5 pnpm run test:stability:api:suspects
pnpm run test:stability:api:report
```

Full shuffle smoke:
```
STABILITY_RUNS=3 pnpm run test:stability:api:shuffle
pnpm run test:stability:api:report
```

Serial stress (forces worker reuse, surfaces `pool_after_end`):
```
STABILITY_RUNS=3 pnpm run test:stability:api:serial
pnpm run test:stability:api:report
```

## How to interpret the report

### `likelyOrderDependent`
Set on an isolation rerun entry when the file failed in the full suite
but passed in every isolation rerun. This is the strongest signal of a
cross-file leak (DB, env, module singleton).

### DB row-count deltas
The harness counts rows in `claims`, `invoice_groups`,
`portal_submissions`, `portal_batch_runs`, `audit_logs`, `users`,
`attestations` before and after each run. A non-zero delta means a test
crashed before its `after()` cleanup and orphaned rows. A growing trend
across runs guarantees future flakes from unique-constraint collisions
on hardcoded fixture identifiers (e.g. `completed-elsewhere-tester@example.com`).

### `pool_after_end`
Detected from text like `Cannot use a pool after calling end on the pool`.
Caused by a `node:test` worker being reused for a second file after the
first file already called `pool.end()` on the shared singleton. Surfaces
under `serial` mode most reliably.

### `env_leak`
Detected when the failure correlates with `BOT_SERVICE_TOKEN`,
`x-bot-token`, or `401`. Most likely culprits: `submit-flow-gates.test.ts`
and `endpoint-action-contract.test.ts` overwrite `BOT_SERVICE_TOKEN`
without restoring it; `daily-brief-route-outcome.test.ts` captures
`BOT_SERVICE_TOKEN` at module load.

### `singleton_leak`
Detected when failure mentions `Anthropic`, `chromium`, `BatchWorker`,
or `__set*ForTest`. A `before()` that throws will skip the matching
`after()` reset, leaving the module singleton stale for any later test
in the same worker.

### `server_handle_leak`
Detected from `EADDRINUSE`, `process did not exit`, or `open handles`.
Most often points at a missed `server.close()`, a leaked `setInterval`,
or a transitive import of `artifacts/api-server/src/index.ts` (which
schedules 8 cron jobs at module load).

## Quarantine policy

Do **not** quarantine a flaky test until all four of these are recorded
in the PR / commit message:

1. **File**: exact path of the offending test file.
2. **Root cause**: tag from the harness (`pool_after_end`, `env_leak`,
   `db_unique_collision`, `db_missing_seed`, `server_handle_leak`,
   `singleton_leak`, `timeout`) plus a one-line explanation.
3. **Owner**: a named human responsible for the fix.
4. **Re-enable criteria**: the concrete signal that proves the fix works
   (e.g. "10 consecutive shuffled runs pass with seed variance >= 100").

A `t.skip()` or commented-out test without all four is a regression.

## Phase 1 scope (what this harness does NOT do)

- Does not introduce a global test DB reset.
- Does not remove `pool.end()` from any test.
- Does not restore `BOT_SERVICE_TOKEN` for the test process.
- Does not refactor singletons.
- Does not add CI.
- Does not run Playwright / e2e.
- Does not target other workspaces (claimclear unit tests, scripts, libs).

Phase 2 will pick the highest-frequency root cause from Phase 1 reports
and fix exactly that, with regression coverage from this same harness.
