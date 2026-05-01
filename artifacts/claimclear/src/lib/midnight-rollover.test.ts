import { test } from "node:test";
import assert from "node:assert/strict";
import { msUntilNextMidnight } from "./midnight-rollover.js";

// Day-rollover scheduling math (Task #290) ------------------------------
//
// `useMidnightRollover` (used by `pages/queue.tsx` and
// `pages/dashboard.tsx`) is the only thing keeping a long-lived tab in
// sync after the local clock crosses midnight — without it the cached
// `isUrgent` / `effectiveDaysLeft` flags reflect yesterday's "today" and
// the Queue and Dashboard silently disagree.
//
// The hook itself is a thin React wrapper around the pure
// `msUntilNextMidnight` scheduler. We pin the scheduler with concrete
// time-of-day cases — every regression of the form "the scheduler
// returned 0 / NaN / a negative number / a tiny number that re-fires
// immediately and burns CPU" shows up here, including the off-by-one at
// midnight itself.

function at(year: number, month: number, day: number, h: number, m: number, s: number, ms: number): Date {
  return new Date(year, month - 1, day, h, m, s, ms);
}

test("msUntilNextMidnight — noon waits ~12 hours", () => {
  const now = at(2026, 5, 1, 12, 0, 0, 0);
  const ms = msUntilNextMidnight(now);
  // 12:00 -> 24:00 = 12 hours, plus the 50 ms cushion.
  assert.equal(ms, 12 * 60 * 60 * 1000 + 50);
});

test("msUntilNextMidnight — one second before midnight waits ~1 second (never zero, never negative)", () => {
  const now = at(2026, 5, 1, 23, 59, 59, 0);
  const ms = msUntilNextMidnight(now);
  // 23:59:59.000 -> 24:00:00.050 = 1.050 s. Critically > 0 — the timer
  // must actually fire on the *next* midnight, not 0 ms later (which
  // would re-fire immediately and burn CPU re-scheduling).
  assert.equal(ms, 1050);
  assert.ok(ms > 0, "scheduler must always return a positive delay");
});

test("msUntilNextMidnight — exactly midnight returns ~24h, never 0", () => {
  const now = at(2026, 5, 1, 0, 0, 0, 0);
  const ms = msUntilNextMidnight(now);
  // setHours(24, 0, 0, 50) on 00:00:00.000 rolls to next-day 00:00:00.050,
  // so the scheduler waits the full 24 h + cushion. The important
  // property is `ms > 0` — a 0 here would loop the scheduler forever.
  assert.equal(ms, 24 * 60 * 60 * 1000 + 50);
  assert.ok(ms > 0, "exactly-midnight must not produce a zero delay");
});

test("msUntilNextMidnight — one millisecond after midnight waits ~24h", () => {
  const now = at(2026, 5, 1, 0, 0, 0, 1);
  const ms = msUntilNextMidnight(now);
  // Should land on next-day 00:00:00.050, i.e. (24h - 1 ms + 50 ms cushion).
  assert.equal(ms, 24 * 60 * 60 * 1000 + 50 - 1);
});

test("msUntilNextMidnight — last DST-safe minute of the day still returns a positive delay", () => {
  // We pick a non-DST-transition local time so the test is stable in
  // any timezone the CI runner happens to be in. The point of this case
  // is the boundary just before midnight — the scheduler must always
  // round forward, never backward.
  const now = at(2026, 5, 1, 23, 59, 0, 500);
  const ms = msUntilNextMidnight(now);
  assert.ok(ms > 0, `expected positive delay, got ${ms}`);
  // Sanity bound: must be within the last minute (+ cushion).
  assert.ok(ms <= 60 * 1000 + 50, `expected <= 60050 ms, got ${ms}`);
});

// Source-level lock (Task #290) ----------------------------------------
//
// Both the Queue and the Dashboard MUST wire `useMidnightRollover` —
// they're the two surfaces that read `isUrgent` against the server's
// "today" and they have to agree at the boundary. Previously only the
// Queue scheduled an invalidation; a Dashboard left open across midnight
// would keep showing yesterday's "must file today" totals. We can't
// render the React tree from a node-only test, so the lock is a
// source-string check.
test("queue.tsx wires useMidnightRollover (so a Queue tab open across midnight refreshes urgency)", async () => {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const url = await import("node:url");
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const src = await fs.readFile(path.join(here, "..", "pages", "queue.tsx"), "utf8");
  assert.match(
    src,
    /useMidnightRollover\s*\(/,
    "queue.tsx must call useMidnightRollover so it refreshes urgency when the local clock crosses midnight",
  );
  assert.match(
    src,
    /from\s+["']@\/lib\/midnight-rollover["']/,
    "queue.tsx must import useMidnightRollover from @/lib/midnight-rollover",
  );
});

test("dashboard.tsx wires useMidnightRollover (so a Dashboard tab open across midnight refreshes urgency)", async () => {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const url = await import("node:url");
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const src = await fs.readFile(path.join(here, "..", "pages", "dashboard.tsx"), "utf8");
  assert.match(
    src,
    /useMidnightRollover\s*\(/,
    "dashboard.tsx must call useMidnightRollover so it refreshes urgency when the local clock crosses midnight",
  );
  assert.match(
    src,
    /from\s+["']@\/lib\/midnight-rollover["']/,
    "dashboard.tsx must import useMidnightRollover from @/lib/midnight-rollover",
  );
});
