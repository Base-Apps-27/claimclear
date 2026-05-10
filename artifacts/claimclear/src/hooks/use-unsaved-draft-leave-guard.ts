// Shared unsaved-draft leave guard (Task #672).
//
// Two editors — `per-leg-context-editor.tsx` and `rich-text-editor.tsx` —
// previously carried near-identical copies of the beforeunload +
// history.pushState/replaceState + popstate guard that protects a
// typed-but-unsaved draft from being silently lost on a tab close,
// hard refresh, or in-app SPA navigation. This hook is the single
// source of truth so the next rule tweak (e.g. wouter-aware skipping,
// or a different popstate re-anchor strategy) only has to change in
// one place.
//
// Usage:
//   const { leaveConfirmOpen, confirmLeave, cancelLeave } =
//     useUnsavedDraftLeaveGuard(hasUnsavedDraft);
//
// The caller renders its own AlertDialog wired to `leaveConfirmOpen`,
// `confirmLeave` (Discard and leave), and `cancelLeave` (Stay).
//
// Behavior pinned by the original implementations and preserved here:
//   (1) `beforeunload` is registered while a draft is active so the
//       browser prompts on tab close / hard refresh.
//   (2) `window.history.pushState` and `replaceState` are PATCHED while
//       a draft is active. wouter (and most history-based routers)
//       navigate by calling these directly — neither fires
//       `beforeunload`. The patches capture the requested navigation
//       and pop the in-app dialog instead. Patches are torn down on
//       cleanup so the guard never leaks to other screens.
//   (3) `popstate` (back/forward) fires AFTER the URL has changed, so
//       the handler reads the destination, pushes the editor's
//       previously-anchored URL back via the UNWRAPPED original
//       pushState (using the wrapped one would re-trigger the guard
//       and bounce), and opens the dialog. On confirm, we re-push the
//       captured destination.

import { useEffect, useRef, useState } from "react";

export interface UnsavedDraftLeaveGuard {
  leaveConfirmOpen: boolean;
  confirmLeave: () => void;
  cancelLeave: () => void;
}

type PendingNav =
  | {
      kind: "push" | "replace";
      args: Parameters<typeof window.history.pushState>;
    }
  | { kind: "pop"; destinationUrl: string };

export function useUnsavedDraftLeaveGuard(
  hasUnsavedDraft: boolean,
): UnsavedDraftLeaveGuard {
  const anchoredUrlRef = useRef<string>(
    typeof window !== "undefined" ? window.location.href : "",
  );
  const pendingNavRef = useRef<PendingNav | null>(null);
  const originalPushRef = useRef<typeof window.history.pushState | null>(null);
  const originalReplaceRef = useRef<typeof window.history.replaceState | null>(
    null,
  );
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (hasUnsavedDraft) anchoredUrlRef.current = window.location.href;
  }, [hasUnsavedDraft]);

  useEffect(() => {
    if (!hasUnsavedDraft) return;
    if (typeof window === "undefined") return;

    // (1) Browser tab close / hard refresh.
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
      return "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);

    // (2) SPA navigation via history.pushState / replaceState.
    const originalPush = window.history.pushState.bind(window.history);
    const originalReplace = window.history.replaceState.bind(window.history);
    originalPushRef.current = originalPush;
    originalReplaceRef.current = originalReplace;

    const guard =
      (_orig: typeof originalPush, kind: "push" | "replace") =>
      function patched(
        this: History,
        ...args: Parameters<typeof originalPush>
      ) {
        pendingNavRef.current = { kind, args };
        setLeaveConfirmOpen(true);
        return undefined;
      } as typeof originalPush;
    window.history.pushState = guard(originalPush, "push");
    window.history.replaceState = guard(originalReplace, "replace");

    // (3) Back / forward via popstate.
    const onPopState = () => {
      const destinationUrl = window.location.href;
      pendingNavRef.current = { kind: "pop", destinationUrl };
      originalPush({}, "", anchoredUrlRef.current);
      setLeaveConfirmOpen(true);
    };
    window.addEventListener("popstate", onPopState);

    return () => {
      window.history.pushState = originalPush;
      window.history.replaceState = originalReplace;
      originalPushRef.current = null;
      originalReplaceRef.current = null;
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("popstate", onPopState);
    };
  }, [hasUnsavedDraft]);

  const confirmLeave = () => {
    const pending = pendingNavRef.current;
    pendingNavRef.current = null;
    setLeaveConfirmOpen(false);
    if (!pending) return;
    if (typeof window === "undefined") return;
    const origPush =
      originalPushRef.current ?? window.history.pushState.bind(window.history);
    const origReplace =
      originalReplaceRef.current ??
      window.history.replaceState.bind(window.history);
    if (pending.kind === "push") {
      origPush(...pending.args);
    } else if (pending.kind === "replace") {
      origReplace(...pending.args);
    } else if (pending.kind === "pop") {
      origPush({}, "", pending.destinationUrl);
    }
    anchoredUrlRef.current = window.location.href;
  };

  const cancelLeave = () => {
    pendingNavRef.current = null;
    setLeaveConfirmOpen(false);
  };

  return { leaveConfirmOpen, confirmLeave, cancelLeave };
}
