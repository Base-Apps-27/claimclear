import * as React from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

/**
 * Non-hook accessor for the same media query the `useReducedMotion`
 * hook subscribes to. Use this from non-React contexts (one-shot
 * confetti helpers, RAF-driven animations, module-level handlers)
 * where pulling in a hook would be inappropriate.
 *
 * Returns `false` during SSR or in environments without `matchMedia`.
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia(QUERY).matches;
}

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = React.useState<boolean>(() => prefersReducedMotion());

  React.useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia(QUERY);
    const onChange = () => setReduced(mql.matches);
    if (mql.addEventListener) {
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    }
    mql.addListener(onChange);
    return () => mql.removeListener(onChange);
  }, []);

  return reduced;
}
