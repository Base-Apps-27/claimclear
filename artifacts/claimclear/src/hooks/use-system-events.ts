// System-event SSE listener (Task #313).
//
// Opens a single EventSource against `/api/system-events` for the duration
// of the authenticated session. Today this carries one event type:
//
//   `day_completed` — every invoice group dated for some calendar day has
//                     reached a concluded state (in-flight, closed, or
//                     outcome-Non-Issue/Withdrawn). Fires confetti and
//                     a toast for every signed-in user.
//
// The hook NEVER fires retroactively on reconnect: it stamps a
// `connectedAt` timestamp on every successful EventSource open, and
// ignores any incoming event whose own `timestamp` is older than that.
// We also keep an in-process Set of dates we've already celebrated this
// page-load so a reconnect-and-replay can't double-fire the same date.
//
// The confetti microinteraction respects `prefers-reduced-motion` — if
// the user has reduced motion enabled, we still show the toast but skip
// the canvas burst entirely.

import { useEffect, useRef } from "react";
import confetti from "canvas-confetti";
import { toast } from "@/hooks/use-toast";

type SystemEvent = {
  type: "day_completed";
  date: string;
  dateLabel: string;
  timestamp: string;
};

// Two corner bursts for a quick, low-distraction celebration. Origin is
// in normalized (x, y) where (0, 0) is top-left and (1, 1) is bottom-right.
function fireConfettiBurst(): void {
  if (typeof window === "undefined") return;
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  if (reduced) return;

  const baseOptions: confetti.Options = {
    spread: 70,
    startVelocity: 45,
    ticks: 200,
    gravity: 0.9,
    scalar: 1.1,
    zIndex: 10000,
  };

  // Left edge, angled up-and-right.
  confetti({
    ...baseOptions,
    particleCount: 80,
    angle: 60,
    origin: { x: 0.05, y: 0.85 },
  });
  // Right edge, angled up-and-left.
  confetti({
    ...baseOptions,
    particleCount: 80,
    angle: 120,
    origin: { x: 0.95, y: 0.85 },
  });
}

export function useSystemEvents(opts: { enabled: boolean }): void {
  const { enabled } = opts;
  const celebratedDates = useRef<Set<string>>(new Set());
  const retryCount = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    if (typeof window === "undefined") return;

    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;
    let connectedAt = 0;

    function handleSystemEvent(event: MessageEvent) {
      try {
        const data: SystemEvent = JSON.parse(event.data);

        // Ignore replays older than this connection — protects against
        // SSE retries delivering events from before we connected.
        const eventMs = Date.parse(data.timestamp);
        if (Number.isFinite(eventMs) && connectedAt > 0 && eventMs < connectedAt) {
          return;
        }

        if (data.type === "day_completed") {
          if (celebratedDates.current.has(data.date)) return;
          celebratedDates.current.add(data.date);
          fireConfettiBurst();
          toast({
            title: "Day complete",
            description: `Great work — all invoices for ${data.dateLabel} are processed.`,
            duration: 6000,
          });
        }
      } catch {
        // ignore malformed events
      }
    }

    function connect() {
      if (cancelled) return;
      const base = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
      es = new EventSource(`${base}/api/system-events`, { withCredentials: true });
      es.addEventListener("system_update", handleSystemEvent);
      es.onopen = () => {
        retryCount.current = 0;
        connectedAt = Date.now();
      };
      es.onerror = () => {
        es?.close();
        if (cancelled) return;
        const delay = Math.min(1000 * 2 ** Math.min(retryCount.current, 5), 30000);
        retryCount.current += 1;
        reconnectTimer = setTimeout(connect, delay);
      };
    }

    connect();

    return () => {
      cancelled = true;
      es?.close();
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, [enabled]);
}
