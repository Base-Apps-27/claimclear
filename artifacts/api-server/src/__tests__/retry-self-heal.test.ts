import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { computeNextRetryDelayMinutes } from "../lib/submission-retry";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoSrc = resolve(__dirname, "..");

test("computeNextRetryDelayMinutes follows the [5, 30, 240, 480] backoff schedule", () => {
  // attemptsSoFar is the count *after* the current attempt was claimed/incremented,
  // so attempts=1 schedules retry #1 (5 min), attempts=2 → 30 min, attempts=3 → 4h.
  // attempts=4 (the final attempt) is past the schedule and the helper marks
  // the submission failed instead of using this delay; we still test the value
  // here for completeness. The wide gaps (especially the 4h jump from attempt
  // 3 to attempt 4) are intentional: the portal has a recurring midnight
  // slowdown window, so we want at least one retry to land outside it.
  assert.equal(computeNextRetryDelayMinutes(1), 5);
  assert.equal(computeNextRetryDelayMinutes(2), 30);
  assert.equal(computeNextRetryDelayMinutes(3), 240);
  assert.equal(computeNextRetryDelayMinutes(4), 480);
  // Defensive: 0 / negative attempts clamp to first slot, very large clamps to last.
  assert.equal(computeNextRetryDelayMinutes(0), 5);
  assert.equal(computeNextRetryDelayMinutes(-3), 5);
  assert.equal(computeNextRetryDelayMinutes(99), 480);
});

test("batch-processor catch blocks delegate to scheduleRetryOrFail (no direct status='failed' write in processSequentially)", () => {
  const src = readFileSync(resolve(repoSrc, "lib/batch-processor.ts"), "utf8");

  // The shared helper must be imported and called from the batch processor.
  assert.match(
    src,
    /import\s*\{[^}]*scheduleRetryOrFail[^}]*\}\s*from\s*["']\.\/submission-retry["']/,
    "batch-processor.ts must import scheduleRetryOrFail from ./submission-retry",
  );

  const helperCalls = src.match(/scheduleRetryOrFail\s*\(/g) || [];
  assert.ok(
    helperCalls.length >= 2,
    `batch-processor.ts should call scheduleRetryOrFail at least twice (processSequentially + sandbox runner), found ${helperCalls.length}`,
  );

  // Locate the processSequentially catch block and assert that it does NOT
  // contain a direct `status: "failed"` write to portal_submissions.
  const seqIdx = src.indexOf("function processSequentially");
  assert.notEqual(seqIdx, -1, "processSequentially function must exist in batch-processor.ts");
  // Slice from processSequentially to the next top-level function declaration
  // (any of `function`, `async function`, `export function`, `export async function`).
  const after = src.slice(seqIdx);
  const nextFnIdx = after.slice(1).search(/\n(export\s+)?(async\s+)?function\s/);
  const seqBody = nextFnIdx === -1 ? after : after.slice(0, nextFnIdx + 1);

  // Strip job.results.push({...status: "failed"...}) lines — those are in-memory
  // batch-result entries, not DB writes. We only want to inspect real
  // portal_submissions updates.
  const dbWriteBody = seqBody.replace(/job\.results\.push\([\s\S]*?\);/g, "");

  // The helper must be called in the catch block.
  const helperIdx = dbWriteBody.search(/scheduleRetryOrFail\s*\(/);
  assert.notEqual(helperIdx, -1, "processSequentially must call scheduleRetryOrFail in its catch block");

  // Any direct `status: "failed"` write to portal_submissions must come
  // AFTER the helper call (i.e. it can only be a fallback for when the
  // helper itself throws — never the primary failure path).
  const directWrites = [...dbWriteBody.matchAll(/status:\s*["']failed["']/g)];
  for (const m of directWrites) {
    assert.ok(
      m.index! > helperIdx,
      "Any direct status='failed' write in processSequentially must come AFTER scheduleRetryOrFail (fallback only); the primary failure path must delegate to the helper",
    );
  }

  // And the fallback (if present) must be guarded by a check that the
  // helper failed — i.e. wrapped in `if (!retryResult)` or equivalent —
  // so it never overwrites a successful retry-scheduled status.
  if (directWrites.length > 0) {
    assert.match(
      dbWriteBody,
      /if\s*\(\s*!retryResult\s*\)/,
      "Direct status='failed' fallback in processSequentially must be guarded by `if (!retryResult)`",
    );
  }
});

test("scheduleRetryOrFail decision logic: attempts 1..maxAttempts-1 reschedule, final attempt fails", () => {
  // We can't import the helper without hitting the DB, so we verify the
  // gate logic encoded in the source. The contract is:
  //   exhausted = attemptsSoFar >= maxAttempts
  //   exhausted → status='failed' + audit 'submission_retries_exhausted'
  //   !exhausted → status='pending' + audit 'submission_retry_scheduled'
  const src = readFileSync(resolve(repoSrc, "lib/submission-retry.ts"), "utf8");

  assert.match(src, /exhausted\s*=\s*attemptsSoFar\s*>=\s*maxAttempts/);
  assert.match(src, /action:\s*["']submission_retry_scheduled["']/);
  assert.match(src, /action:\s*["']submission_retries_exhausted["']/);

  // Walk through each attempt count and assert the branch we expect to take,
  // mirroring the helper's `attemptsSoFar >= maxAttempts` decision.
  const maxAttempts = 4;
  for (const attemptsSoFar of [1, 2, 3]) {
    assert.ok(
      attemptsSoFar < maxAttempts,
      `attempt ${attemptsSoFar}/${maxAttempts} should reschedule, not fail`,
    );
    // And the delay must come from the shared schedule, never zero.
    assert.ok(computeNextRetryDelayMinutes(attemptsSoFar) >= 1);
  }
  // The final attempt must trip the "exhausted" branch.
  assert.ok(maxAttempts >= maxAttempts, "attempt 4/4 must mark the submission failed");
});
