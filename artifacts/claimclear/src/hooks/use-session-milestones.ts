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
// runtime). v1 deliberately does NOT persist across sessions — see
// the task "Out of scope" notes.
//
// ── Confetti size hierarchy (Task #495 / Task #491) ────────────────────
// `fireMiniBurst` below is the SMALL sibling of the day-complete burst
// in `use-system-events.ts`. Single origin, ~30 particles, narrower
// spread, shorter ticks — visibly distinct from the dual-corner
// 80-particle day-complete burst so the celebration hierarchy reads as
// "small win" vs "the day is done". Do not raise the particle count or
// add a second origin without a deliberate UX review.

import { useEffect } from "react";
import confetti from "canvas-confetti";
import { toast } from "@/hooks/use-toast";

const MILESTONES = [10, 25, 50] as const;

const seenClaims = new Set<number>();
const firedMilestones = new Set<number>();

function fireMiniBurst(): void {
  if (typeof window === "undefined") return;
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  if (reduced) return;

  confetti({
    particleCount: 30,
    spread: 50,
    startVelocity: 30,
    ticks: 120,
    gravity: 1,
    scalar: 0.85,
    origin: { x: 0.5, y: 0.3 },
    zIndex: 9999,
  });
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
  for (const milestone of MILESTONES) {
    if (count === milestone && !firedMilestones.has(milestone)) {
      firedMilestones.add(milestone);
      fireMiniBurst();
      toast({
        title: `${milestone} claims processed today`,
        description:
          milestone === 10
            ? "Nice pace — keep it up."
            : milestone === 25
              ? "Solid run. The queue is feeling lighter."
              : "Outstanding pace today.",
        duration: 4500,
      });
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
    };
  }, [enabled]);
}
