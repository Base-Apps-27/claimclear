// Session milestone celebrations (Task #491, expanded by Task #541).
//
// Tracks "claims processed this session" client-side and fires a small
// one-shot celebration when the operator crosses 10 / 25 / 50 within a
// single signed-in session. State lives in module-level singletons so:
//
//   • the counter survives component unmounts (operators move between
//     the queue, detail pages, and the dashboard while still in the
//     same "session") without resetting,
//   • dedupe is global — a single processing event in two different
//     views increments the counter exactly once,
//   • the milestone-fired set guarantees each tier celebrates exactly
//     once per session even if the operator re-loads the same claim.
//
// Reset only on full page reload / sign-out (which destroys the JS
// runtime). v1 deliberately does NOT persist across sessions.
//
// Confetti + copy come from `lib/celebrations.ts` (Task #509). The
// "session-milestone" tier is the SMALL sibling of day-complete in
// the type system; tweaking visuals or copy is a one-file edit.
//
// TASK #541 — generation-aware dedup. The original v1 keyed dedup on
// claim id only. That meant a single claim that was re-opened (e.g.
// withdraw → un-withdraw → re-process) could only ever count once
// per session, suppressing the milestone increment the operator
// expected on the second pass. The current version keys dedup on
// `${claimId}:${generation}` instead, where `generation` is any
// monotonically-changing token the caller already has on hand:
//   • the leg/group `updatedAt` ISO string off the row payload, OR
//   • the leg's status string ("processed", "filed", etc.), OR
//   • a manual epoch the caller bumps when it knows a new processing
//     pass started.
// Callers that pass no generation get the old `claimId`-only dedup
// (semantic-preserving for the two pre-#541 callsites inside
// `claim-detail-v2` and `leg-conclusion-row`). The new callsites
// (portal queue submit, email batch send, re-attestation complete,
// withdraw, non-issue closure) pass the leg's transition timestamp
// so each fresh state-machine pass increments cleanly.

import { useEffect, useSyncExternalStore } from "react";
import { toast } from "@/hooks/use-toast";
import { fireCelebration, celebrationCopy } from "@/lib/celebrations";

const MILESTONES = [10, 25, 50] as const;

// Dedup keys are `${claimId}:${generation}`. The Set still tracks
// distinct processing events; the integer count below is the size of
// the Set so the public `useSessionProcessedCount` snapshot keeps its
// existing semantics ("how many fresh processed-leg beats have we
// counted this session").
const seenEvents = new Set<string>();
const firedMilestones = new Set<number>();

// Lightweight pub/sub so UI surfaces (e.g. the top-bar pace badge) can
// subscribe to the live session count without coupling to the Set
// internals. Snapshot is the integer count; listeners fire on every
// change including resets to 0.
const listeners = new Set<() => void>();
function emit(): void {
  for (const l of listeners) l();
}
function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
function getSnapshot(): number {
  return seenEvents.size;
}

/**
 * Subscribes a React component to the live "claims processed this
 * session" count. Returns 0 when no claims have been processed yet —
 * callers should hide their UI in that case to keep the empty state
 * uncluttered.
 */
export function useSessionProcessedCount(): number {
  return useSyncExternalStore(subscribe, getSnapshot, () => 0);
}

/**
 * Record that a claim just transitioned through a fresh processing
 * step for the current operator. Dedupe is per `${claimId}:${generation}`
 * so the same claim re-processed in a later state-machine pass (e.g.
 * after a revert) increments cleanly, while replays of the SAME
 * transition from multiple SSE / refetch surfaces still collapse to
 * one increment.
 *
 * Pass any monotonically-changing string for `generation`: the leg
 * `updatedAt`, the new status name, or a hand-bumped epoch all work.
 * Omit it entirely for the legacy "once per claim id per session"
 * behavior the two pre-#541 callsites rely on.
 *
 * Returns the new session count (post-increment), or `null` if this
 * exact event was already counted this session.
 */
export function notifyClaimProcessedThisSession(
  claimId: number,
  generation?: string | number | null,
): number | null {
  const key = `${claimId}:${generation ?? ""}`;
  if (seenEvents.has(key)) return null;
  seenEvents.add(key);
  const count = seenEvents.size;
  emit();
  for (const milestone of MILESTONES) {
    if (count === milestone && !firedMilestones.has(milestone)) {
      firedMilestones.add(milestone);
      fireCelebration("session-milestone");
      const copy = celebrationCopy({ kind: "session-milestone", milestone });
      toast({ ...copy, duration: 4500 });
      break;
    }
  }
  return count;
}

/**
 * Test/dev helper. Not used in production paths — exported only so
 * unit tests can reset the singletons between cases. Importing this
 * from product code is a smell.
 */
export function __resetSessionMilestonesForTests(): void {
  seenEvents.clear();
  firedMilestones.clear();
  emit();
}

/**
 * Resets the session counters when the operator signs out. Mounted
 * once from `layout.tsx`; the effect's cleanup runs when the auth
 * gate flips back to "not authenticated".
 */
export function useSessionMilestonesLifecycle(opts: { enabled: boolean }): void {
  const { enabled } = opts;
  useEffect(() => {
    if (!enabled) return;
    return () => {
      seenEvents.clear();
      firedMilestones.clear();
      emit();
    };
  }, [enabled]);
}
