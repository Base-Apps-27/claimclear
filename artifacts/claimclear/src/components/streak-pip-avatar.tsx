import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetMyProcessedToday,
  getGetMyProcessedTodayQueryKey,
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

// Optimistic-bump hook. Keep this colocated with the pip so the only
// SSE consumer that touches the personal counter lives next to the
// component that renders it. Listens to the global invoice-group SSE
// channel; when a `status_changed` event arrives whose actor is the
// current user and whose new status is `Portal Queued` (operator
// finished the worktree and submitted to the portal), bumps the
// cached count by 1. The polling refetch in `StreakPipAvatar`
// invalidates as a safety net. Server-side definition lives in
// `GET /dashboard/my-processed-today`.
export function useStreakPipLiveUpdates() {
  const queryClient = useQueryClient();
  const { user, isAuthenticated } = useAuth();
  const tz = useMemo(() => getLocalTimezone(), []);
  const seenIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!isAuthenticated || user?.status !== "approved" || !user?.email) return;
    const userEmail = user.email;
    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let retry = 0;
    let cancelled = false;

    function bump() {
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
    }

    function onStatusChanged(event: MessageEvent) {
      try {
        const data = JSON.parse(event.data) as {
          type?: string;
          invoiceGroupId?: number;
          userEmail?: string | null;
          toStatus?: string | null;
          timestamp?: string;
        };
        if (data.type !== "status_changed") return;
        if (data.toStatus !== "Portal Queued") return;
        if (!data.userEmail || data.userEmail !== userEmail) return;
        // Dedupe — the SSE channel can occasionally double-deliver
        // on reconnect. Pin on (invoiceGroupId, timestamp) so a real
        // legitimate second transition into Portal Queued (e.g. moved
        // out and back in) still counts.
        const dedupeKey = `${data.invoiceGroupId ?? "?"}::${data.timestamp ?? ""}`;
        if (seenIds.current.has(dedupeKey)) return;
        seenIds.current.add(dedupeKey);
        if (seenIds.current.size > 200) {
          // Soft cap so the dedupe set doesn't grow forever on
          // long-lived sessions.
          const first = seenIds.current.values().next().value;
          if (first !== undefined) seenIds.current.delete(first);
        }
        bump();
      } catch {
        // ignore malformed events
      }
    }

    function connect() {
      if (cancelled) return;
      const base = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
      es = new EventSource(`${base}/api/invoice-groups/events`, {
        withCredentials: true,
      });
      es.addEventListener("group_update", onStatusChanged);
      es.onopen = () => {
        retry = 0;
      };
      es.onerror = () => {
        es?.close();
        if (cancelled) return;
        const delay = Math.min(1000 * 2 ** Math.min(retry, 5), 30000);
        retry += 1;
        reconnectTimer = setTimeout(connect, delay);
      };
    }

    connect();
    return () => {
      cancelled = true;
      es?.close();
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, [isAuthenticated, user?.status, user?.email, queryClient, tz]);
}
