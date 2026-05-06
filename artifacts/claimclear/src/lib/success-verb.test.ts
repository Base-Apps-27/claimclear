// Tests for the success-verb pool (Task #494). The helper has to
// always return a verb from the curated pool and respect a custom
// rng, so the picker never panics on out-of-range floor() results.

import { test } from "node:test";
import { strict as assert } from "node:assert";

const { pickSuccessVerb, SUCCESS_VERBS } = await import("./success-verb");

test("pickSuccessVerb always returns a verb from the curated pool", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 200; i++) seen.add(pickSuccessVerb());
  for (const v of seen) {
    assert.ok(
      (SUCCESS_VERBS as readonly string[]).includes(v),
      `unexpected verb: ${v}`,
    );
  }
});

test("pickSuccessVerb honors a custom rng (deterministic pick)", () => {
  // rng() = 0 → index 0; rng() ≈ 1 → last index (clamped).
  assert.equal(pickSuccessVerb(() => 0), SUCCESS_VERBS[0]);
  assert.equal(
    pickSuccessVerb(() => 0.999999),
    SUCCESS_VERBS[SUCCESS_VERBS.length - 1],
  );
});

test("pickSuccessVerb clamps a rng() result of exactly 1.0", () => {
  // Math.floor(1 * len) === len, which would be off-by-one without
  // the clamp. Verify the helper still returns a real verb.
  const v = pickSuccessVerb(() => 1);
  assert.ok((SUCCESS_VERBS as readonly string[]).includes(v));
});

test("SUCCESS_VERBS pool stays curated and small", () => {
  // The whole point of the pool is restraint — guard against future
  // drift to a 30-verb pile.
  assert.ok(SUCCESS_VERBS.length >= 3 && SUCCESS_VERBS.length <= 8);
  assert.ok((SUCCESS_VERBS as readonly string[]).includes("Saved"));
});
