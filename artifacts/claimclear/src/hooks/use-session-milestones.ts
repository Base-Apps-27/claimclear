// Session milestone celebrations (Task #491).
//
// Tracks "claims processed this session" client-side and fires a small
// one-shot celebration when the operator crosses 10 / 25 / 50 within a
// single signed-in session. State lives in module-level singletons so:
//
//   • the counter survives component unmounts (operators move between
//     the queue, detail pages, and the dashboard while still in the
//     same "session") without resetting,
//   • dedupe is global — a single claim transitioning to processed in
//     two different views increments the counter exactly once,
//   • the milestone-fired set guarantees each tier celebrates exactly
//     once per session even if the operator re-loads the same claim.
//
// Reset only on full page reload / sign-out (which destroys the JS
// runtime). v1 deliberately does NOT persist across sessions.
//
// Confetti + copy come from `lib/celebrations.ts` (Task #509). The
// "session-milestone" tier is the SMALL sibling of day-complete in
// the type system; tweaking visuals or copy is a one-file edit.

import { useEffect, useSyncExternalStore } from "react";
import { toast } from "@/hooks/use-toast";
import { fireCelebration, celebrationCopy } from "@/lib/celebrations";

const MILESTONES = [10, 25, 50] as const;

const seenClaims = new Set<number>();
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
  return seenClaims.size;
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
 * Record that a claim just transitioned to processed for the current
 * operator. Dedupe is per-claim so callers can fire freely from any
 * watcher that already gates on "the operator caused this transition"
 * (see `setJustProcessed(true)` in claim-detail-v2 / leg-conclusion-row).
 *
 * Returns the new session count (post-increment), or `null` if the
 * claim was already counted this session.
 */
export function notifyClaimProcessedThisSession(claimId: number): number | null {
  if (seenClaims.has(claimId)) return null;
  seenClaims.add(claimId);
  const count = seenClaims.size;
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
  seenClaims.clear();
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
      seenClaims.clear();
      firedMilestones.clear();
      emit();
    };
  }, [enabled]);
}
