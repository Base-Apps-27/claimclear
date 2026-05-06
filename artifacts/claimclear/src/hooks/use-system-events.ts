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
// The hook NEVER fires retroactively on reconnect: the SSE replay guard
// in `useEventSource` stamps a `connectedAt` on every successful open
// and drops events whose own `timestamp` is older.
//
// Task #495: dedupe is keyed by event TIMESTAMP, not by date, so a day
// that re-concludes (e.g. operator reverts a closure and re-closes it)
// celebrates again. The server-side edge check guarantees a fresh
// `day_completed_celebration` row is only emitted on a true false→true
// transition; the timestamp dedupe here is purely defensive against
// SSE replay.
//
// Confetti + copy come from `lib/celebrations.ts` (Task #509). The
// hierarchy and per-tier visuals are the type system, not a comment.

import { useCallback, useRef } from "react";
import { toast } from "@/hooks/use-toast";
import { useEventSource } from "@/hooks/use-event-source";
import { fireCelebration, celebrationCopy } from "@/lib/celebrations";

type SystemEvent = {
  type: "day_completed";
  date: string;
  dateLabel: string;
  timestamp: string;
};

export function useSystemEvents(opts: { enabled: boolean }): void {
  const { enabled } = opts;
  // Task #495 — dedupe by event timestamp instead of date, so a day
  // that re-concludes after a manual revert celebrates again. The
  // server only emits a fresh row on a true false→true edge, so each
  // legitimate celebration carries a unique timestamp; SSE replay of
  // the same row will hit this set and short-circuit.
  const celebratedTimestamps = useRef<Set<string>>(new Set());

  const handleSystemEvent = useCallback((event: MessageEvent) => {
    try {
      const data: SystemEvent = JSON.parse(event.data);
      if (data.type === "day_completed") {
        if (celebratedTimestamps.current.has(data.timestamp)) return;
        celebratedTimestamps.current.add(data.timestamp);
        fireCelebration("day-complete");
        const copy = celebrationCopy({ kind: "day-complete", dateLabel: data.dateLabel });
        toast({ ...copy, duration: 6000 });
      }
    } catch {
      // ignore malformed events
    }
  }, []);

  useEventSource({
    url: "/api/system-events",
    events: { system_update: handleSystemEvent },
    replayGuard: true,
    enabled,
  });
}
