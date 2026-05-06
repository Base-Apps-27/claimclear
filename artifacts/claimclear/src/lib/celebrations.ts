// Celebration registry (Task #509).
//
// One module owns every confetti burst in the app. Two consequences:
//
//   1. The hierarchy is the type system, not a comment. There is no
//      `fireCelebration("custom", { particleCount: 200 })` escape
//      hatch — adding a new tier requires editing this file. The
//      load-bearing comment blocks that used to live atop
//      `use-system-events.ts` and `use-session-milestones.ts` are no
//      longer the only thing keeping the hierarchy intact.
//
//   2. `canvas-confetti` is imported from exactly one place. Any new
//      micro-interaction that wants to celebrate routes through
//      `fireCelebration(tier)`; direct imports of `canvas-confetti`
//      anywhere else in the codebase are a smell. (We deliberately
//      did not add an ESLint rule for this — keeping the convention
//      tight enough to enforce by code review.)
//
// `celebrationCopy(tier, context)` lives here too so toast copy for a
// celebration tier ships with its visual definition. Future variants
// (month-end, end-of-quarter, …) become a single edit in this file
// rather than touching the SSE handler that fires the toast.

import confetti from "canvas-confetti";
import { prefersReducedMotion } from "@/hooks/use-reduced-motion";

export type CelebrationTier = "day-complete" | "session-milestone";

const DAY_COMPLETE_BASE: confetti.Options = {
  spread: 70,
  startVelocity: 45,
  ticks: 200,
  gravity: 0.9,
  scalar: 1.1,
  zIndex: 10000,
};

/**
 * Fires the visual celebration for the given tier. Reduced-motion is
 * honored once, here, so callers don't repeat the `matchMedia` check.
 *
 * Callers that also want to toast should pair this with
 * `celebrationCopy(tier, …)` so visual + copy stay in lockstep.
 */
export function fireCelebration(tier: CelebrationTier): void {
  if (typeof window === "undefined") return;
  if (prefersReducedMotion()) return;

  switch (tier) {
    case "day-complete":
      // Dual corner bursts × 80 particles, the loudest visual signal
      // in the app. Reserved for the end-of-day milestone.
      confetti({
        ...DAY_COMPLETE_BASE,
        particleCount: 80,
        angle: 60,
        origin: { x: 0.05, y: 0.85 },
      });
      confetti({
        ...DAY_COMPLETE_BASE,
        particleCount: 80,
        angle: 120,
        origin: { x: 0.95, y: 0.85 },
      });
      return;
    case "session-milestone":
      // Single mid-screen burst, ~30 particles, narrower spread. The
      // SMALL sibling of day-complete so the hierarchy reads as
      // "small win" vs "the day is done."
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
      return;
  }
}

export interface DayCompleteCopyContext {
  kind: "day-complete";
  dateLabel: string;
  /**
   * `Date.now()`-equivalent moment to render copy against. Injected
   * so tests can pin Friday-afternoon variants without monkey-patching
   * the global Date.
   */
  now?: Date;
}

export interface SessionMilestoneCopyContext {
  kind: "session-milestone";
  milestone: 10 | 25 | 50;
}

export type CelebrationCopyContext =
  | DayCompleteCopyContext
  | SessionMilestoneCopyContext;

export interface CelebrationCopy {
  title: string;
  description: string;
}

/**
 * Returns the toast copy for a celebration. Centralizes:
 *   • the Friday-afternoon variant of the day-complete copy
 *     (previously inlined in `use-system-events.ts`),
 *   • the per-tier 10/25/50 milestone copy
 *     (previously inlined in `use-session-milestones.ts`).
 */
export function celebrationCopy(ctx: CelebrationCopyContext): CelebrationCopy {
  if (ctx.kind === "day-complete") {
    const now = ctx.now ?? new Date();
    // "Reasonable hour" here is 14:00 (2pm) onward so an 11am Friday
    // wrap still reads as a normal day-complete; the weekend nod
    // kicks in once the afternoon is underway.
    const isFridayAfternoon = now.getDay() === 5 && now.getHours() >= 14;
    return isFridayAfternoon
      ? {
          title: "Day complete — have a good weekend",
          description: `All invoices for ${ctx.dateLabel} are processed. Enjoy the weekend.`,
        }
      : {
          title: "Day complete",
          description: `Great work — all invoices for ${ctx.dateLabel} are processed.`,
        };
  }
  // session-milestone
  const description =
    ctx.milestone === 10
      ? "Nice pace — keep it up."
      : ctx.milestone === 25
        ? "Solid run. The queue is feeling lighter."
        : "Outstanding pace today.";
  return {
    title: `${ctx.milestone} claims processed today`,
    description,
  };
}
