# SQL queries used to build this report

Two files:

- `01_scope_window.sql` — used during scope discovery to confirm Saturday
  May 9, 2026 (EDT) is the load-test window and to identify the operator set
  vs. accounts to exclude.
- `02_raw_dumps.sql` — the eight pulls that populate `../raw/*.json`. Audit
  logs are chunked by 30-min slices because the 18:00–20:00 UTC peak
  (~2,400 rows in 2 h) was too large for a single round-trip via the
  database tool. All other tables fit in one call.

The dump driver wraps each query in `SELECT jsonb_agg(t) FROM (…) t` and
streams the resulting array to `../raw/<table>.json`. To regenerate from
production, run each query in `02_raw_dumps.sql` against the production
read-replica via the database skill (the chunked audit-logs loop lives at
the top of `../scripts/analyze.mjs`'s sibling commit history; the
script is **not** a runtime dependency of `analyze.mjs`). Then:

```bash
# Mirror raw JSON dumps to CSVs (so spreadsheets / SQL clients can use them
# directly without going through Node).
node reports/saturday-load-test-mining/scripts/json_to_csv.mjs

# Re-analyze (deterministic, no DB access required — reads only ../raw/).
node reports/saturday-load-test-mining/scripts/analyze.mjs
```

`analyze.mjs` only reads `../raw/*.json` and writes to `../*` — no network
or DB access — so it is safe to re-run from any environment.
