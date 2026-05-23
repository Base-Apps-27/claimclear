// Task #842. Bot mutation HTTP wrapper.
//
// Every bot-originated mutation (currently just `/responses/record-portal`,
// the only HTTP boundary the bot crosses for writes — submit/retry are
// in-process and use the in-process idempotency path) goes through
// `botMutationFetch` so it always carries:
//
//   - `x-bot-token` — the existing service-token auth.
//   - `Idempotency-Key` — derived from `(entityId, action, day-bucket)`
//     via `computeIdempotencyKey`. The server persists it on insert and
//     a partial unique index rejects a second insert with the same key
//     as 409 + `code:"duplicate_idempotency_key"`.
//
// A 409 with that typed code is treated as success-on-retry: the first
// call already won, so the bot logs it and moves on instead of
// surfacing it as an error.

import { logger } from "./logger";
import { computeIdempotencyKey, IDEMPOTENCY_HEADER, DUPLICATE_IDEMPOTENCY_KEY_CODE } from "./idempotency";

export interface BotMutationOptions {
  /** Stable id of the entity being mutated. */
  entityId: number | string;
  /** Short verb identifying the mutation. */
  action: string;
  /** Optional discriminator hashed into the key. */
  extra?: string | null;
  /** Day bucket override (tests). */
  bucket?: string;
  /** Override the computed key entirely (rarely needed; tests). */
  idempotencyKey?: string;
}

export interface BotMutationResponse {
  ok: boolean;
  /** 200/204 from the server, OR `true` when a 409 collapsed to a no-op. */
  effectivelyOk: boolean;
  status: number;
  data: unknown;
  /** The key that was sent on the wire, for logging. */
  idempotencyKey: string;
  /** True when the server returned 409 + `code:"duplicate_idempotency_key"`. */
  duplicate: boolean;
}

export type FetchLike = typeof fetch;

let __fetchImpl: FetchLike | null = null;
/** Test seam: stub the underlying fetch without monkey-patching the global. */
export function __setBotMutationFetchForTests(fn: FetchLike | null): void {
  __fetchImpl = fn;
}

/**
 * POST `body` to `url` as a bot mutation. Adds the bot token + the
 * idempotency header. A 409 carrying `code:"duplicate_idempotency_key"`
 * is folded into `{ effectivelyOk: true, duplicate: true }` so callers
 * can treat it as success-on-retry without inspecting the body.
 */
export async function botMutationFetch(
  url: string,
  body: Record<string, unknown>,
  opts: BotMutationOptions,
): Promise<BotMutationResponse> {
  const key = opts.idempotencyKey ?? computeIdempotencyKey({
    entityId: opts.entityId,
    action: opts.action,
    bucket: opts.bucket,
    extra: opts.extra ?? null,
  });
  const f = __fetchImpl ?? fetch;
  const res = await f(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-bot-token": process.env.BOT_SERVICE_TOKEN ?? "",
      [IDEMPOTENCY_HEADER]: key,
    },
    body: JSON.stringify(body),
  });
  let data: unknown;
  try { data = await res.json(); } catch { data = null; }
  const duplicate = res.status === 409
    && !!data
    && typeof data === "object"
    && (data as { code?: unknown }).code === DUPLICATE_IDEMPOTENCY_KEY_CODE;
  if (duplicate) {
    logger.info(
      { url, idempotencyKey: key, action: opts.action, entityId: opts.entityId },
      "bot-mutation: server rejected duplicate idempotency key — treating as success-on-retry",
    );
  }
  return {
    ok: res.ok,
    effectivelyOk: res.ok || duplicate,
    status: res.status,
    data,
    idempotencyKey: key,
    duplicate,
  };
}
