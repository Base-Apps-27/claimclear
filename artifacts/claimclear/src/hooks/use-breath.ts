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

/* ------------------------------------------------------------------ */
/* Bulk-action shimmer (Task #494).                                    */
/*                                                                     */
/* Sibling of `useBreath` for row-level mutations. After a successful  */
/* bulk mutate, call `triggerForIds(ids)` and the matching rows pulse  */
/* the same soft success tint together for ~600ms — long enough to    */
/* read as one confirmed sweep across the table without dragging on.   */
/* `isBreathing(id)` returns the class name to spread onto each row    */
/* (empty string when not pulsing); the dedicated `cc-row-breath`     */
/* class lives in `index.css` and is reduced-motion aware (drops the  */
/* fade keyframe to a static tint flash).                              */
/* ------------------------------------------------------------------ */
const ROW_BREATH_DURATION_MS = 600;

export interface UseRowBreathResult<Id> {
  /** Returns the row class name when `id` is currently shimmering. */
  isBreathing: (id: Id) => boolean;
  /** Spread onto the row element; empty when not breathing. */
  rowClassName: (id: Id) => string;
  /** Play the shimmer for the given set of ids. */
  triggerForIds: (ids: ReadonlyArray<Id> | ReadonlySet<Id>) => void;
}

export function useRowBreath<Id>(): UseRowBreathResult<Id> {
  const [active, setActive] = React.useState<ReadonlySet<Id>>(
    () => new Set<Id>(),
  );
  const timerRef = React.useRef<number | null>(null);

  const triggerForIds = React.useCallback(
    (ids: ReadonlyArray<Id> | ReadonlySet<Id>) => {
      const next = new Set<Id>(ids as Iterable<Id>);
      if (next.size === 0) return;
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
      setActive(next);
      timerRef.current = window.setTimeout(() => {
        setActive(new Set<Id>());
        timerRef.current = null;
      }, ROW_BREATH_DURATION_MS);
    },
    [],
  );

  React.useEffect(
    () => () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
    },
    [],
  );

  const isBreathing = React.useCallback((id: Id) => active.has(id), [active]);
  const rowClassName = React.useCallback(
    (id: Id) => (active.has(id) ? "cc-row-breath" : ""),
    [active],
  );

  return { isBreathing, rowClassName, triggerForIds };
}
