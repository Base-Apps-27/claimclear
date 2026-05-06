import { useEffect, useRef } from "react";
import { useAuth } from "@workspace/replit-auth-web";
import { consumeLocalActionMark } from "@/hooks/use-local-action-mark";

// Actor-caused transition watcher (Task #509).
//
// Three places (claim-detail-v2 status watcher, leg-conclusion-row
// variant watcher, invoice-group-detail-v2 status watcher) used to
// hand-roll the same gate around their one-shot UI flourishes:
//
//   1. Track the previous value in a ref. Skip the initial mount.
//      Skip rerenders where the value didn't change.
//   2. Detect whether the new value is the transition we care about
//      (e.g. claim status flipped to Processed).
//   3. Decide whether *this operator* caused the change. The local-
//      mark fast path (`consumeLocalActionMark`) wins unconditionally;
//      otherwise fall back to the SSE author tag and suppress when a
//      different user authored the change.
//   4. Fire the one-shot `onTransition` exactly once per qualifying
//      edge.
//
// This hook owns all four steps. The producer side
// (`markLocalAction(`x:${id}`)` in onSuccess handlers) is unchanged —
// each mutation already lives in the right place; the framework only
// consolidates the consumer.

export interface ActorCausedTransitionOptions<T> {
  /** Mark store key (e.g. `claim:123`, `group:45`). */
  key: string;
  /**
   * Ref to the most recent SSE author tag for this resource. Same
   * shape returned by `useClaimEvents` / `useInvoiceGroupEvents`.
   */
  lastUpdateBy: { current: { email: string | null } | null };
  /** Current value of the watched field. `undefined` = not loaded yet. */
  currentValue: T | undefined;
  /**
   * Returns true when `(prev, next)` is the transition we want to
   * celebrate. `prev` is the prior value (never undefined — the
   * initial mount is filtered before this is called).
   */
  isTransition: (prev: T, next: T) => boolean;
  /**
   * Fires once per qualifying actor-caused transition. Receives both
   * the prior and new values so callers that need to discriminate
   * between sibling transitions (e.g. "shipped" vs "cleared" on the
   * same status field) can do so without re-tracking prev themselves.
   */
  onTransition: (next: T, prev: T) => void;
}

export function useActorCausedTransition<T>(
  opts: ActorCausedTransitionOptions<T>,
): void {
  const { user } = useAuth();
  const { key, lastUpdateBy, currentValue, isTransition, onTransition } = opts;

  // Hold the live callbacks in refs so the effect's dep array stays
  // tight — only the watched value, the user, and the lastUpdateBy ref
  // identity drive re-runs. Otherwise an inline `isTransition` arrow
  // would force the effect to fire on every render of the parent.
  const isTransitionRef = useRef(isTransition);
  isTransitionRef.current = isTransition;
  const onTransitionRef = useRef(onTransition);
  onTransitionRef.current = onTransition;

  const prevRef = useRef<T | undefined>(undefined);

  useEffect(() => {
    const next = currentValue;
    if (next === undefined) return;
    const prev = prevRef.current;
    prevRef.current = next;
    if (prev === undefined) return;
    if (prev === next) return;
    if (!isTransitionRef.current(prev, next)) return;
    if (!consumeLocalActionMark(key)) {
      const lastBy = lastUpdateBy.current?.email ?? null;
      if (lastBy && user?.email && lastBy !== user.email) return;
    }
    onTransitionRef.current(next, prev);
  }, [currentValue, user?.email, lastUpdateBy, key]);
}
