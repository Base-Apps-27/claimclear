// Welcome-back wins toast (Task #780, F).
//
// Once per browser session per calendar day, on the first time the
// dashboard summary loads with non-zero approvals in the resolution-
// anchored window, fire a quiet toast that names what the team has
// already won today. No confetti — the wins-hero on the dashboard is
// the visual celebration; this is the audible acknowledgment that
// fires the moment the operator opens the app, even if every other
// celebration source (SSE, session milestones, day-complete) stays
// quiet for the rest of the session.
//
// Dedup is sessionStorage-keyed by ISO date so:
//   • the same browser tab won't fire the toast twice in a session,
//   • a page reload still won't refire it (matters for HMR + the
//     session-milestone storage rationale that lives next to it),
//   • crossing midnight produces a fresh date key, so tomorrow's
//     first wins toast fires cleanly.
//
// Silent path: if the summary endpoint returns zero approvals
// (closedOutcomes.approved + .partiallyApproved) the toast does not
// fire and the session-storage flag is NOT set, so a later refetch
// that surfaces the day's first approval can still trigger the toast.

import { useEffect, useRef } from "react";
import {
  useGetDashboardSummary,
  getGetDashboardSummaryQueryKey,
} from "@workspace/api-client-react";
import { toast } from "@/hooks/use-toast";

const STORAGE_KEY_PREFIX = "cc:welcome-back-shown:";

function todayKey(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function alreadyShownToday(): boolean {
  try {
    if (typeof window === "undefined" || !window.sessionStorage) return false;
    return window.sessionStorage.getItem(STORAGE_KEY_PREFIX + todayKey()) === "1";
  } catch {
    return false;
  }
}

function markShownToday(): void {
  try {
    if (typeof window === "undefined" || !window.sessionStorage) return;
    window.sessionStorage.setItem(STORAGE_KEY_PREFIX + todayKey(), "1");
    // Sweep stale day keys so storage doesn't grow unbounded for users
    // who never close the tab.
    const keep = STORAGE_KEY_PREFIX + todayKey();
    for (let i = window.sessionStorage.length - 1; i >= 0; i -= 1) {
      const k = window.sessionStorage.key(i);
      if (k && k.startsWith(STORAGE_KEY_PREFIX) && k !== keep) {
        window.sessionStorage.removeItem(k);
      }
    }
  } catch {
    /* ignore quota / disabled */
  }
}

function formatCurrencyShort(amountUsd: string | number | null | undefined): string {
  // Server serializes Postgres decimals as strings (e.g.
  // amounts.recoveredAmount is `string | null`). Normalize before
  // formatting; non-finite / non-positive values yield the empty
  // string so the toast copy can fall back to the no-dollars variant.
  const n = typeof amountUsd === "string" ? Number(amountUsd) : amountUsd ?? null;
  if (n == null || !Number.isFinite(n) || n <= 0) {
    return "";
  }
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

export function useWelcomeBackWinsToast(opts: { enabled: boolean }): void {
  const { enabled } = opts;
  const firedRef = useRef(false);
  // Share cache with the dashboard page's existing query — same key,
  // no extra network hit when the dashboard is the landing surface.
  const { data: summary } = useGetDashboardSummary({
    query: {
      queryKey: getGetDashboardSummaryQueryKey(),
      enabled,
      // Don't refetch on focus for this hook — the dashboard page
      // owns the live refresh cadence; we only need the first
      // available snapshot.
      refetchOnWindowFocus: false,
    },
  });

  useEffect(() => {
    if (!enabled) return;
    if (firedRef.current) return;
    if (!summary) return;
    if (alreadyShownToday()) {
      // Persisted dedup wins — record the local ref so we don't
      // re-check storage on every render in this session.
      firedRef.current = true;
      return;
    }
    // closedOutcomes is now ALL-TIME (no 7d gate), so use the
    // 7d-windowed netChangeRecovered as the SOLE trigger signal.
    // Strict 7d gate by design: the welcome-back toast is supposed
    // to celebrate momentum, not the lifetime tally. A tenant with
    // a busy past but a quiet week shouldn't get the toast every
    // session. Quiet path: if recent recovery is zero/negative we
    // return WITHOUT marking shown, so a later refetch in the same
    // session that surfaces today's first win can still trigger.
    const recentRecoveredUsd = summary.amounts?.netChangeRecovered ?? null;
    const recentRecoveredNum = recentRecoveredUsd != null
      ? Number(recentRecoveredUsd)
      : 0;
    if (!Number.isFinite(recentRecoveredNum) || recentRecoveredNum <= 0) return;
    const closed = summary.closedOutcomes;
    const totalApprovals =
      (closed?.approved ?? 0) + (closed?.partiallyApproved ?? 0);
    const dollars = formatCurrencyShort(recentRecoveredNum);
    const description = totalApprovals > 0
      ? `${dollars} of fresh wins landed in the last 7 days — ${totalApprovals} approval${totalApprovals === 1 ? "" : "s"} on the all-time board. Let's add to it.`
      : `${dollars} of fresh wins landed in the last 7 days. Let's add to it.`;
    toast({
      title: "Welcome back",
      description,
      duration: 5000,
    });
    firedRef.current = true;
    markShownToday();
  }, [enabled, summary]);
}
