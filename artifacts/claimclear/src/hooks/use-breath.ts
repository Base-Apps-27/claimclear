import * as React from "react";

// Save-confirmation "breath" microinteraction (Task #316).
//
// A ~250ms one-shot animation used in place of a generic "Saved" toast on
// small/routine save sites (notes, inline edits, evidence metadata,
// decision-tree narrative tweaks). The CSS class lives in `index.css`
// (.animate-cc-breath) and combines a small scale-down + soft success
// tint, with a `prefers-reduced-motion` variant that drops the scale and
// only tints. The button is briefly disabled while `breathing` is true so
// it can't be double-clicked mid-animation.
const BREATH_DURATION_MS = 250;

export interface UseBreathResult {
  /** True while the animation is playing. Use to disable the button. */
  breathing: boolean;
  /** Call on a successful routine save to play the animation. */
  trigger: () => void;
  /** Class name to spread onto the button (empty when not breathing). */
  className: string;
}

export function useBreath(): UseBreathResult {
  const [breathing, setBreathing] = React.useState(false);
  const timerRef = React.useRef<number | null>(null);

  const trigger = React.useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setBreathing(true);
    timerRef.current = window.setTimeout(() => {
      setBreathing(false);
      timerRef.current = null;
    }, BREATH_DURATION_MS);
  }, []);

  React.useEffect(
    () => () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
    },
    [],
  );

  return {
    breathing,
    trigger,
    className: breathing ? "animate-cc-breath" : "",
  };
}
