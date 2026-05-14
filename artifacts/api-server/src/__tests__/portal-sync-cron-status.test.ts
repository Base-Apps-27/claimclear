// Task #738. Regression tests for the cron-status decision the
// `portal_response_sync` callback sends to `recordCronRun`. This is
// the function that decides whether a sweep paints the System Health
// rollup tile green/amber/red. The decision logic was reorganized
// after a code-review found "all-error" sweeps were incorrectly
// surfacing as amber instead of red.

import { test } from "node:test";
import { strict as assert } from "node:assert";

import { derivePortalSyncCronStatus } from "../lib/portal-response-sync";

test("derivePortalSyncCronStatus: zero considered → degraded (quiet tick is amber, distinct from a successful sweep)", () => {
  // Task #738 spec (post-code-review): a zero-due tick must surface
  // as amber, NOT green, so the rollup tile distinguishes "the cron
  // fired but had nothing to do" from "a real sweep ran and every
  // ticket scraped clean".
  assert.equal(
    derivePortalSyncCronStatus({ considered: 0, scraped: 0, errored: 0 }),
    "degraded",
  );
});

test("derivePortalSyncCronStatus: full success → ok", () => {
  assert.equal(
    derivePortalSyncCronStatus({ considered: 25, scraped: 25, errored: 0 }),
    "ok",
  );
});

test("derivePortalSyncCronStatus: 19/25 with 6 errors → degraded (the canonical Task #738 scenario)", () => {
  // The exact scenario the rollup tile MUST paint amber, not red.
  // Pre-Task-#738 this collapsed to "failed" and operators learned to
  // ignore the dot.
  assert.equal(
    derivePortalSyncCronStatus({ considered: 25, scraped: 19, errored: 6 }),
    "degraded",
  );
});

test("derivePortalSyncCronStatus: all errored (zero scraped) → failed (bot is 100% blind)", () => {
  // The code-review finding: a sweep where every considered ticket
  // errored MUST be red, not amber. Previously this returned
  // degraded which let a fully-broken sweep stay amber.
  assert.equal(
    derivePortalSyncCronStatus({ considered: 25, scraped: 0, errored: 25 }),
    "failed",
  );
  assert.equal(
    derivePortalSyncCronStatus({ considered: 1, scraped: 0, errored: 1 }),
    "failed",
  );
});

test("derivePortalSyncCronStatus: scraped + skipped (no errors) → ok", () => {
  // A sweep where some rows were skipped (e.g. dryRun, gate-busy)
  // but the ones we did try all succeeded is still green.
  assert.equal(
    derivePortalSyncCronStatus({ considered: 10, scraped: 7, errored: 0 }),
    "ok",
  );
});
