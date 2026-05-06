import { useEffect, useMemo, useRef, useState } from "react";

// Row-completion settle (Task #490).
//
// When a row leaves a list as the result of a completion (Queue,
// Responses, Attestation), today the row vanishes instantly and the
// next item is auto-selected with no visual cue that the action took
// effect. This hook softens that transition:
//
//  1. The departed row stays in its original position briefly while a
//     CSS settle animation plays (success tint + slide/fade), then
//     unmounts. Multiple completions can settle in parallel.
//  2. If the selection auto-advanced to a new row in the same list,
//     that row gets a brief highlight ring so the change is obvious.
//
// `prefers-reduced-motion` is handled in the CSS (see `index.css`):
// the slide is replaced with an opacity tint and the highlight ring
// drops to a static background tint.
//
// The hook is purely additive — it doesn't own the data or selection.
// Callers pass the live items + the current selectedId; the returned
// `slots` is what to render. Items that have left the list while still
// being the previously-selected id are re-inserted as ghost slots
// flagged `isSettling: true`.

const SETTLE_MS = 360;
const HIGHLIGHT_MS = 700;

export interface RowSettleSlot<T> {
  item: T;
  isSettling: boolean;
}

export interface UseRowSettleResult<T, K> {
  /** Items to render, in order. Settling ghosts are interleaved at
   *  their previous positions so other rows don't jump until the
   *  ghost unmounts. */
  slots: RowSettleSlot<T>[];
  /** True when the given id should render the brief highlight applied
   *  after auto-advance from a settled row. */
  isJustSelected: (id: K) => boolean;
}

export function useRowSettle<T, K extends string | number>(
  items: T[],
  getId: (item: T) => K,
  selectedId: K | null,
): UseRowSettleResult<T, K> {
  // `getId` is held in a ref so callers can pass an inline arrow
  // (`(g) => g.id`) without forcing this effect's cleanup to cancel
  // in-flight settle / highlight timers on unrelated rerenders. The
  // effect intentionally depends only on `items` and `selectedId` —
  // both real signals for "did the list shape change?" — and reads
  // the current `getId` from the ref.
  const getIdRef = useRef(getId);
  getIdRef.current = getId;

  const prevItemsRef = useRef<T[]>(items);
  const prevSelectedRef = useRef<K | null>(selectedId);

  const [settling, setSettling] = useState<
    { id: K; item: T; index: number }[]
  >([]);
  const [justSelectedId, setJustSelectedId] = useState<K | null>(null);

  // Active timers, tracked so unmount can flush them but ordinary
  // rerenders never cancel them via effect cleanup.
  const timersRef = useRef<Set<number>>(new Set());
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const t of timers) window.clearTimeout(t);
      timers.clear();
    };
  }, []);

  // Some pages (Responses, Attestation) auto-advance selection in a
  // follow-up effect when the selected row disappears, so the
  // transition is `oldId -> null -> newId` across two renders rather
  // than `oldId -> newId` in one. We remember "a row just departed,
  // the next non-null selection is an auto-advance" in a ref so the
  // highlight fires regardless of which render brings the new id in.
  // The flag is auto-cleared after a generous window so a much-later
  // manual click never inherits a stray highlight.
  const expectHighlightRef = useRef(false);

  useEffect(() => {
    const prevItems = prevItemsRef.current;
    const prevSelected = prevSelectedRef.current;
    prevItemsRef.current = items;
    prevSelectedRef.current = selectedId;

    const idOf = getIdRef.current;
    const currentIds = new Set(items.map(idOf));

    // 1. Departed previously-selected row → schedule a settle ghost.
    if (prevSelected != null && !currentIds.has(prevSelected)) {
      const departedIdx = prevItems.findIndex((i) => idOf(i) === prevSelected);
      if (departedIdx !== -1) {
        const departedItem = prevItems[departedIdx];
        setSettling((prev) =>
          prev.some((s) => s.id === prevSelected)
            ? prev
            : [
                ...prev,
                { id: prevSelected, item: departedItem, index: departedIdx },
              ],
        );
        const settleTimer = window.setTimeout(() => {
          timersRef.current.delete(settleTimer);
          setSettling((prev) => prev.filter((s) => s.id !== prevSelected));
        }, SETTLE_MS);
        timersRef.current.add(settleTimer);

        // Arm the highlight expectation. Survives the
        // `oldId -> null -> newId` two-render path used by route-based
        // auto-advance.
        expectHighlightRef.current = true;
        const clearTimer = window.setTimeout(() => {
          timersRef.current.delete(clearTimer);
          expectHighlightRef.current = false;
        }, SETTLE_MS + HIGHLIGHT_MS + 1000);
        timersRef.current.add(clearTimer);
      }
    }

    // 2. Auto-advance landed on a real in-list row → brief highlight.
    //    Decoupled from the departed branch so it triggers in either
    //    the same-render or two-render flow.
    if (
      expectHighlightRef.current &&
      selectedId != null &&
      selectedId !== prevSelected &&
      currentIds.has(selectedId)
    ) {
      expectHighlightRef.current = false;
      const next = selectedId;
      setJustSelectedId(next);
      const highlightTimer = window.setTimeout(() => {
        timersRef.current.delete(highlightTimer);
        setJustSelectedId((cur) => (cur === next ? null : cur));
      }, HIGHLIGHT_MS);
      timersRef.current.add(highlightTimer);
    }
  }, [items, selectedId]);

  const slots = useMemo<RowSettleSlot<T>[]>(() => {
    const idOf = getIdRef.current;
    const list: RowSettleSlot<T>[] = items.map((item) => ({
      item,
      isSettling: false,
    }));
    if (settling.length === 0) return list;
    const liveIds = new Set(items.map(idOf));
    for (const ghost of settling) {
      if (liveIds.has(ghost.id)) continue;
      const idx = Math.min(Math.max(ghost.index, 0), list.length);
      list.splice(idx, 0, { item: ghost.item, isSettling: true });
    }
    return list;
  }, [items, settling]);

  return {
    slots,
    isJustSelected: (id) => id === justSelectedId,
  };
}
