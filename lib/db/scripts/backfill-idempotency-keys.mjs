#!/usr/bin/env node
// Task #842. One-shot backfill: populate `idempotency_key` on the
// pre-existing rows where the key can be derived from the same
// `(entityId, action, day-bucket, extra)` recipe the bot client uses
// going forward. Only `portal_responses` rows have a derivable key
// today — they have `submission_id`, a canonical action
// ("record_portal_response"), a `received_at` day-bucket, and the
// `external_message_id` discriminator.
//
// `audit_logs` and `portal_submissions` are intentionally left null on
// historical rows: their key shape is per-action (different verb,
// different discriminator) and stamping a synthetic key after the fact
// could trip the partial unique index against a future legitimate
// retry. The partial index excludes NULL, so untouched historical rows
// stay safely outside the duplicate-guard.
//
// Idempotent: skips rows that already have a key, and uses the same
// deterministic recipe as the runtime so re-running converges. Run
// with `--apply` to write; otherwise prints a dry-run summary.
//
// Usage:
//   node lib/db/scripts/backfill-idempotency-keys.mjs            # dry-run
//   node lib/db/scripts/backfill-idempotency-keys.mjs --apply     # write

import crypto from "node:crypto";
import pg from "pg";

const APPLY = process.argv.includes("--apply");

const ACTION = "record_portal_response";

function dayBucket(date) {
  return date.toISOString().slice(0, 10);
}

// MUST match `computeIdempotencyKey` in artifacts/api-server/src/lib/idempotency.ts.
function computeKey({ entityId, action, bucket, extra }) {
  const raw = `${entityId}|${action}|${bucket}|${extra ?? ""}`;
  const hash = crypto.createHash("sha256").update(raw).digest("hex").slice(0, 32);
  return `bot_${bucket}_${action}_${hash}`;
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: databaseUrl });

async function main() {
  console.log(`[backfill-idempotency-keys] mode=${APPLY ? "APPLY" : "DRY-RUN"}`);

  const { rows } = await pool.query(`
    SELECT id, submission_id, external_message_id, received_at
      FROM portal_responses
     WHERE idempotency_key IS NULL
       AND submission_id IS NOT NULL
     ORDER BY id ASC
  `);
  console.log(`[backfill-idempotency-keys] candidate rows: ${rows.length}`);

  let updated = 0;
  let collisions = 0;
  let skipped = 0;
  for (const row of rows) {
    const bucket = dayBucket(new Date(row.received_at));
    const key = computeKey({
      entityId: row.submission_id,
      action: ACTION,
      bucket,
      extra: row.external_message_id ?? null,
    });
    if (!APPLY) {
      updated += 1;
      continue;
    }
    try {
      const res = await pool.query(
        `UPDATE portal_responses
            SET idempotency_key = $1
          WHERE id = $2
            AND idempotency_key IS NULL`,
        [key, row.id],
      );
      if (res.rowCount === 1) updated += 1;
      else skipped += 1;
    } catch (err) {
      // 23505 = unique violation — another historical row already has
      // this exact derived key (true duplicate). Leave NULL so we
      // don't lose either row; surface for manual review.
      if (err && err.code === "23505") {
        collisions += 1;
        console.warn(
          `[backfill-idempotency-keys] collision on portal_responses.id=${row.id} key=${key} — leaving NULL`,
        );
      } else {
        throw err;
      }
    }
  }

  console.log(
    `[backfill-idempotency-keys] done: ${APPLY ? "updated" : "would-update"}=${updated} skipped=${skipped} collisions=${collisions}`,
  );
  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  await pool.end().catch(() => undefined);
  process.exit(1);
});
