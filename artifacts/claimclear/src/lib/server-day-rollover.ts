// Server-driven day-rollover invalidation (Task #294).
//
// Replaces the per-page midnight `setTimeout` that used to live in
// `pages/queue.tsx` and `pages/dashboard.tsx` (Task #290). The old
// scheduler depended on the *user's* machine clock, never fired when a
// tab was backgrounded for more than 24 h, and duplicated the same
// invalidation logic on every surface that needed deadline freshness.
//
// The new approach: the API embeds a `today` key (server-clock
// `YYYY-MM-DD`) on every deadline-driven response — `/dashboard/summary`
// and `/invoice-groups`. Whenever a query refetches (focus, websocket,
// user action) the client compares the response's `today` against the
// last-seen value. If it changed, we invalidate every other deadline-
// driven query family so they refetch and pick up the new "today" too.
//
// Why this is correct even when nothing seems to be ticking:
// - The deadline-driven queries already have `refetchOnWindowFocus:
//   true`, so a tab refocus alone is enough to surface the new server
//   `today` and trigger the cascade.
// - SSE-driven invalidations (claim/group events) and any user action
//   that hits the cache also drive refetches that pick up new `today`s.
// - There is no client clock involved, so a long-backgrounded tab still
//   converges the moment its first refetch returns.
//
// The hook is intentionally tiny and side-effect-only: each page passes
// the `today` it just received and we own the cross-family invalidation
// in one place. Pages no longer need to wire any rollover logic.

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getListInvoiceGroupsQueryKey } from "@workspace/api-client-react";

/**
 * Picks the lexicographically largest (i.e. most recent) `YYYY-MM-DD`
 * value from a list of candidates, ignoring null/undefined/empty
 * entries. Returns `null` if every candidate is missing.
 *
 * Why a max instead of first-non-null: pages like Queue read several
 * lane queries in parallel, and on a partial cache state one lane may
 * still have yesterday's cached payload while another has already
 * refetched today's. Taking the max guarantees we react to rollover as
 * soon as *any* lane has seen the new server day, instead of waiting
 * for whichever lane happens to come first in our fallback chain.
 *
 * Lexicographic comparison is exactly correct for `YYYY-MM-DD` strings.
 */
export function latestTodayKey(
  ...candidates: Array<string | null | undefined>
): string | null {
  let max: string | null = null;
  for (const c of candidates) {
    if (!c) continue;
    if (max === null || c > max) max = c;
  }
  return max;
}

/**
 * Pure helper, exported for testability: returns `true` iff the
 * incoming `today` is non-empty AND differs from `lastSeen`. The first
 * value we see (lastSeen === null) is *not* a rollover — we have no
 * baseline to compare against, so we just record it and wait.
 */
export function shouldInvalidateOnRollover(
  lastSeen: string | null,
  incoming: string | null | undefined,
): boolean {
  if (!incoming) return false;
  if (lastSeen === null) return false;
  return incoming !== lastSeen;
}

/**
 * Predicate matching every deadline-driven query family the Queue and
 * Dashboard read against the server's "today". Centralised here so the
 * two surfaces (and any future deadline-driven page) all invalidate the
 * same set without duplicating the list. Currently:
 *   - `/api/dashboard*` — summary, expiring groups, urgentCount, etc.
 *   - The invoice-groups list family — every lane query plus the
 *     embedded Classification Inbox payload.
 */
function isDeadlineDrivenQueryKey(key: unknown): boolean {
  if (!Array.isArray(key)) return false;
  const head = key[0];
  if (typeof head !== "string") return false;
  if (head.startsWith("/api/dashboard")) return true;
  // `getListInvoiceGroupsQueryKey()` (no args) returns the family root,
  // e.g. ["/api/invoice-groups"]. We compare on prefix so any args-bound
  // child key (lane filters, includes, etc.) also matches.
  const invoiceGroupsRoot = getListInvoiceGroupsQueryKey()[0];
  if (typeof invoiceGroupsRoot === "string" && head === invoiceGroupsRoot) {
    return true;
  }
  return false;
}

/**
 * React hook: whenever the `today` value from a server response differs
 * from the previously-seen value, invalidate every deadline-driven
 * query family so sister surfaces (other lanes, dashboard summary)
 * refetch their per-row `isUrgent` / `effectiveDaysLeft` flags against
 * the new "today".
 *
 * Pages should pass the `today` field straight through from whatever
 * deadline-driven response they already render — no extra fetch
 * required. Multiple pages can call this hook simultaneously; the
 * invalidation is idempotent and React Query dedupes concurrent
 * refetches.
 */
export function useServerDayRolloverInvalidator(
  today: string | null | undefined,
): void {
  const queryClient = useQueryClient();
  const lastSeenRef = useRef<string | null>(null);
  useEffect(() => {
    if (!today) return;
    if (shouldInvalidateOnRollover(lastSeenRef.current, today)) {
      queryClient.invalidateQueries({
        predicate: (q) => isDeadlineDrivenQueryKey(q.queryKey),
      });
    }
    lastSeenRef.current = today;
  }, [today, queryClient]);
}
