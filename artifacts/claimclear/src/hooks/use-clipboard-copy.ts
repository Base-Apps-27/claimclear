import * as React from "react";
import { useTransientFlag } from "@/hooks/use-transient-flag";

// Standard "copy chirp" hook (Task #494).
//
// One place that owns the icon-swap timing for every copy-icon button
// in the app — claim IDs, addresses, reference numbers. Returns a
// `copied` flag that flips true for ~1s after a successful clipboard
// write and a `copy(value)` function that handles the writeText +
// timer bookkeeping (and silently no-ops when clipboard isn't
// available, so it never throws into a click handler).
//
// Sites that already render a Copy/Check pair just read `copied` to
// pick which icon to render. The duration matches the existing 1.5s
// flash used by the original ad-hoc CopyButton in ref-number.tsx so
// no consumer sees a behavior change after migrating.
//
// Internals delegate to the framework's `useTransientFlag` (Task #509);
// this hook keeps the public clipboard-write logic and the
// `copied`/`copy` naming the rest of the app reads against.
const COPY_FLASH_MS = 1500;

export interface UseClipboardCopyResult {
  /** True for ~1s after a successful copy. Drives the Check icon. */
  copied: boolean;
  /**
   * Write `value` to the clipboard and flash `copied` for ~1s. Returns
   * `true` on success, `false` if clipboard access failed or the
   * value was empty. Never throws.
   */
  copy: (value: string | null | undefined) => Promise<boolean>;
}

export function useClipboardCopy(): UseClipboardCopyResult {
  const { active: copied, fire } = useTransientFlag(COPY_FLASH_MS);

  const copy = React.useCallback(
    async (value: string | null | undefined) => {
      if (!value) return false;
      try {
        await navigator.clipboard.writeText(value);
      } catch {
        return false;
      }
      fire();
      return true;
    },
    [fire],
  );

  return { copied, copy };
}
