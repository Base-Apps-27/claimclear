import { test } from "node:test";
import { strict as assert } from "node:assert";

import {
  enumerateExpectedFiresSinceBoot,
  ENUMERATION_LOOKBACK_MS,
} from "../lib/cron-fire-enumeration";

// Pick a `now` that is between */15 fire boundaries so the "just-booted"
// case unambiguously has no elapsed fires inside the window.
const NOW = new Date("2026-04-28T17:07:23.000Z");

test("enumerateExpectedFiresSinceBoot: just-booted server returns no fires (no time for any tick)", () => {
  const recentBoot = new Date(NOW.getTime() - 30 * 1000);
  const fires = enumerateExpectedFiresSinceBoot({
    cron: "*/15 * * * *",
    tz: "America/New_York",
    bootTime: recentBoot,
    now: NOW,
  });
  // The next */15 fire after a 30-second-old boot is in the future, so the
  // window contains zero fires that already elapsed.
  assert.equal(fires.length, 0);
});

test("enumerateExpectedFiresSinceBoot: returns recent fires when boot was long ago (windowed lookback)", () => {
  // Boot was 60 days ago — far longer than the 7-day enumeration window.
  // Naive "iterate forward from boot, cap at N" would return the *oldest*
  // fires near boot. We want the most recent fires before `now`.
  const ancientBoot = new Date(NOW.getTime() - 60 * 24 * 60 * 60 * 1000);
  const fires = enumerateExpectedFiresSinceBoot({
    cron: "*/15 * * * *",
    tz: "America/New_York",
    bootTime: ancientBoot,
    now: NOW,
  });
  assert.ok(fires.length > 0, "expected at least one recent fire for a frequently-firing cron");

  // The most recent fire must be within ~16 minutes of `now`. If the
  // enumeration accidentally returned fires near boot, this would be ~60d old.
  const last = fires[fires.length - 1];
  const ageMs = NOW.getTime() - last.getTime();
  assert.ok(
    ageMs < 16 * 60 * 1000,
    `expected the latest enumerated fire to be near 'now', got ${ageMs / 60000} min old`,
  );

  // The first fire must be within the lookback window from `now`. Naive
  // forward-from-boot enumeration would put this 60 days back.
  const first = fires[0];
  const firstAgeMs = NOW.getTime() - first.getTime();
  assert.ok(
    firstAgeMs <= ENUMERATION_LOOKBACK_MS + 16 * 60 * 1000,
    `expected the earliest enumerated fire to be within the 7-day lookback, got ${firstAgeMs / 60000} min old`,
  );
});

test("enumerateExpectedFiresSinceBoot: window starts at boot when boot is more recent than the lookback", () => {
  // Boot 1 hour ago — newer than the 7-day default window.
  const recentBoot = new Date(NOW.getTime() - 60 * 60 * 1000);
  const fires = enumerateExpectedFiresSinceBoot({
    cron: "*/15 * * * *",
    tz: "America/New_York",
    bootTime: recentBoot,
    now: NOW,
  });
  assert.ok(fires.length >= 3, `expected ~4 fires in the last hour, got ${fires.length}`);
  // No fire should predate boot.
  for (const f of fires) {
    assert.ok(
      f.getTime() >= recentBoot.getTime(),
      `enumerated fire ${f.toISOString()} is older than boot ${recentBoot.toISOString()}`,
    );
  }
});

test("enumerateExpectedFiresSinceBoot: a daily cron returns at most a handful of fires per week", () => {
  const ancientBoot = new Date(NOW.getTime() - 365 * 24 * 60 * 60 * 1000);
  const fires = enumerateExpectedFiresSinceBoot({
    cron: "0 7 * * 1-5",
    tz: "America/New_York",
    bootTime: ancientBoot,
    now: NOW,
  });
  // Mon–Fri 7am over 7 days = at most 5 fires.
  assert.ok(fires.length <= 5, `expected <=5 daily fires in last week, got ${fires.length}`);
});
