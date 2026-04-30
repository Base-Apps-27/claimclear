import { useCallback, useRef, useState } from "react";
import { ClosureIntakeDialog } from "./closure-intake-dialog";
import type { ClosureReasonKey } from "./closure-options";

/**
 * Headless launcher for the structured closure intake dialog. Owns the
 * open/close state and a single mounted <ClosureIntakeDialog>, so any
 * surface can trigger a closure without re-implementing the dialog
 * scaffolding.
 *
 * This is the shared wiring used by both <ClosureActions> (button-style
 * triggers on the claim and invoice-group detail pages) and the
 * decision-tree player (whose "trigger" is the user picking a closure-leaf
 * option in the guided flow). Because every caller goes through the same
 * <ClosureIntakeDialog>, they all benefit from the dialog's built-in entity
 * + valid-transitions + Withdrawals list query invalidations on success.
 *
 * Usage:
 *   const { open, dialog } = useClosureLauncher();
 *   // mount `dialog` once in your render output
 *   open({ target, reason, prefill, onSuccess });
 */
export type ClosureLauncherTarget = { kind: "claim" | "group"; id: number };

export type ClosureLauncherArgs = {
  target: ClosureLauncherTarget;
  reason: ClosureReasonKey;
  prefill?: { category?: string; rootCause?: string };
  /** Fires after the dialog has successfully recorded the closure. The
   *  dialog itself handles query invalidations; use this for caller-local
   *  side effects (e.g. recording the chosen step in the tree player). */
  onSuccess?: () => void;
};

export type ClosureLauncher = {
  open: (args: ClosureLauncherArgs) => void;
  dialog: React.ReactElement;
};

export function useClosureLauncher(): ClosureLauncher {
  const [args, setArgs] = useState<ClosureLauncherArgs | null>(null);
  // Mirror in a ref so onSuccess (which fires synchronously after the
  // dialog calls onOpenChange(false)) can still read the active args
  // before we drop them. Cleared in a microtask on close so that a true
  // cancel (where onSuccess never fires) doesn't leave stale args behind
  // for a subsequent unrelated open() call.
  const argsRef = useRef<ClosureLauncherArgs | null>(null);

  const open = useCallback((next: ClosureLauncherArgs) => {
    argsRef.current = next;
    setArgs(next);
  }, []);

  const dialog = (
    <ClosureIntakeDialog
      open={args !== null}
      onOpenChange={(o) => {
        if (!o) {
          setArgs(null);
          queueMicrotask(() => {
            argsRef.current = null;
          });
        }
      }}
      target={args?.target ?? { kind: "claim", id: 0 }}
      reason={args?.reason ?? "non_issue"}
      prefill={args?.prefill}
      onSuccess={() => {
        const cur = argsRef.current;
        argsRef.current = null;
        cur?.onSuccess?.();
      }}
    />
  );

  return { open, dialog };
}
