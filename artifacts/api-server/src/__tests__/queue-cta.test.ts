// Task #660 V3 — deep-link contract test for the api-server's
// `queueGroupHref` / `queueLegHref` helpers, used by every walk/submit
// CTA the server ships (operator daily brief, future emails / SSE
// payloads). Asserts the produced URL matches the contract regex
// `/queue?group=<gid>(&leg=<lid>)?` exactly so the URL shape cannot
// drift away from what the queue page parses.

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { queueGroupHref, queueLegHref } from "../lib/queue-cta";

const QUEUE_HREF_RE = /^\/queue\?group=(\d+)(?:&leg=(\d+))?$/;

test("queueGroupHref produces /queue?group=<id>", () => {
  const href = queueGroupHref(42);
  assert.equal(href, "/queue?group=42");
  const m = QUEUE_HREF_RE.exec(href);
  assert.ok(m, "must match queue href contract");
  assert.equal(m![1], "42");
  assert.equal(m![2], undefined);
});

test("queueLegHref produces /queue?group=<gid>&leg=<lid>", () => {
  const href = queueLegHref(7, 199);
  assert.equal(href, "/queue?group=7&leg=199");
  const m = QUEUE_HREF_RE.exec(href);
  assert.ok(m, "must match queue href contract");
  assert.equal(m![1], "7");
  assert.equal(m![2], "199");
});

test("brief-personalization uses the helpers (no inline detail-page hrefs apart from the documented orphan fallback)", async () => {
  const { readFileSync } = await import("node:fs");
  const { resolve } = await import("node:path");
  const src = readFileSync(
    resolve(import.meta.dirname, "..", "lib", "brief-personalization.ts"),
    "utf8",
  );
  // Every retargeted call site must use the helper.
  assert.match(src, /queueGroupHref\(/);
  assert.match(src, /queueLegHref\(/);
  // The only allowed `/claims/${...}` literals are the orphan-leg
  // safety fallbacks (preceded by a `:` ternary alternate). There
  // must be no remaining `/invoice-groups/${...}` literal — the
  // group-scoped href has no orphan branch.
  const claimsLiteral = /["`']\/claims\/\$\{[^}]+\}/g;
  const groupsLiteral = /["`']\/invoice-groups\/\$\{[^}]+\}/g;
  const claimsHits = src.match(claimsLiteral) ?? [];
  const groupsHits = src.match(groupsLiteral) ?? [];
  assert.equal(
    groupsHits.length,
    0,
    "brief-personalization.ts must not emit /invoice-groups/:id literals",
  );
  // Two orphan fallbacks expected (recentlyTouched + needsReview).
  assert.equal(
    claimsHits.length,
    2,
    `brief-personalization.ts may only contain the two documented orphan-leg /claims/:id fallbacks (got ${claimsHits.length})`,
  );
});
