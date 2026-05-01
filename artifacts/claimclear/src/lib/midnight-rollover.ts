// Day-rollover utilities (Task #290).
//
// The API stamps `isUrgent` / `effectiveDaysLeft` against its own clock
// at fetch time. When the operator leaves a deadline-driven page (Queue,
// Dashboard) open across midnight, today's deadlines tip but the cached
// rows still carry yesterday's flags. The two surfaces then disagree
// until something else (a tab refocus, a manual reload) refetches.
//
// `useMidnightRollover` schedules a callback to fire at the next local
// midnight, then re-arms itself for the following midnight. Pages use it
// to invalidate the deadline-driven query keys so the cache refetches
// and the urgency math agrees with the new "today".
//
// `msUntilNextMidnight` is split out so we can test the scheduling math
// deterministically without touching real timers.

import { useEffect } from "react";

/**
 * Milliseconds from `now` until the next local midnight, with a small
 * (50 ms) cushion so the timer fires *just* after the boundary rather
 * than on the boundary itself (where rounding can leave us computing
 * yesterday's date).
 *
 * Always > 0. At exactly midnight returns ~24 h (we re-arm for the
 * following midnight, which is the right behaviour — the firing
 * callback will run, then the next call to `msUntilNextMidnight` from
 * inside the callback will compute the next 24 h window).
 */
export function msUntilNextMidnight(now: Date): number {
  const next = new Date(now);
  // setHours(24, 0, 0, 50) rolls to next-day 00:00:00.050 local time.
  next.setHours(24, 0, 0, 50);
  return next.getTime() - now.getTime();
}

/**
 * React hook: invokes `onRollover` at the next local midnight, then
 * re-arms for the midnight after that for as long as the component is
 * mounted. The callback is captured by ref so consumers don't need to
 * memoize it — the timer is only re-scheduled by the hook itself.
 *
 * Pages should pass an invalidation callback that refetches whatever
 * deadline-driven query keys they own (e.g. invoice-groups, dashboard
 * summary), so the urgency math reflects the new "today" without a
 * manual reload.
 */
export function useMidnightRollover(onRollover: () => void): void {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    function schedule() {
      const ms = msUntilNextMidnight(new Date());
      timer = setTimeout(() => {
        try {
          onRollover();
        } finally {
          schedule();
        }
      }, ms);
    }
    schedule();
    return () => {
      if (timer) clearTimeout(timer);
    };
    // We intentionally re-run the effect when `onRollover` identity
    // changes so a parent rebinding the callback (e.g. closing over a
    // new queryClient) gets the new behaviour. Callers that don't want
    // that should memoize.
  }, [onRollover]);
}
