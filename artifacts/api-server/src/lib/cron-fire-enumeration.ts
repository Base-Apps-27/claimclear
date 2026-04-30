// Pure helper for enumerating expected cron fire times in a bounded window.
// Extracted so we can unit-test the long-uptime regression where naive
// "iterate forward from boot with a hard cap" would only return the *first*
// N fires after boot — leaving recent missed ticks invisible and silently
// hiding persistent failures.

import { CronExpressionParser } from "cron-parser";

// Per-minute cron over 7 days = 10,080 entries; 12,000 is a safe ceiling.
export const MAX_EXPECTED_FIRES = 12000;

// We bound enumeration to the same 7-day window we use for pulling lastRun
// from cronRunsTable. Anything older couldn't influence the rollup anyway.
export const ENUMERATION_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

export interface EnumerateOptions {
  cron: string;
  tz: string;
  bootTime: Date;
  now: Date;
  lookbackMs?: number;
  cap?: number;
}

/**
 * Returns expected cron fire times in the window
 * `[max(bootTime, now - lookback), now]` (inclusive of `now`), sorted
 * ascending.
 *
 * Critical contract: the window starts at `max(bootTime, now - lookback)`,
 * not at `bootTime` alone. Iterating forward from `bootTime` with a hard
 * iteration cap would return the *oldest* N fires after long uptime — the
 * exact opposite of what the missed-tick math needs. This helper guarantees
 * the returned fires always include the most recent ticks before `now`.
 */
export function enumerateExpectedFiresSinceBoot(opts: EnumerateOptions): Date[] {
  const lookbackMs = opts.lookbackMs ?? ENUMERATION_LOOKBACK_MS;
  const cap = opts.cap ?? MAX_EXPECTED_FIRES;

  const start = new Date(
    Math.max(opts.bootTime.getTime(), opts.now.getTime() - lookbackMs),
  );

  const fires: Date[] = [];
  const it = CronExpressionParser.parse(opts.cron, {
    tz: opts.tz,
    currentDate: start,
  });
  for (let i = 0; i < cap; i++) {
    const next = it.next().toDate();
    if (next.getTime() > opts.now.getTime()) break;
    fires.push(next);
  }
  return fires;
}
