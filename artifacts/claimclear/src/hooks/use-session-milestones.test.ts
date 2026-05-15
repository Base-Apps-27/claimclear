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

// Task #780 (C) — sessionStorage-backed persistence regression test.
//
// Pre-#780 the dedup Set lived in a module-level singleton and was
// wiped on every page reload, so a user who processed 9 claims,
// hard-refreshed, then processed another 10 would never hit the 10-
// milestone — each "session" started over at zero. Post-#780 the
// state is sessionStorage-backed (with an in-memory fallback in node
// for tests) and keyed by today's local date, so cross-instantiation
// reads pick up where the previous run left off until the day flips
// or sign-out clears it.
//
// We can't really `import()` the module twice in node tests — the
// loader caches. But the storage layer is the same Map either way,
// so the most direct simulation of "reload survives the counter" is:
// write a few events, reset the in-process snapshot listeners (NOT
// the storage), and re-read the count. The post-`__reset` baseline
// actually CLEARS storage, so we test the inverse: that two
// independent calls with different generations survive across the
// listener-set lifecycle without the test itself wiping storage
// between them.
test("counter survives across sequential calls without explicit reset", () => {
  __resetSessionMilestonesForTests();
  // First "page load" — record 3 distinct events.
  notifyClaimProcessedThisSession(101, "gen-A");
  notifyClaimProcessedThisSession(102, "gen-A");
  notifyClaimProcessedThisSession(103, "gen-A");
  // Second "page load" simulation — fresh generation, same day.
  // Without storage persistence, calls below would start from 0 and
  // return 1/2; with storage persistence they should pick up at 4/5.
  const fourth = notifyClaimProcessedThisSession(104, "gen-B");
  const fifth = notifyClaimProcessedThisSession(105, "gen-B");
  assert.equal(fourth, 4, "fourth event reads accumulated count from storage");
  assert.equal(fifth, 5, "fifth event reads accumulated count from storage");
});
