// System-event SSE listener (Task #313, expanded by Task #780).
//
// Opens a single EventSource against `/api/system-events` for the duration
// of the authenticated session. Three event types travel on this channel:
//
//   `day_completed`        — every invoice group dated for some calendar
//                            day has reached a concluded state. Fires
//                            confetti and a toast for every signed-in
//                            user. Loud — the day-end milestone.
//
//   `submission_streak`    — server-counted multiple-of-5 portal
//                            submissions confirmed today. Fires the
//                            small "session-milestone" confetti + a
//                            toast naming the count. Even tabs that
//                            opened mid-day catch up via the next
//                            pulse — no need to be present for the
//                            prior submission.
//
//   `approval_streak`      — server-counted multiple-of-3 payor
//                            responses tagged Approved / Partially
//                            Approved today. Same visual hierarchy as
//                            submission_streak.
//
// Task #780 — replay guard is OFF for this channel. Pre-#780 the hook
// dropped events whose `timestamp` predated `connectedAt`, which meant
// a user opening their tab a minute after the day flipped to "concluded"
// (or a minute after the 5th submission landed) would silently miss the
// celebration the team had earned. Within-session dedup is handled by
// the `celebratedKeys` Set below — keyed on `${type}:${timestamp}` so a
// genuine SSE replay during reconnect can never re-fire the same event.
// Cross-day dedup is handled server-side: each event type is only
// emitted on the right transition (false→true edge for day-complete,
// count-mod-N for streaks).
//
// Confetti + copy come from `lib/celebrations.ts` (Task #509). The
// hierarchy and per-tier visuals are the type system, not a comment.

import { useCallback, useRef } from "react";
import { toast } from "@/hooks/use-toast";
import { useEventSource } from "@/hooks/use-event-source";
import { fireCelebration, celebrationCopy } from "@/lib/celebrations";

type DayCompletedEvent = {
  type: "day_completed";
  date: string;
  dateLabel: string;
  timestamp: string;
};

type SubmissionStreakEvent = {
  type: "submission_streak";
  count: number;       // total submissions confirmed today
  timestamp: string;
};

type ApprovalStreakEvent = {
  type: "approval_streak";
  count: number;       // total approval/partial responses tagged today
  timestamp: string;
};

type SystemEvent =
  | DayCompletedEvent
  | SubmissionStreakEvent
  | ApprovalStreakEvent;

export function useSystemEvents(opts: { enabled: boolean }): void {
  const { enabled } = opts;
  // Within-session dedup keyed on `${type}:${timestamp}` — server emits
  // each event once per legitimate transition with a unique timestamp,
  // so this Set short-circuits accidental SSE replays on reconnect
  // without blocking events that legitimately predate `connectedAt`.
  const celebratedKeys = useRef<Set<string>>(new Set());

  const handleSystemEvent = useCallback((event: MessageEvent) => {
    try {
      const data: SystemEvent = JSON.parse(event.data);
      const key = `${data.type}:${data.timestamp}`;
      if (celebratedKeys.current.has(key)) return;
      celebratedKeys.current.add(key);

      if (data.type === "day_completed") {
        fireCelebration("day-complete");
        const copy = celebrationCopy({
          kind: "day-complete",
          dateLabel: data.dateLabel,
        });
        toast({ ...copy, duration: 6000 });
        return;
      }
      if (data.type === "submission_streak") {
        fireCelebration("session-milestone");
        toast({
          title: `${data.count} submissions today`,
          description:
            data.count >= 25
              ? "That's a serious push. Keep going."
              : data.count >= 10
                ? "Strong cadence — the queue is moving."
                : "Nice momentum — keep them coming.",
          duration: 4500,
        });
        return;
      }
      if (data.type === "approval_streak") {
        fireCelebration("session-milestone");
        toast({
          title: `${data.count} approvals tagged today`,
          description:
            data.count >= 12
              ? "Big day for recoveries — well played."
              : data.count >= 6
                ? "The wins are stacking up."
                : "Approvals are landing — nice work.",
          duration: 4500,
        });
        return;
      }
    } catch {
      // ignore malformed events
    }
  }, []);

  useEventSource({
    url: "/api/system-events",
    events: { system_update: handleSystemEvent },
    // Task #780 — replay guard intentionally OFF. See module header.
    replayGuard: false,
    enabled,
  });
}
