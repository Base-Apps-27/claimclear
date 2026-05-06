import { useEffect, useRef, useState } from "react";

const DURATION_MS = 400;
const SNAP_DELTA = 2;

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/**
 * Animate a number from its previous value to the next over ~400ms using
 * requestAnimationFrame. Snaps instantly when:
 *   - it's the first render (no prior value to animate from)
 *   - the delta is tiny (|next - prev| <= SNAP_DELTA) — avoids jittery
 *     micro-animations on small ticks
 *   - the user has `prefers-reduced-motion: reduce` set
 */
export function useNumberTicker(target: number): number {
  const [display, setDisplay] = useState(target);
  const rafRef = useRef<number | null>(null);
  const fromRef = useRef<number>(target);
  const startedRef = useRef<boolean>(false);

  useEffect(() => {
    if (!startedRef.current) {
      startedRef.current = true;
      fromRef.current = target;
      setDisplay(target);
      return;
    }

    const from = fromRef.current;
    const to = target;
    if (from === to) return;

    if (Math.abs(to - from) <= SNAP_DELTA || prefersReducedMotion()) {
      fromRef.current = to;
      setDisplay(to);
      return;
    }

    const startTime = performance.now();
    const tick = (now: number) => {
      const elapsed = now - startTime;
      const t = Math.min(1, elapsed / DURATION_MS);
      const eased = easeOutCubic(t);
      const current = from + (to - from) * eased;
      setDisplay(current);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = to;
        rafRef.current = null;
      }
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      fromRef.current = target;
    };
  }, [target]);

  return display;
}
