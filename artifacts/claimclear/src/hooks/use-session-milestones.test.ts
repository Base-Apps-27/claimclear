// Task #541 — generation-aware dedup regression test.
//
// The pre-#541 version of `notifyClaimProcessedThisSession` keyed
// dedup on `claimId` only, so a single claim re-processed in a later
// state-machine pass (e.g. revert + re-do) could only ever increment
// the session counter once. Post-#541 the dedup key is
// `${claimId}:${generation}`, so re-processing increments cleanly
// while replays of the same transition from sibling views still
// collapse to one increment.

import { test } from "node:test";
import { strict as assert } from "node:assert";

import {
  notifyClaimProcessedThisSession,
  __resetSessionMilestonesForTests,
} from "./use-session-milestones";

test("same claim + same generation only increments once (sibling-view dedup)", () => {
  __resetSessionMilestonesForTests();
  const first = notifyClaimProcessedThisSession(1, "2026-05-08T10:00:00Z");
  const second = notifyClaimProcessedThisSession(1, "2026-05-08T10:00:00Z");
  assert.equal(first, 1, "first call counts");
  assert.equal(second, null, "duplicate generation must collapse to no-op");
});

test("same claim + different generation increments cleanly (re-process)", () => {
  __resetSessionMilestonesForTests();
  const first = notifyClaimProcessedThisSession(1, "2026-05-08T10:00:00Z");
  const second = notifyClaimProcessedThisSession(1, "2026-05-08T11:00:00Z");
  assert.equal(first, 1);
  assert.equal(second, 2,
    "re-processing the same claim under a fresh generation must increment");
});

test("missing generation falls back to claim-id-only dedup (legacy behavior)", () => {
  __resetSessionMilestonesForTests();
  const first = notifyClaimProcessedThisSession(1);
  const second = notifyClaimProcessedThisSession(1);
  assert.equal(first, 1);
  assert.equal(second, null,
    "calls without a generation must keep the legacy 'once per claim id' semantics");
});

test("distinct claims always increment", () => {
  __resetSessionMilestonesForTests();
  const a = notifyClaimProcessedThisSession(1, "g");
  const b = notifyClaimProcessedThisSession(2, "g");
  assert.equal(a, 1);
  assert.equal(b, 2);
});
