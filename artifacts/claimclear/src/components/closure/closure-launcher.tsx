import { useCallback, useRef, useState } from "react";
import { ClosureIntakeDialog } from "./closure-intake-dialog";
import {
  ClosureConfirmDialog,
  type ConfirmResponseContext,
} from "./closure-confirm-dialog";
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
  /**
   * Optional pre-flight callback that runs at the start of the dialog's
   * Submit handler, AFTER the operator has confirmed the closure form
   * but BEFORE the closure mutation fires. Used by Task #343 Step 4
   * to promote per-leg verdict drafts in the same operator gesture as
   * closure. If it rejects, the dialog stays open with the error and
   * the closure mutation does not run, so a cancel-after-open never
   * triggers the pre-flight side effect.
   */
  beforeSubmit?: () => Promise<void>;
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
      beforeSubmit={args?.beforeSubmit}
      onSuccess={() => {
        const cur = argsRef.current;
        argsRef.current = null;
        cur?.onSuccess?.();
      }}
    />
  );

  return { open, dialog };
}

/**
 * Headless launcher for the LIGHT closure confirm dialog used only by the
 * response-driven Denied-by-Payor paths (queue response review, Step 4
 * close-out, group rail "Denied by Payor" trigger). The full structured
 * intake doesn't apply on these paths because the payor — not us —
 * decided the outcome; the response itself is the record. See
 * <ClosureConfirmDialog> for the auto-fill payload it submits.
 *
 * Mirrors useClosureLauncher's lifecycle: single mounted dialog, ref-
 * backed args so onSuccess fires after onOpenChange(false), microtask
 * cleanup so a true cancel never leaves stale args behind.
 */
export type ClosureConfirmLauncherArgs = {
  target: ClosureLauncherTarget;
  /** The payor response we're closing against — drives the summary block
   *  in the dialog and seeds the auto-built audit narrative. */
  response: ConfirmResponseContext | null;
  beforeSubmit?: () => Promise<void>;
  onSuccess?: () => void;
};

export type ClosureConfirmLauncher = {
  open: (args: ClosureConfirmLauncherArgs) => void;
  dialog: React.ReactElement;
};

export function useClosureConfirmLauncher(): ClosureConfirmLauncher {
  const [args, setArgs] = useState<ClosureConfirmLauncherArgs | null>(null);
  const argsRef = useRef<ClosureConfirmLauncherArgs | null>(null);

  const open = useCallback((next: ClosureConfirmLauncherArgs) => {
    argsRef.current = next;
    setArgs(next);
  }, []);

  const dialog = (
    <ClosureConfirmDialog
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
      response={args?.response ?? null}
      beforeSubmit={args?.beforeSubmit}
      onSuccess={() => {
        const cur = argsRef.current;
        argsRef.current = null;
        cur?.onSuccess?.();
      }}
    />
  );

  return { open, dialog };
}
