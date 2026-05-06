import * as React from "react";

// One-shot transient-flag primitives (Task #509).
//
// Every micro-interaction in the app eventually reduces to "set a flag
// true now, set it false N ms later, and clean up the timer on
// unmount." Before this consolidation that exact pattern lived in 7
// places, each with its own `useState(false)` + `useRef<number>` +
// `useEffect` cleanup. These two hooks own the bookkeeping so callers
// can carry only the semantic intent (breath, copy chirp, just-shipped
// pill, etc.) without re-implementing the timer plumbing.
//
//   • `useTransientFlag(durationMs)` — single boolean. Calling `fire()`
//     sets `active` true, schedules a setTimeout to flip it back, and
//     cancels any in-flight timer so back-to-back calls reset cleanly.
//
//   • `useTransientFlagSet<Id>(durationMs)` — the same pattern keyed
//     by an arbitrary id. `fire(ids)` activates the given ids together;
//     `isActive(id)` is the read for renderers. Used for bulk-row
//     shimmer (`useRowBreath`) and any future multi-target one-shot.
//
// Both hooks flush their pending timer on unmount so a component that
// fires and unmounts mid-animation cannot leak a setState onto a
// stale ref.

export interface UseTransientFlagResult {
  /** True while the flag is set. Flips false after `durationMs`. */
  active: boolean;
  /** Set the flag true and schedule it to flip false after `durationMs`. */
  fire: () => void;
}

export function useTransientFlag(durationMs: number): UseTransientFlagResult {
  const [active, setActive] = React.useState(false);
  const timerRef = React.useRef<number | null>(null);

  const fire = React.useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setActive(true);
    timerRef.current = window.setTimeout(() => {
      setActive(false);
      timerRef.current = null;
    }, durationMs);
  }, [durationMs]);

  React.useEffect(
    () => () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
    },
    [],
  );

  return { active, fire };
}

export interface UseTransientFlagSetResult<Id> {
  /** True when `id` is in the currently active set. */
  isActive: (id: Id) => boolean;
  /** Replace the active set with `ids` and schedule it to clear. */
  fire: (ids: ReadonlyArray<Id> | ReadonlySet<Id>) => void;
}

export function useTransientFlagSet<Id>(
  durationMs: number,
): UseTransientFlagSetResult<Id> {
  const [active, setActive] = React.useState<ReadonlySet<Id>>(
    () => new Set<Id>(),
  );
  const timerRef = React.useRef<number | null>(null);

  const fire = React.useCallback(
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
      }, durationMs);
    },
    [durationMs],
  );

  React.useEffect(
    () => () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
    },
    [],
  );

  const isActive = React.useCallback((id: Id) => active.has(id), [active]);

  return { isActive, fire };
}
