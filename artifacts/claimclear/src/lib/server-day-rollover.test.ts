import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldInvalidateOnRollover, latestTodayKey } from "./server-day-rollover.js";

// Server-driven day-rollover invalidator (Task #294, replaces #290's
// midnight `setTimeout`). The pure decision function lives in
// `shouldInvalidateOnRollover`; pinning its three corner cases here
// catches every regression of the form "we re-invalidate on every
// render", "we never invalidate", or "we invalidate on the first
// response (stampede)".

test("shouldInvalidateOnRollover — first response does NOT trigger invalidation", () => {
  // Mounting the hook → first response carries today's date, but we
  // have no baseline to compare against. Returning true here would
  // stampede every deadline-driven query into an immediate refetch on
  // every page load, exactly the noise we replaced Task #290's local
  // setTimeout to avoid.
  assert.equal(shouldInvalidateOnRollover(null, "2026-05-01"), false);
});

test("shouldInvalidateOnRollover — same date returns false (no work)", () => {
  // Steady-state: the same `today` value should be a no-op every time.
  assert.equal(shouldInvalidateOnRollover("2026-05-01", "2026-05-01"), false);
});

test("shouldInvalidateOnRollover — date change triggers invalidation", () => {
  // The actual rollover. A response carrying tomorrow's date after
  // we've already seen yesterday's MUST invalidate so sister surfaces
  // refetch their `isUrgent` / `effectiveDaysLeft` flags against the
  // new "today".
  assert.equal(shouldInvalidateOnRollover("2026-04-30", "2026-05-01"), true);
});

test("shouldInvalidateOnRollover — missing incoming value is a no-op", () => {
  // Defensive: a response without a `today` (older server, in-flight
  // deploy) must not crash and must not invalidate. We just keep the
  // last-seen baseline and wait for a fresh signal.
  assert.equal(shouldInvalidateOnRollover("2026-05-01", undefined), false);
  assert.equal(shouldInvalidateOnRollover("2026-05-01", null), false);
  assert.equal(shouldInvalidateOnRollover("2026-05-01", ""), false);
});

test("shouldInvalidateOnRollover — backwards date change still invalidates (clock skew safety)", () => {
  // We don't trust the direction of the change — only that it changed.
  // A backwards step (a stale response, a server clock correction) is
  // still a mismatch the cache shouldn't be wedged on. Refetching costs
  // little; staying pinned to the wrong "today" is the bug.
  assert.equal(shouldInvalidateOnRollover("2026-05-01", "2026-04-30"), true);
});

// `latestTodayKey` chooses the newest `today` across multiple lane
// responses. Queue feeds it six lane queries; we want rollover to fire
// the moment ANY lane has seen the new day, not when the
// highest-priority one does.

test("latestTodayKey — returns null when every candidate is missing", () => {
  // No lane has any data yet (cold mount). The hook should be starved
  // of a signal rather than receiving stale defaults.
  assert.equal(latestTodayKey(), null);
  assert.equal(latestTodayKey(undefined, null, ""), null);
});

test("latestTodayKey — picks the lexicographically largest YYYY-MM-DD value", () => {
  // The point of going `max` instead of first-non-null: if one lane
  // has already refetched and seen tomorrow's `today` while another
  // lane is still serving yesterday's cached payload, we react to
  // rollover immediately on the new value rather than waiting for the
  // first-precedence lane to catch up.
  assert.equal(latestTodayKey("2026-04-30", "2026-05-01"), "2026-05-01");
  assert.equal(latestTodayKey("2026-05-01", "2026-04-30"), "2026-05-01");
  assert.equal(
    latestTodayKey(null, "2026-04-30", undefined, "2026-05-02", "2026-05-01"),
    "2026-05-02",
  );
});

test("latestTodayKey — ignores null/undefined/empty entries instead of treating them as a value", () => {
  // Falsy candidates must not pollute the comparison; the only real
  // values count toward the max.
  assert.equal(latestTodayKey(null, undefined, "", "2026-05-01"), "2026-05-01");
});

// Source-level lock — Queue and Dashboard MUST wire the new hook. They
// are the two surfaces that read deadline urgency against the server's
// "today" and they have to agree at the boundary. Previously this lock
// covered `useMidnightRollover`; the assertion is updated here in
// lockstep with the rename so a future refactor can't silently drop the
// wiring on either page.

test("queue.tsx wires useServerDayRolloverInvalidator (so a Queue tab open across midnight refreshes urgency on the next refetch)", async () => {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const url = await import("node:url");
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const src = await fs.readFile(path.join(here, "..", "pages", "queue.tsx"), "utf8");
  assert.match(
    src,
    /useServerDayRolloverInvalidator\s*\(/,
    "queue.tsx must call useServerDayRolloverInvalidator so it refreshes urgency when the server's today changes",
  );
  assert.match(
    src,
    /from\s+["']@\/lib\/server-day-rollover["']/,
    "queue.tsx must import useServerDayRolloverInvalidator from @/lib/server-day-rollover",
  );
  // Queue reads several lane queries in parallel, so it must combine
  // their `today` values via `latestTodayKey` (max), not pick the first
  // non-null one — otherwise rollover detection is delayed when the
  // preferred-order lane is still serving yesterday's cached payload.
  assert.match(
    src,
    /latestTodayKey\s*\(/,
    "queue.tsx must use latestTodayKey to combine `today` from every lane query so rollover fires on the freshest available signal",
  );
  // And the old client-clock scheduler must not creep back in on a
  // future refactor — that's the whole reason this task existed.
  assert.doesNotMatch(
    src,
    /useMidnightRollover/,
    "queue.tsx must not re-introduce the local-clock midnight scheduler (Task #294 replaced it with a server-driven signal)",
  );
});

test("dashboard.tsx wires useServerDayRolloverInvalidator (so a Dashboard tab open across midnight refreshes urgency on the next refetch)", async () => {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const url = await import("node:url");
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const src = await fs.readFile(path.join(here, "..", "pages", "dashboard.tsx"), "utf8");
  assert.match(
    src,
    /useServerDayRolloverInvalidator\s*\(/,
    "dashboard.tsx must call useServerDayRolloverInvalidator so it refreshes urgency when the server's today changes",
  );
  assert.match(
    src,
    /from\s+["']@\/lib\/server-day-rollover["']/,
    "dashboard.tsx must import useServerDayRolloverInvalidator from @/lib/server-day-rollover",
  );
  assert.doesNotMatch(
    src,
    /useMidnightRollover/,
    "dashboard.tsx must not re-introduce the local-clock midnight scheduler (Task #294 replaced it with a server-driven signal)",
  );
});
