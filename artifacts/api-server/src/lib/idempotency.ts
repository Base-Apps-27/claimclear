// Task #842. Idempotency-key helpers shared between the bot client
// wrapper (which sets the `Idempotency-Key` header) and the server
// routes (which persist the key and translate Postgres unique
// violations into 409 + `code:"duplicate_idempotency_key"`).
//
// The key is intentionally deterministic: `(entityId, action,
// dayBucket)` produces the same string on every retry within the same
// UTC day, so the partial unique index on each target table will reject
// a second insert with the same key — even if the bot retries days
// after the original POST happened to succeed.
//
// Pure & dependency-free so it's safe to import from both the
// orchestrator (Node) and any future browser-side caller, and trivially
// unit-testable without touching the DB.

import crypto from "node:crypto";

/** Header name carrying the idempotency key on bot mutation calls. */
export const IDEMPOTENCY_HEADER = "Idempotency-Key";

/** Typed error code the server returns when the partial unique index trips. */
export const DUPLICATE_IDEMPOTENCY_KEY_CODE = "duplicate_idempotency_key";

/** UTC day-bucket in `YYYY-MM-DD` form. Centralised so the bot and any
 *  future operator-side caller agree on the boundary. */
export function dayBucket(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Compute a deterministic idempotency key for a bot mutation.
 *
 * Inputs:
 *  - `entityId` — the primary key of the row the mutation targets
 *    (submission id, group id, audit subject, ...).
 *  - `action` — short verb identifying what the mutation does
 *    (`record_portal_response`, `submit`, `retry`, ...).
 *  - `bucket` — defaults to today's UTC day. Tests pass a fixed value.
 *  - `extra` — optional discriminator (e.g. external message id) so two
 *    distinct logical events on the same entity/action/day don't
 *    collide. Hashed so the key length stays bounded.
 *
 * The output is a short, URL-safe string so it can be logged in the
 * clear and round-tripped through an HTTP header without escaping.
 */
export function computeIdempotencyKey(opts: {
  entityId: number | string;
  action: string;
  bucket?: string;
  extra?: string | null;
}): string {
  const bucket = opts.bucket ?? dayBucket();
  const raw = `${opts.entityId}|${opts.action}|${bucket}|${opts.extra ?? ""}`;
  // SHA-256 truncated to 16 bytes (32 hex chars) — collision probability
  // for this surface is negligible and the key fits cleanly in a header.
  const hash = crypto.createHash("sha256").update(raw).digest("hex").slice(0, 32);
  return `bot_${bucket}_${opts.action}_${hash}`;
}

/**
 * Detect Postgres `unique_violation` (SQLSTATE 23505) on the
 * idempotency-key partial index. Drizzle surfaces the raw `pg` error
 * with `code` and `constraint` fields.
 */
export function isIdempotencyKeyDuplicate(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: string; constraint?: string };
  if (e.code !== "23505") return false;
  if (!e.constraint) return false;
  return e.constraint.endsWith("idempotency_key_uidx");
}
