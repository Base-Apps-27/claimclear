import { test } from "node:test";
import assert from "node:assert/strict";
import { serverTodayKey } from "../lib/dates";

// `serverTodayKey` is the server's contribution to the day-rollover
// signal (Task #294). Embedded into `/dashboard/summary` and
// `/invoice-groups` responses so the client can detect a day boundary
// crossing without consulting its own clock. The returned string MUST
// match the local-time `setHours(0, 0, 0, 0)` boundary the rest of
// `dates.ts` (`daysRemaining`, `effectiveDaysRemaining`,
// `isUrgentDeadline`) uses, otherwise an `isUrgent` row would land on a
// different "today" than the key we emit and the cache invalidation
// logic would chase its tail.

function localDate(y: number, m: number, d: number, h: number, min: number, s: number, ms: number): Date {
  return new Date(y, m - 1, d, h, min, s, ms);
}

test("serverTodayKey — noon returns the local-day YYYY-MM-DD", () => {
  const d = localDate(2026, 5, 1, 12, 30, 0, 0);
  assert.equal(serverTodayKey(d), "2026-05-01");
});

test("serverTodayKey — exactly midnight returns the new day, never the previous one", () => {
  // The day boundary used by `daysRemaining` is `setHours(0, 0, 0, 0)`.
  // 00:00:00.000 must already be on the new day so the urgency math
  // and the rollover key flip atomically.
  const d = localDate(2026, 5, 2, 0, 0, 0, 0);
  assert.equal(serverTodayKey(d), "2026-05-02");
});

test("serverTodayKey — last millisecond of the day still belongs to that day", () => {
  const d = localDate(2026, 5, 1, 23, 59, 59, 999);
  assert.equal(serverTodayKey(d), "2026-05-01");
});

test("serverTodayKey — single-digit month and day are zero-padded", () => {
  // `YYYY-MM-DD` is the contract — January 9 must be `2026-01-09`, not
  // `2026-1-9` (string compares would lie under that format and the
  // client uses `===` for the rollover check).
  const d = localDate(2026, 1, 9, 9, 0, 0, 0);
  assert.equal(serverTodayKey(d), "2026-01-09");
});

test("serverTodayKey — different times on the same day all return the same key", () => {
  // The whole point of the key: any two responses on the same local
  // server day must hash to the same string so the client only fires
  // its invalidation cascade on a real boundary crossing.
  const morning = localDate(2026, 5, 1, 6, 15, 0, 0);
  const evening = localDate(2026, 5, 1, 18, 45, 0, 0);
  assert.equal(serverTodayKey(morning), serverTodayKey(evening));
});
