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
//
// Task #495: dedupe is keyed by event TIMESTAMP, not by date, so a day
// that re-concludes (e.g. operator reverts a closure and re-closes it)
// celebrates again. The server-side edge check guarantees a fresh
// `day_completed_celebration` row is only emitted on a true false→true
// transition; the timestamp dedupe here is purely defensive against
// SSE replay (the same emitted row redelivered on reconnect).
//
// The confetti microinteraction respects `prefers-reduced-motion` — if
// the user has reduced motion enabled, we still show the toast but skip
// the canvas burst entirely.
//
// ── Confetti size hierarchy (Task #495) ─────────────────────────────────
// `fireConfettiBurst` below is RESERVED for the day-complete celebration:
// dual corner bursts × 80 particles, the loudest visual signal in the app.
// Smaller, scoped microinteractions (e.g. "you finished a leg",
// "submitted to portal") MUST NOT reuse this helper — they belong on the
// CSS-driven `cc-check-tick` / `cc-pill-just-transitioned` family or on
// a future, distinctly-named confetti helper with a smaller particle
// count, narrower spread, and lower z-index. Do not factor a parameterised
// `fireConfetti(size)` here without a deliberate UX review — the existing
// hierarchy is the affordance, not an accident.

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
//
// SIZE HIERARCHY (Task #495): this is the LARGEST celebration in the
// app — two simultaneous bursts of 80 particles each, full viewport
// spread, top z-index. Reserved for `day_completed`. Do NOT reuse for
// per-leg or per-group microinteractions; introduce a distinct helper
// (e.g. `fireMiniBurst`) with smaller particle count and tighter spread
// if a smaller celebration is needed.
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
  // Task #495 — dedupe by event timestamp instead of date, so a day
  // that re-concludes after a manual revert celebrates again. The
  // server only emits a fresh row on a true false→true edge, so each
  // legitimate celebration carries a unique timestamp; SSE replay of
  // the same row will hit this set and short-circuit.
  const celebratedTimestamps = useRef<Set<string>>(new Set());
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
          if (celebratedTimestamps.current.has(data.timestamp)) return;
          celebratedTimestamps.current.add(data.timestamp);
          fireConfettiBurst();
          // Task #491 — warmer copy on a Friday afternoon (local time).
          // "Reasonable hour" here is 14:00 (2pm) onward so an 11am
          // Friday wrap still reads as a normal day-complete; the
          // weekend nod kicks in once the afternoon is underway.
          const now = new Date();
          const isFridayAfternoon = now.getDay() === 5 && now.getHours() >= 14;
          toast({
            title: isFridayAfternoon
              ? "Day complete — have a good weekend"
              : "Day complete",
            description: isFridayAfternoon
              ? `All invoices for ${data.dateLabel} are processed. Enjoy the weekend.`
              : `Great work — all invoices for ${data.dateLabel} are processed.`,
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
