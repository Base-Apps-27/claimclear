import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetMyProcessedToday,
  getGetMyProcessedTodayQueryKey,
  getGetMyActivitySummaryQueryKey,
} from "@workspace/api-client-react";
import { useAuth } from "@workspace/replit-auth-web";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

// Visual saturation cap. The pip is a peripheral momentum cue, not a
// counter — beyond this point further claims keep filling the tooltip
// number but the ring stays "full". Picked to feel achievable on an
// average day without making 2-3 claims look like a finished day.
const PIP_VISUAL_CAP = 12;

// Arc grow-in duration. Matches the spec ("~300ms"). Skipped under
// `prefers-reduced-motion`.
const PIP_ANIMATION_MS = 300;

function getLocalTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function msUntilNextLocalMidnight(now: Date = new Date()): number {
  const next = new Date(now);
  next.setHours(24, 0, 0, 0);
  // Always at least one second out, defensively, so a clock-skew
  // millisecond doesn't make us fire the timer in a tight loop.
  return Math.max(1000, next.getTime() - now.getTime());
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  });
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);
  return reduced;
}

interface StreakPipAvatarProps {
  imageUrl?: string | null;
  fallback: string;
  className?: string;
}

// Tiny progress ring overlaid on the sidebar avatar. Quietly fills as
// the user processes claims through the day; resets at local midnight.
// Personal-only — never exposes other users' counts. See Task #317.
export function StreakPipAvatar({ imageUrl, fallback, className }: StreakPipAvatarProps) {
  const queryClient = useQueryClient();
  const { isAuthenticated, user } = useAuth();
  const reducedMotion = usePrefersReducedMotion();

  const tz = useMemo(() => getLocalTimezone(), []);

  const { data } = useGetMyProcessedToday(
    { tz },
    {
      query: {
        queryKey: getGetMyProcessedTodayQueryKey({ tz }),
        enabled: isAuthenticated && user?.status === "approved",
        // Light polling as a safety net in case an SSE event is
        // missed (e.g. while the tab was throttled). The optimistic
        // bump in `useStreakPipLiveUpdates` keeps the pip feeling
        // instant; this just reconciles drift.
        refetchInterval: 60_000,
        staleTime: 30_000,
      },
    },
  );

  const serverCount = data?.count ?? 0;
  const serverDayKey = data?.dayKey ?? null;

  // Local "displayed" count. Starts from the server count and gets
  // optimistically bumped on SSE `status_changed → Processed` events
  // initiated by this user. Reset to the server count whenever the
  // server day key flips (handles cross-midnight refetches cleanly).
  const [displayCount, setDisplayCount] = useState(serverCount);
  const lastServerDayKey = useRef<string | null>(null);

  useEffect(() => {
    // The server count is authoritative. Whenever a fresh response
    // comes in we accept it as the new floor — but we only *replace*
    // the optimistic display count if the new value is higher (the
    // safety-net refetch caught up to our optimistic bump) or the
    // day rolled over (we should reset, even if the optimistic value
    // was higher).
    if (serverDayKey !== lastServerDayKey.current) {
      lastServerDayKey.current = serverDayKey;
      setDisplayCount(serverCount);
      return;
    }
    setDisplayCount(prev => Math.max(prev, serverCount));
  }, [serverCount, serverDayKey]);

  // Cross-midnight reset, in the user's local timezone, without
  // requiring a refresh. We refetch — which, for a tab that has been
  // open across midnight, returns 0 for the new day — and that flows
  // through the displayCount-reset path above.
  useEffect(() => {
    if (!isAuthenticated || user?.status !== "approved") return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    function arm() {
      if (cancelled) return;
      timer = setTimeout(() => {
        queryClient.invalidateQueries({
          queryKey: getGetMyProcessedTodayQueryKey({ tz }),
        });
        arm();
      }, msUntilNextLocalMidnight());
    }
    arm();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [isAuthenticated, user?.status, queryClient, tz]);

  // Map count to a 0..1 fill ratio with a soft visual cap.
  const targetRatio = Math.min(1, displayCount / PIP_VISUAL_CAP);

  // Animated ratio. We tween from the previously-rendered ratio to
  // the new target over ~300ms (or jump instantly under
  // `prefers-reduced-motion`).
  const [animatedRatio, setAnimatedRatio] = useState(targetRatio);
  const frameRef = useRef<number | null>(null);
  const fromRef = useRef(targetRatio);
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    if (reducedMotion) {
      setAnimatedRatio(targetRatio);
      return;
    }
    fromRef.current = animatedRatio;
    startRef.current = null;
    if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
    function step(t: number) {
      if (startRef.current == null) startRef.current = t;
      const elapsed = t - startRef.current;
      const k = Math.min(1, elapsed / PIP_ANIMATION_MS);
      // ease-out cubic — the same gentle deceleration the rest of
      // the app uses for tiny ambient transitions.
      const eased = 1 - Math.pow(1 - k, 3);
      const next = fromRef.current + (targetRatio - fromRef.current) * eased;
      setAnimatedRatio(next);
      if (k < 1) frameRef.current = requestAnimationFrame(step);
    }
    frameRef.current = requestAnimationFrame(step);
    return () => {
      if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
    };
    // We only re-run when the *target* moves; chasing animatedRatio
    // here would restart the tween every frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetRatio, reducedMotion]);

  const tooltipLabel =
    displayCount === 0
      ? "No invoices processed yet today"
      : displayCount === 1
        ? "1 invoice processed today"
        : `${displayCount} invoices processed today`;

  // SVG geometry. The ring sits flush around the 36px avatar with a
  // tiny outer halo so it reads against either the dark sidebar or
  // the avatar's own image.
  const size = 44;
  const center = size / 2;
  const radius = 20;
  const stroke = 2.5;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - animatedRatio);
  const empty = displayCount === 0;

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn("relative inline-flex shrink-0", className)}
            style={{ width: size, height: size }}
            data-testid="streak-pip-avatar"
            aria-label={tooltipLabel}
          >
            <svg
              width={size}
              height={size}
              viewBox={`0 0 ${size} ${size}`}
              className="absolute inset-0 pointer-events-none"
              aria-hidden="true"
            >
              <circle
                cx={center}
                cy={center}
                r={radius}
                fill="none"
                stroke="currentColor"
                strokeWidth={stroke}
                className="text-sidebar-foreground/15"
              />
              <circle
                cx={center}
                cy={center}
                r={radius}
                fill="none"
                stroke="currentColor"
                strokeWidth={stroke}
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={dashOffset}
                transform={`rotate(-90 ${center} ${center})`}
                className={cn(
                  "transition-colors",
                  empty
                    ? "text-transparent"
                    : animatedRatio >= 1
                      ? "text-emerald-400"
                      : "text-emerald-400/70",
                )}
                data-testid="streak-pip-arc"
                data-count={displayCount}
                data-ratio={animatedRatio.toFixed(3)}
              />
            </svg>
            <Avatar className="h-9 w-9 border border-sidebar-border absolute inset-0 m-auto">
              <AvatarImage src={imageUrl || undefined} />
              <AvatarFallback className="bg-sidebar-accent text-sidebar-foreground">
                {fallback}
              </AvatarFallback>
            </Avatar>
          </span>
        </TooltipTrigger>
        <TooltipContent side="top">{tooltipLabel}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// Status values whose group `status_changed` events flowing through
// the `/api/invoice-groups/events` SSE channel are themselves
// qualifying activity for the personal pip counter (Task #522).
// Mirrors EXACTLY the server-side `qualifyingActivityPredicate()`
// status-shaped clause — `group_status_changed` is qualifying ONLY
// when `metadata->>'to' = 'Portal Queued'`. Other terminal flips
// (Resolved / Denied / Withdrawn / Non-Issue) write a separate
// `group_outcome_changed` audit row that is qualifying on its own,
// and arrive on the wire as `type: "outcome_changed"` events — those
// drive the pip via `QUALIFYING_GROUP_EVENT_TYPES_FOR_PIP` below,
// not via this status set. Keeping the two channels separate avoids
// double-counting the same closure (which writes both an
// outcome_changed audit AND a status_changed audit for the
// terminal status, but only the outcome_changed one is qualifying).
const QUALIFYING_GROUP_STATUSES_FOR_PIP = new Set<string>([
  "Portal Queued",
]);

// Group SSE event types that are themselves qualifying activity
// regardless of the carried status. `outcome_changed` corresponds to
// the qualifying `group_outcome_changed` audit row written by both
// `transitionGroupOutcome` and `transitionGroupStatusAndOutcome`.
const QUALIFYING_GROUP_EVENT_TYPES_FOR_PIP = new Set<string>([
  "outcome_changed",
]);

// Claim SSE event types that map 1:1 to a qualifying audit row from
// `qualifyingActivityPredicate()`. `outcome_changed` corresponds to
// the claim-level `outcome_changed` audit row written by
// `transitionClaimOutcome`. Other qualifying claim-level audit rows
// (manual `leg_excluded`, `attestation_queued`, `closure_addressed`,
// `attestation_queue_confirmed`, `mas_reattest_recorded_offline`,
// `claims_imported`, manual `portal_submission_confirmed`) do not
// have a single dedicated SSE event type — they ride on
// `claim_updated`, `attestation_updated`, `verdict_recorded`, or
// no SSE event at all. For those we conservatively invalidate the
// pip query (no optimistic +1) so the cache reconciles to the
// authoritative server count within one render, instead of waiting
// up to 60s for the polling refetch.
const QUALIFYING_CLAIM_EVENT_TYPES_FOR_PIP_BUMP = new Set<string>([
  "outcome_changed",
]);

// Optimistic-bump hook. Keep this colocated with the pip so the only
// SSE consumer that touches the personal counter lives next to the
// component that renders it. Listens to the global invoice-group SSE
// channel; when a `status_changed` event arrives whose actor is the
// current user and whose new status is in the qualifying set above
// (Task #522 broadening), bumps the cached count by 1 AND invalidates
// the avatar hover-card's activity-summary query so the heatmap +
// stats stay fresh after every in-session action. The polling
// refetch in `StreakPipAvatar` invalidates the pip as a safety net
// for any qualifying audit rows that don't have an SSE counterpart.
// Server-side definition lives in `GET /dashboard/my-processed-today`
// and `GET /dashboard/my-activity-summary` (shared predicate).
export function useStreakPipLiveUpdates() {
  const queryClient = useQueryClient();
  const { user, isAuthenticated } = useAuth();
  const tz = useMemo(() => getLocalTimezone(), []);
  const seenIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!isAuthenticated || user?.status !== "approved" || !user?.email) return;
    const userEmail = user.email;
    const sources: EventSource[] = [];
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let retry = 0;
    let cancelled = false;

    // Invalidate the avatar hover-card's activity-summary query.
    // Called on every qualifying SSE event from the current user
    // (status changes AND non-status mutations like claim_edited /
    // claim_updated / verdict_recorded / attestation_updated /
    // note_added — all of which correspond to qualifying audit
    // actions). Keyed on the same tz the card uses so React Query
    // hits the same entry the hook reads from.
    function refreshActivitySummary() {
      queryClient.invalidateQueries({
        queryKey: getGetMyActivitySummaryQueryKey({ tz }),
      });
    }

    function bumpPip() {
      const queryKey = getGetMyProcessedTodayQueryKey({ tz });
      queryClient.setQueryData<
        { count: number; timezone: string; dayKey: string } | undefined
      >(queryKey, (prev) => {
        if (!prev) return prev;
        return { ...prev, count: prev.count + 1 };
      });
      // Safety net: confirm against the server shortly after, so a
      // missed SSE or a transient state on the server never strands
      // the pip on a stale value.
      queryClient.invalidateQueries({ queryKey });
      refreshActivitySummary();
    }

    // Conservative dedupe: pin to (channel, eventType, id, timestamp)
    // so legitimate repeated events still count but reconnect-replay
    // doesn't.
    function shouldProcess(channel: string, type: string, id: number | string, ts: string | undefined): boolean {
      const key = `${channel}::${type}::${id}::${ts ?? ""}`;
      if (seenIds.current.has(key)) return false;
      seenIds.current.add(key);
      if (seenIds.current.size > 400) {
        const first = seenIds.current.values().next().value;
        if (first !== undefined) seenIds.current.delete(first);
      }
      return true;
    }

    function onGroupUpdate(event: MessageEvent) {
      try {
        const data = JSON.parse(event.data) as {
          type?: string;
          invoiceGroupId?: number;
          userEmail?: string | null;
          toStatus?: string | null;
          timestamp?: string;
        };
        if (!data.type || !data.userEmail || data.userEmail !== userEmail) return;
        if (!shouldProcess("group", data.type, data.invoiceGroupId ?? "?", data.timestamp)) return;
        // Always refresh the hover card on any same-user group event:
        // outcome_changed (group closure), status_changed, group_edited,
        // attestation_updated, verdict_recorded, sop_advanced/terminal,
        // note_added/note_deleted — the server-side qualifying predicate
        // is the source of truth, so we just nudge the cache and let
        // the endpoint decide what counts.
        refreshActivitySummary();
        // Pip ring bumps optimistically only on events that map 1:1
        // to a qualifying audit row, mirroring the server predicate
        // exactly so `Math.max(prev, serverCount)` can never strand
        // an over-bump for the rest of the day. Anything missed here
        // is reconciled by the 60s polling refetch in `StreakPipAvatar`.
        const isQualifyingStatus =
          data.type === "status_changed" &&
          !!data.toStatus &&
          QUALIFYING_GROUP_STATUSES_FOR_PIP.has(data.toStatus);
        const isQualifyingEvent = QUALIFYING_GROUP_EVENT_TYPES_FOR_PIP.has(data.type);
        if (isQualifyingStatus || isQualifyingEvent) {
          bumpPip();
        }
      } catch {
        // ignore malformed events
      }
    }

    function onClaimUpdate(event: MessageEvent) {
      try {
        const data = JSON.parse(event.data) as {
          type?: string;
          claimId?: number;
          userEmail?: string | null;
          timestamp?: string;
        };
        if (!data.type || !data.userEmail || data.userEmail !== userEmail) return;
        if (!shouldProcess("claim", data.type, data.claimId ?? "?", data.timestamp)) return;
        // Always refresh the hover-card's activity summary on any
        // same-user claim event — server predicate is the source of
        // truth for what counts.
        refreshActivitySummary();
        // Pip ring: bump optimistically only when the SSE event maps
        // 1:1 to a qualifying audit row (claim `outcome_changed`).
        // For other claim events that *might* have written a
        // qualifying audit row (claim_updated, attestation_updated,
        // verdict_recorded, claim_edited), invalidate the pip query
        // so it reconciles to the authoritative server count
        // immediately instead of waiting for the 60s safety-net poll.
        if (QUALIFYING_CLAIM_EVENT_TYPES_FOR_PIP_BUMP.has(data.type)) {
          bumpPip();
        } else {
          queryClient.invalidateQueries({
            queryKey: getGetMyProcessedTodayQueryKey({ tz }),
          });
        }
      } catch {
        // ignore malformed events
      }
    }

    function connect() {
      if (cancelled) return;
      const base = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
      const groupES = new EventSource(`${base}/api/invoice-groups/events`, {
        withCredentials: true,
      });
      groupES.addEventListener("group_update", onGroupUpdate);
      groupES.onopen = () => { retry = 0; };
      groupES.onerror = () => {
        groupES.close();
        scheduleReconnect();
      };
      sources.push(groupES);

      const claimES = new EventSource(`${base}/api/claims/events`, {
        withCredentials: true,
      });
      // The global claim channel emits a NAMED `claim_update` event
      // (see `sendEvent` in `artifacts/api-server/src/lib/sse.ts`).
      // Using `onmessage` here would silently miss every claim event,
      // which is what regressed in the prior round of this task.
      claimES.addEventListener("claim_update", onClaimUpdate);
      claimES.onerror = () => {
        claimES.close();
        scheduleReconnect();
      };
      sources.push(claimES);
    }

    function scheduleReconnect() {
      if (cancelled || reconnectTimer) return;
      const delay = Math.min(1000 * 2 ** Math.min(retry, 5), 30000);
      retry += 1;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        // Tear down any half-open sources before reconnecting both.
        while (sources.length) sources.pop()?.close();
        connect();
      }, delay);
    }

    connect();
    return () => {
      cancelled = true;
      while (sources.length) sources.pop()?.close();
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, [isAuthenticated, user?.status, user?.email, queryClient, tz]);
}
