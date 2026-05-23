// Task #835 — Small "Saving…" indicator + inline rollback error pill
// shared across the five optimistic-mutation surfaces.
//
// `SavingIndicator` is paired with `useOptimisticMutation` so it only
// paints when the wrapped request actually exceeds the 300ms threshold
// (the hook gates `showSaving` on a setTimeout).
//
// `RollbackErrorPill` is the in-row error chip operators see when an
// optimistic flip rolled back. The text intentionally matches the
// rollback toast wording from `useOptimisticMutation` so operators
// always read the same explanation in both places.

import { AlertTriangle, Loader2 } from "lucide-react";

export interface SavingIndicatorProps {
  show: boolean;
  label?: string;
  className?: string;
  testid?: string;
}

export function SavingIndicator({
  show,
  label = "Saving…",
  className,
  testid = "saving-indicator",
}: SavingIndicatorProps) {
  if (!show) return null;
  return (
    <span
      data-testid={testid}
      className={
        "inline-flex items-center gap-1 text-[11px] text-muted-foreground " +
        (className ?? "")
      }
      role="status"
      aria-live="polite"
    >
      <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
      {label}
    </span>
  );
}

export interface RollbackErrorPillProps {
  message: string | null;
  className?: string;
  testid?: string;
}

export function RollbackErrorPill({
  message,
  className,
  testid = "rollback-error-pill",
}: RollbackErrorPillProps) {
  if (!message) return null;
  return (
    <span
      data-testid={testid}
      className={
        "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold " +
        (className ?? "")
      }
      style={{
        background: "hsl(var(--cc-red-bg))",
        color: "hsl(var(--cc-red-fg))",
        border: "1px solid hsl(var(--cc-red-border))",
      }}
      role="alert"
      title={message}
    >
      <AlertTriangle className="h-3 w-3" aria-hidden />
      Reverted — {message}
    </span>
  );
}
