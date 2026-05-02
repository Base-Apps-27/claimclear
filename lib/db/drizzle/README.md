# `lib/db/drizzle/` — drift-check artifacts only

**The SQL files in this directory are NEVER executed against any
database.** They exist solely so the
[schema-drift check](../scripts/check-schema-drift.sh) can verify that
the Drizzle schema in `lib/db/src/schema/` and the executed SQL
migrations in `lib/db/migrations/` agree about the live shape of the
database.

## What runs against the database

The single source of truth for production schema changes is
`lib/db/migrations/*.sql`, applied (in lexicographic order) by
[`apply-migrations.mjs`](../scripts/apply-migrations.mjs). That runner
tracks applied files in a `__schema_migrations` table and is what every
deploy invokes.

## What's in this directory

`drizzle-kit generate` is run after every Drizzle schema change. It
emits a SQL file here describing the *minimal* statement that would
bring an empty database to the new schema state, plus a snapshot under
`meta/`. The schema-drift check re-runs `drizzle-kit generate` against
a scratch directory and `diff`s its output with what's already here —
if the diff is empty, schema and migrations are in sync. If anyone
edits the schema without regenerating these files, the drift check
fails in CI / pre-commit.

## ⚠ These statements may be UNSAFE if executed directly

Because `drizzle-kit generate` reasons only about the *desired* schema
and not the *current* data, it produces statements like:

```sql
ALTER TABLE "claims" ALTER COLUMN "date" SET DATA TYPE date;
```

without a `USING ...` clause. That bare statement would fail on a
production database that contains empty strings or non-ISO text for
the column. The corresponding hand-written migration in
`lib/db/migrations/0022_typed_claims_date.sql` carries a defensive
`USING (CASE ... END)` cast that mirrors `normalizeServiceDate`, so
the executed conversion is safe even on dirty data. The file here is
just a structural fingerprint — do not run it.

## If you need to make a schema change

1. Edit `lib/db/src/schema/*.ts`.
2. Hand-write a numbered SQL migration in `lib/db/migrations/`
   (e.g. `0023_my_change.sql`) — this is what gets applied.
3. Regenerate the drift artifact:
   `pnpm --filter @workspace/db exec drizzle-kit generate \
     --dialect postgresql --schema ./src/schema/index.ts \
     --out ./drizzle --breakpoints`.
4. Verify drift: `pnpm --filter @workspace/db run check-drift`.
