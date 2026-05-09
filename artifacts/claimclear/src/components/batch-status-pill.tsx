import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Clock, Zap, AlertCircle, CheckCircle2, ArrowRight } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import type { PortalBatchEvent } from "@/hooks/use-portal-batch-events";

const QUEUE_STATUS_QUERY_KEY = ["portal-submissions", "queue-status"] as const;
const POLL_INTERVAL_MS = 10_000;
const IMMINENT_THRESHOLD_MS = 15 * 60 * 1000;

interface ScheduleEntry {
  at: string;
  isPast: boolean;
  isNext: boolean;
}

interface QueueStatus {
  isRunning: boolean;
  nextBatchAt: string | null;
  prevBatchAt: string | null;
  queuedCount: number;
  runningCount: number;
  schedule: ScheduleEntry[];
}

type PillColor = "blue" | "amber" | "green" | "red" | "muted";

function apiBase(): string {
  return import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
}

async function fetchQueueStatus(): Promise<QueueStatus> {
  const res = await fetch(`${apiBase()}/api/portal-submissions/queue-status`, {
    credentials: "include",
  });
  if (!res.ok) {
    throw new Error(`queue-status: HTTP ${res.status}`);
  }
  return res.json();
}

/**
 * 1-second ticking clock so the countdown re-renders without re-fetching.
 * Polling stays at POLL_INTERVAL_MS; the tick is purely a UI re-render.
 */
function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return "any moment";
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours >= 1) return `${hours}h ${minutes}m`;
  if (minutes >= 1) return `${minutes}m`;
  return `${totalSeconds}s`;
}

// Time / weekday formatting routes through the shared time module so
// the batch pill and the rest of the app agree on the display TZ
// (#562). Previously these helpers hard-coded `America/New_York`,
// which would have drifted from the rest of the surface if the app
// TZ were ever reconfigured.
import {
  formatTime as formatTimeInDisplayTz,
  formatWeekday,
  dayKeyInDisplayTz,
  getDisplayTimezoneShort,
} from "@/lib/time";

function formatTimeET(iso: string): string {
  return formatTimeInDisplayTz(iso);
}

function formatDayTimeET(iso: string): string {
  const sameDay = dayKeyInDisplayTz(iso) === dayKeyInDisplayTz(new Date());
  if (sameDay) return formatTimeET(iso);
  return `${formatWeekday(iso)} ${formatTimeET(iso)}`;
}

interface DerivedState {
  color: PillColor;
  count: string;
  label: string;
  subtext: string;
  progress: number;
  icon: typeof Clock;
  pulse: boolean;
  running: boolean;
  empty: boolean;
  degraded: boolean;
}

function deriveState(status: QueueStatus | undefined, now: number): DerivedState {
  // Loading / no data — show muted skeleton-ish state.
  if (!status) {
    return {
      color: "muted",
      count: "–",
      label: "queued",
      subtext: "loading…",
      progress: 0,
      icon: Clock,
      pulse: false,
      running: false,
      empty: false,
      degraded: false,
    };
  }

  // Running batch — green / Zap.
  if (status.isRunning) {
    const total = status.runningCount + status.queuedCount;
    return {
      color: "green",
      count: status.runningCount > 0 ? String(status.runningCount) : "·",
      label: total > 0 ? `of ${total}` : "running",
      subtext: "Sending batch",
      progress: 100,
      icon: Zap,
      // Task #495: pulse-ring belongs to the running state — that's
      // when "the system is doing something right now" and the visual
      // halo is meaningful. The amber/imminent state already carries
      // its own colour cue and shouldn't share the same affordance.
      pulse: true,
      running: true,
      empty: false,
      degraded: false,
    };
  }

  const nextMs = status.nextBatchAt ? new Date(status.nextBatchAt).getTime() : null;
  const prevMs = status.prevBatchAt ? new Date(status.prevBatchAt).getTime() : null;
  const msUntilNext = nextMs ? nextMs - now : null;

  // Compute progress fill (% of the gap between previous and next firing
  // that has elapsed). 0 if we don't have both endpoints.
  let progress = 0;
  if (nextMs !== null && prevMs !== null && nextMs > prevMs) {
    const total = nextMs - prevMs;
    const elapsed = now - prevMs;
    progress = Math.max(0, Math.min(100, Math.round((elapsed / total) * 100)));
  }

  // Outside the cron window: next batch is on a future day. Day-key
  // comparison routes through the shared time module's display TZ
  // (#562) so the "after-hours" decision matches every other surface.
  const todayStr = dayKeyInDisplayTz(new Date(now));
  const nextDayStr = status.nextBatchAt ? dayKeyInDisplayTz(status.nextBatchAt) : null;
  const afterHours = nextDayStr !== null && nextDayStr !== todayStr;

  // Imminent: ≤15min and not after-hours.
  const imminent = !afterHours && msUntilNext !== null && msUntilNext <= IMMINENT_THRESHOLD_MS && msUntilNext > 0;

  const baseSubtext = status.nextBatchAt
    ? afterHours
      ? `next batch ${formatDayTimeET(status.nextBatchAt)}`
      : msUntilNext !== null
        ? `next batch ${formatTimeET(status.nextBatchAt)} in ${formatCountdown(msUntilNext)}`
        : `next batch ${formatTimeET(status.nextBatchAt)}`
    : "no batch scheduled";

  // Empty queue — muted, "No claims".
  if (status.queuedCount === 0) {
    return {
      color: "muted",
      count: "0",
      label: "queued",
      subtext: baseSubtext,
      progress: afterHours ? 0 : progress,
      icon: Clock,
      pulse: false,
      running: false,
      empty: true,
      degraded: false,
    };
  }

  if (afterHours) {
    return {
      color: "muted",
      count: String(status.queuedCount),
      label: "queued",
      subtext: baseSubtext,
      progress: 0,
      icon: Clock,
      pulse: false,
      running: false,
      empty: false,
      degraded: false,
    };
  }

  if (imminent) {
    return {
      color: "amber",
      count: String(status.queuedCount),
      label: "queued",
      subtext: baseSubtext,
      progress,
      icon: Clock,
      // Imminent keeps the amber tint as its visual cue; the pulse-ring
      // is reserved for the running state (Task #495).
      pulse: false,
      running: false,
      empty: false,
      degraded: false,
    };
  }

  return {
    color: "blue",
    count: String(status.queuedCount),
    label: "queued",
    subtext: baseSubtext,
    progress,
    icon: Clock,
    pulse: false,
    running: false,
    empty: false,
    degraded: false,
  };
}

const PILL_CLASSES: Record<PillColor, string> = {
  blue: "bg-blue-50 border-blue-200 text-blue-800",
  amber: "bg-amber-50 border-amber-200 text-amber-800",
  green: "bg-emerald-50 border-emerald-200 text-emerald-800",
  red: "bg-red-50 border-red-200 text-red-800",
  muted: "bg-muted/60 border-border text-muted-foreground",
};

const PROGRESS_CLASSES: Record<PillColor, string> = {
  blue: "bg-blue-700",
  amber: "bg-amber-700",
  green: "bg-emerald-700",
  red: "bg-red-700",
  muted: "bg-muted-foreground/40",
};

interface PillProps {
  state: DerivedState;
  collapsed?: boolean;
}

function PillButton({ state, collapsed = false }: PillProps) {
  const Icon = state.icon;
  return (
    <button
      data-testid="batch-status-pill-button"
      className={[
        "relative group flex items-center border rounded-md overflow-hidden transition-all hover:opacity-90 cursor-pointer",
        collapsed ? "h-8" : "h-9",
        PILL_CLASSES[state.color],
        state.pulse ? "animate-pulse-ring" : "",
      ].join(" ")}
    >
      <div className={`flex items-center h-full ${collapsed ? "px-2.5 gap-1.5" : "px-2.5 gap-2"} relative z-10`}>
        <div className="flex items-baseline gap-1">
          {!state.empty && !state.degraded && (
            <span className="font-bold text-[15px] leading-none tabular-nums tracking-tight">
              {state.count}
            </span>
          )}
          {state.empty && !collapsed && (
            <span className="font-medium text-sm leading-none">No invoices</span>
          )}
          {state.degraded && (
            <span className="w-2 h-2 rounded-full bg-red-600 animate-pulse mr-1" />
          )}
          {(!state.empty || state.degraded) && !collapsed && (
            <span className="text-[11px] font-medium leading-none opacity-80 uppercase tracking-wide">
              {state.label}
            </span>
          )}
        </div>
        <div className="w-[1px] h-3.5 opacity-20 bg-current" />
        <div className="flex items-center gap-1.5 opacity-90">
          <Icon className={`w-3.5 h-3.5 ${state.running ? "fill-current" : ""}`} />
          {!collapsed && (
            <span className="text-[11px] font-medium leading-none whitespace-nowrap">
              {state.subtext}
            </span>
          )}
        </div>
      </div>
      <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-black/5">
        <div
          className={`h-full ${PROGRESS_CLASSES[state.color]} transition-all duration-1000 ease-in-out`}
          style={{ width: `${state.progress}%` }}
        />
      </div>
    </button>
  );
}

interface PopoverContentsProps {
  status: QueueStatus | undefined;
  onNavigate: () => void;
}

function PopoverContents({ status, onNavigate }: PopoverContentsProps) {
  if (!status) {
    return (
      <div className="p-4 text-sm text-muted-foreground">Loading batch schedule…</div>
    );
  }

  const totalQueued = status.queuedCount + (status.isRunning ? status.runningCount : 0);

  return (
    <>
      <div className="p-3 border-b bg-muted/30">
        <h4 className="font-medium text-sm">Today's batches</h4>
        {status.schedule.length > 0 ? (
          <div className="flex items-center flex-wrap gap-x-1 gap-y-1.5 text-xs mt-2 text-muted-foreground">
            {status.schedule.map((entry, i) => {
              const time = formatTimeET(entry.at);
              return (
                <span key={entry.at} className="flex items-center gap-1.5">
                  {entry.isPast ? (
                    <span className="flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                      <span className="line-through opacity-70">{time}</span>
                    </span>
                  ) : entry.isNext ? (
                    <span className="font-medium text-foreground bg-amber-100 text-amber-900 px-1.5 py-0.5 rounded border border-amber-200">
                      {time} ← next
                    </span>
                  ) : (
                    <span>{time}</span>
                  )}
                  {i < status.schedule.length - 1 && <span className="text-border mx-0.5">•</span>}
                </span>
              );
            })}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground mt-2">
            No more batches today —{" "}
            {status.nextBatchAt ? `next ${formatDayTimeET(status.nextBatchAt)}` : "schedule unavailable"}
          </p>
        )}
      </div>
      <div className="p-3">
        <div className="text-xs text-muted-foreground space-y-1.5">
          {status.isRunning ? (
            <p>
              <span className="font-semibold text-foreground tabular-nums">{status.runningCount}</span>{" "}
              invoice{status.runningCount === 1 ? "" : "s"} in flight,{" "}
              <span className="font-semibold text-foreground tabular-nums">{status.queuedCount}</span>{" "}
              still queued.
            </p>
          ) : status.queuedCount === 0 ? (
            <p>No invoices queued for the next batch.</p>
          ) : (
            <p>
              <span className="font-semibold text-foreground tabular-nums">{status.queuedCount}</span>{" "}
              invoice{status.queuedCount === 1 ? "" : "s"} ready to send in the next batch.
            </p>
          )}
          {status.nextBatchAt && !status.isRunning && (
            <p>Next sweep at {formatDayTimeET(status.nextBatchAt)} {getDisplayTimezoneShort()}.</p>
          )}
        </div>
      </div>
      <div className="p-2 border-t bg-muted/10">
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-between text-xs font-medium text-primary hover:text-primary hover:bg-primary/5"
          onClick={onNavigate}
          data-testid="batch-status-pill-view-all"
        >
          {totalQueued > 0 ? "View all in Portal Submissions" : "Open Portal Submissions"}
          <ArrowRight className="w-3.5 h-3.5" />
        </Button>
      </div>
    </>
  );
}

/**
 * Persistent header pill showing queued-claim count + countdown to the next
 * scheduled portal-submission batch.
 *
 * Data flow:
 *  - `useQuery` polls /portal-submissions/queue-status every 10s.
 *  - Subscribes to the existing /portal-submissions/batch-events SSE channel
 *    so batch_started / batch_completed / row_status_changed instantly
 *    invalidate the polled query (no need to wait for the next 10s tick).
 *  - A 1s "now" ticker re-renders the countdown subtext without refetching.
 */
export function BatchStatusPill() {
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const [open, setOpen] = useState(false);

  const { data: status } = useQuery({
    queryKey: QUEUE_STATUS_QUERY_KEY,
    queryFn: fetchQueueStatus,
    refetchInterval: POLL_INTERVAL_MS,
    refetchOnWindowFocus: true,
    staleTime: 5_000,
  });

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: QUEUE_STATUS_QUERY_KEY });
  }, [queryClient]);

  // SSE subscription — re-fetch the slim status whenever a batch lifecycle
  // event arrives, so the pill updates instantly instead of waiting up to
  // 10s for the next poll.
  const reconnectAttempts = useRef(0);
  useEffect(() => {
    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      es = new EventSource(`${apiBase()}/api/portal-submissions/batch-events`, {
        withCredentials: true,
      });

      es.addEventListener("batch_update", (event: MessageEvent) => {
        let data: PortalBatchEvent;
        try {
          data = JSON.parse(event.data);
        } catch {
          return;
        }
        // Any of these events implies the queue / running counts have shifted.
        if (
          data.type === "batch_started" ||
          data.type === "batch_completed" ||
          data.type === "batch_failed" ||
          data.type === "batch_aborted" ||
          data.type === "row_status_changed"
        ) {
          invalidate();
        }
      });

      es.onopen = () => {
        reconnectAttempts.current = 0;
        // On (re)connect, reconcile in case we missed events while disconnected.
        invalidate();
      };

      es.onerror = () => {
        es?.close();
        const delay = Math.min(1000 * 2 ** Math.min(reconnectAttempts.current, 5), 30000);
        reconnectAttempts.current += 1;
        reconnectTimer = setTimeout(connect, delay);
      };
    }

    connect();
    return () => {
      es?.close();
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, [invalidate]);

  // 1s ticker keeps the countdown fresh between polls.
  const now = useNow(1000);

  const state = useMemo(() => deriveState(status, now), [status, now]);

  const handleNavigate = useCallback(() => {
    setOpen(false);
    navigate("/portal-submissions");
  }, [navigate]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {/* Wrapper div so the underlying button's outline doesn't fight Radix. */}
        <div data-testid="batch-status-pill">
          {/* Desktop: full pill with subtext. Mobile: collapsed (count + icon only). */}
          <div className="hidden sm:block">
            <PillButton state={state} />
          </div>
          <div className="block sm:hidden">
            <PillButton state={state} collapsed />
          </div>
        </div>
      </PopoverTrigger>
      <PopoverContent
        className="w-80 p-0 shadow-lg border-black/5"
        align="end"
        sideOffset={8}
        data-testid="batch-status-pill-popover"
      >
        <PopoverContents status={status} onNavigate={handleNavigate} />
      </PopoverContent>
    </Popover>
  );
}
