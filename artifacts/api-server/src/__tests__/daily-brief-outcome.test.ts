// Pure-function tests for the daily brief's outcome / bounce / dollar helpers.

import { test } from "node:test";
import { strict as assert } from "node:assert";

import {
  computeBriefOutcome,
  evaluateBounceDowngrade,
  safeClaimAmountAtRisk,
  mapBriefOutcomeToCronStatus,
  BOUNCE_DOWNGRADE_SHARE,
  BOUNCE_DOWNGRADE_SMALL_LIST_THRESHOLD,
  BOUNCE_DOWNGRADE_SMALL_LIST_CAP,
  BOUNCE_RECHECK_WINDOW_MS,
} from "../lib/daily-brief-outcome";

// ---------------------------------------------------------------------------
// computeBriefOutcome
// ---------------------------------------------------------------------------

test("computeBriefOutcome: all recipients sent → ok", () => {
  const summary = computeBriefOutcome({
    recipientCount: 3,
    results: [
      { email: "a@x", ok: true, errorExcerpt: null },
      { email: "b@x", ok: true, errorExcerpt: null },
      { email: "c@x", ok: true, errorExcerpt: null },
    ],
  });
  assert.equal(summary.outcome, "ok");
  assert.equal(summary.sentCount, 3);
  assert.equal(summary.failureCount, 0);
  assert.deepEqual(summary.failures, []);
});

test("computeBriefOutcome: partial sends → degraded with failure list", () => {
  const summary = computeBriefOutcome({
    recipientCount: 3,
    results: [
      { email: "a@x", ok: true, errorExcerpt: null },
      { email: "b@x", ok: false, errorExcerpt: "Graph 503" },
      { email: "c@x", ok: true, errorExcerpt: null },
    ],
  });
  assert.equal(summary.outcome, "degraded");
  assert.equal(summary.sentCount, 2);
  assert.equal(summary.failureCount, 1);
  assert.deepEqual(summary.failures, [{ email: "b@x", error: "Graph 503" }]);
});

test("computeBriefOutcome: every recipient failed → failed (cron row must not say ok)", () => {
  const summary = computeBriefOutcome({
    recipientCount: 2,
    results: [
      { email: "a@x", ok: false, errorExcerpt: "ECONNREFUSED" },
      { email: "b@x", ok: false, errorExcerpt: "ECONNREFUSED" },
    ],
  });
  assert.equal(summary.outcome, "failed");
  assert.equal(summary.sentCount, 0);
  assert.equal(summary.failureCount, 2);
});

test("computeBriefOutcome: zero recipients (everyone opted out / query broke) → failed", () => {
  // Pre-Task-#398 this silently reported sent=0 method=none as a "success";
  // the cron tile then turned green even though nobody got the brief. Lock
  // the new behavior in: 0 recipients is treated as a failure outcome.
  const summary = computeBriefOutcome({
    recipientCount: 0,
    results: [],
  });
  assert.equal(summary.outcome, "failed");
  assert.match(summary.message, /0 recipients/);
});

test("computeBriefOutcome: top-level failure flag forces failed outcome", () => {
  // Used when Outlook is unavailable / the route catches a top-level throw
  // before any per-recipient send was attempted.
  const summary = computeBriefOutcome({
    recipientCount: 5,
    results: [],
    topLevelFailure: true,
  });
  assert.equal(summary.outcome, "failed");
  assert.match(summary.message, /failed before/);
});

test("computeBriefOutcome: failure error_excerpt is truncated to 200 chars in failures[]", () => {
  const longError = "x".repeat(500);
  const summary = computeBriefOutcome({
    recipientCount: 1,
    results: [{ email: "a@x", ok: false, errorExcerpt: longError }],
  });
  assert.equal(summary.failures.length, 1);
  assert.equal(summary.failures[0]!.error.length, 200);
});

// ---------------------------------------------------------------------------
// mapBriefOutcomeToCronStatus
// ---------------------------------------------------------------------------

test("mapBriefOutcomeToCronStatus: pure 1:1 mapping (ok/degraded/failed)", () => {
  // The cron handler in index.ts depends on this passing through verbatim.
  // If you intentionally want to remap (e.g. degraded -> ok), update the
  // cron handler in the same change.
  assert.equal(mapBriefOutcomeToCronStatus("ok"), "ok");
  assert.equal(mapBriefOutcomeToCronStatus("degraded"), "degraded");
  assert.equal(mapBriefOutcomeToCronStatus("failed"), "failed");
});

// ---------------------------------------------------------------------------
// safeClaimAmountAtRisk
// ---------------------------------------------------------------------------

test("safeClaimAmountAtRisk: sums numeric strings", () => {
  assert.equal(
    safeClaimAmountAtRisk([
      { claimAmount: "100.50" },
      { claimAmount: "200" },
      { claimAmount: "0.25" },
    ]),
    300.75,
  );
});

test("safeClaimAmountAtRisk: treats null, undefined, and empty string as $0", () => {
  assert.equal(
    safeClaimAmountAtRisk([
      { claimAmount: null },
      { claimAmount: undefined },
      { claimAmount: "" },
      { claimAmount: "150" },
    ]),
    150,
  );
});

test("safeClaimAmountAtRisk: garbage strings do not produce NaN totals", () => {
  // Pre-Task-#398 a single malformed claim_amount could turn the running
  // total into NaN, which then rendered as "$NaN at risk" in the email.
  // The reduce now skips unparseable values explicitly.
  const total = safeClaimAmountAtRisk([
    { claimAmount: "not-a-number" },
    { claimAmount: "  " },
    { claimAmount: "100.00" },
  ]);
  assert.ok(Number.isFinite(total), `expected finite, got ${total}`);
  assert.equal(total, 100);
});

test("safeClaimAmountAtRisk: numeric inputs (already parsed) are summed too", () => {
  assert.equal(
    safeClaimAmountAtRisk([{ claimAmount: 50 }, { claimAmount: 25 }, { claimAmount: null }]),
    75,
  );
});

// ---------------------------------------------------------------------------
// evaluateBounceDowngrade
// ---------------------------------------------------------------------------

test("evaluateBounceDowngrade: clean run (no bounces) → ok", () => {
  assert.equal(evaluateBounceDowngrade({ recipientCount: 8, bounceCount: 0 }), "ok");
});

test("evaluateBounceDowngrade: bulk threshold — >=50% bounce share → degraded", () => {
  // 50% on a large list is the bulk-spike rule.
  assert.equal(evaluateBounceDowngrade({ recipientCount: 10, bounceCount: 5 }), "degraded");
  // Just below: a single bounce on a 10-person list (10%) is not a spike.
  assert.equal(evaluateBounceDowngrade({ recipientCount: 10, bounceCount: 1 }), "ok");
});

test("evaluateBounceDowngrade: small-list rule — >=2 of <=5 recipients bounced → degraded", () => {
  // 2 of 4 (50%) trips the bulk rule too, so test 2 of 5 (40%) which only
  // trips the small-list rule.
  assert.equal(evaluateBounceDowngrade({ recipientCount: 5, bounceCount: 2 }), "degraded");
  // Same share (40%) on a 6-person list is not above either threshold.
  assert.equal(evaluateBounceDowngrade({ recipientCount: 6, bounceCount: 2 }), "ok");
});

test("evaluateBounceDowngrade: 1 bounce on a tiny list is not enough", () => {
  // A single mailbox-full bounce on a 3-person team should not tag the
  // whole run as degraded — that's noise, not signal.
  assert.equal(evaluateBounceDowngrade({ recipientCount: 3, bounceCount: 1 }), "ok");
});

test("evaluateBounceDowngrade: defensive — recipientCount 0 or bounceCount 0 → ok", () => {
  assert.equal(evaluateBounceDowngrade({ recipientCount: 0, bounceCount: 0 }), "ok");
  assert.equal(evaluateBounceDowngrade({ recipientCount: 0, bounceCount: 5 }), "ok");
  assert.equal(evaluateBounceDowngrade({ recipientCount: 5, bounceCount: 0 }), "ok");
});

test("downgrade thresholds are stable constants", () => {
  // Lock the thresholds in place so a tweak shows up as a code review
  // diff rather than slipping into prod silently.
  assert.equal(BOUNCE_DOWNGRADE_SHARE, 0.5);
  assert.equal(BOUNCE_DOWNGRADE_SMALL_LIST_THRESHOLD, 2);
  assert.equal(BOUNCE_DOWNGRADE_SMALL_LIST_CAP, 5);
  assert.equal(BOUNCE_RECHECK_WINDOW_MS, 10 * 60 * 1000);
});
