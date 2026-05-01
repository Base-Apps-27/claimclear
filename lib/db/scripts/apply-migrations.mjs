#!/usr/bin/env node
// Idempotent SQL migration runner.
//
// Reads every `*.sql` file in `lib/db/migrations/` (lexicographic order),
// applies any that have not yet been recorded in the `__schema_migrations`
// table, and inserts a marker row on success. Each migration runs in its
// own connection — the migration file is responsible for its own
// transaction (BEGIN/COMMIT) so it can group multiple statements atomically.
//
// Why this exists (and not `drizzle-kit push --force`):
//   * `drizzle-kit push` prompts interactively for ambiguous renames;
//     `--force` only skips data-loss prompts. In a non-TTY build the prompt
//     hangs / exits without applying the schema, so deploys silently no-op
//     against the production DB. See May-2026 production incident.
//   * `drizzle-kit migrate` is non-interactive but expects drizzle-kit's
//     own snapshot/journal format, which we don't yet have a baseline for.
//
// Usage: node lib/db/scripts/apply-migrations.mjs
// Env:   DATABASE_URL must be set.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MIGRATIONS_DIR = path.resolve(__dirname, "..", "migrations");

const log = (...args) => console.log("[migrate]", ...args);
const fail = (msg, err) => {
  console.error("[migrate] FATAL:", msg);
  if (err) console.error(err);
  process.exit(1);
};

if (!process.env.DATABASE_URL) {
  fail("DATABASE_URL is not set. Cannot run migrations.");
}

if (!fs.existsSync(MIGRATIONS_DIR)) {
  fail(`Migrations directory not found at ${MIGRATIONS_DIR}.`);
}

const sqlFiles = fs
  .readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort();

if (sqlFiles.length === 0) {
  log("No migration files found. Nothing to do.");
  process.exit(0);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS __schema_migrations (
        id TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    const { rows } = await client.query(
      "SELECT id FROM __schema_migrations ORDER BY id;",
    );
    const applied = new Set(rows.map((r) => r.id));
    log(`Found ${applied.size} migration(s) already applied.`);
    log(`Found ${sqlFiles.length} migration file(s) on disk.`);

    let appliedCount = 0;
    for (const file of sqlFiles) {
      if (applied.has(file)) {
        log(`SKIP ${file} (already applied)`);
        continue;
      }
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
      log(`APPLY ${file} (${sql.length} bytes)…`);
      const t0 = Date.now();
      try {
        await client.query(sql);
      } catch (err) {
        fail(`Migration ${file} failed.`, err);
      }
      // Record in its own statement so the migration file's own COMMIT (if
      // any) doesn't roll back the marker insert. We intentionally insert
      // AFTER the migration's transaction has committed.
      await client.query(
        "INSERT INTO __schema_migrations (id) VALUES ($1) ON CONFLICT DO NOTHING;",
        [file],
      );
      log(`OK    ${file} (${Date.now() - t0}ms)`);
      appliedCount += 1;
    }

    log(`Done. Applied ${appliedCount} new migration(s).`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => fail("Unexpected error", err));
