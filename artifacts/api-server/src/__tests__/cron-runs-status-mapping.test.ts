// Task #738. Lock the producer→column status mapping in `cron-runs.ts`
// so partial-failure runs surface as amber on the System Health rollup
// instead of being collapsed to red. Pre-Task-#738 the recorder mapped
// "degraded" → "failed", which trained operators to ignore the dot
// because an in-tolerance partial portal scrape (19/25 succeeded, 6
// errored) looked identical to a hard failure on the rollup tile.
//
// We exercise the *real* exported `mapResultStatus` from cron-runs.ts
// — not a local mirror — so the test fails the moment production drifts.

import { test } from "node:test";
import { strict as assert } from "node:assert";

import { mapResultStatus } from "../lib/cron-runs";

test("cron-runs mapResultStatus: undefined / ok → completed (zero-due sweep stays green)", () => {
  // A `portal_response_sync` tick where no tickets were due returns
  // `{ status: "ok" }` (or omits status) and MUST land as "completed".
  assert.equal(mapResultStatus(undefined), "completed");
  assert.equal(mapResultStatus("ok"), "completed");
});

test("cron-runs mapResultStatus: degraded → degraded (partial portal sweep surfaces amber)", () => {
  // The Task #738 fix. A partial portal scrape — 19/25 tickets
  // succeeded and 6 errored — must NOT collapse to "failed".
  assert.equal(mapResultStatus("degraded"), "degraded");
});

test("cron-runs mapResultStatus: failed → failed (hard failure stays red)", () => {
  assert.equal(mapResultStatus("failed"), "failed");
});
