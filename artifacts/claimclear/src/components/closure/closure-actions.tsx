import { Fragment, useState, type ReactNode } from "react";
import { ActionRow } from "@/components/actions-rail";
import { ClosureIntakeDialog } from "./closure-intake-dialog";
import type { ClosureReasonKey } from "./closure-options";

/**
 * Single source of truth for initiating a structured closure (Withdraw /
 * Non-Issue) from anywhere in the app. Owns the dialog open/close state,
 * renders the trigger buttons with consistent "currently selected"
 * highlighting, and mounts the closure intake dialog. The intake dialog
 * itself runs the entity + valid-transitions + Withdrawals list query
 * invalidations on success, so every surface that uses this component
 * (or that mounts the dialog directly, like the decision-tree player)
 * gets the same refresh behaviour for free.
 */
export type ClosureTarget = { kind: "claim" | "invoice_group"; id: number };

export type ClosureTriggerConfig = {
  /** Which closure reason this button represents. Determines the dialog
   *  banner and the structured payload sent to the server. */
  reason: ClosureReasonKey;
  label: string;
  sub?: ReactNode;
  icon?: ReactNode;
  testId: string;
  disabled?: boolean;
  disabledReason?: string;
  /** Optional wrapper for the trigger (e.g. PresenceLockWrapper on the
   *  invoice-group page). The wrapper is applied per-trigger so callers
   *  can compose presence/permission guards exactly as before. */
  wrap?: (node: ReactNode) => ReactNode;
};

export type ClosureActionsProps = {
  target: ClosureTarget;
  /** Current outcome on the entity, used to highlight the matching trigger. */
  outcome?: string | null;
  /** Current closureReason on the entity, used to highlight the matching trigger. */
  closureReason?: string | null;
  triggers: ClosureTriggerConfig[];
  /** Render shape for each trigger. Default is the inline ActionRow used
   *  on the claim and invoice-group detail pages. New surfaces can extend
   *  this without re-implementing the dialog scaffolding. */
  variant?: "action-row";
  /** Optional extra side-effect to run after the closure succeeds (e.g.
   *  reset local UI state). Query invalidations are handled automatically. */
  onAfterSuccess?: () => void;
};

function isSelected(
  reason: ClosureReasonKey,
  outcome?: string | null,
  closureReason?: string | null,
): boolean {
  if (reason === "non_issue") return outcome === "Non-Issue";
  // not_contestable / accepted_loss both close the entity as Withdrawn,
  // distinguished only by the closureReason.
  return outcome === "Withdrawn" && closureReason === reason;
}

export function ClosureActions({
  target,
  outcome,
  closureReason,
  triggers,
  variant = "action-row",
  onAfterSuccess,
}: ClosureActionsProps) {
  const [openReason, setOpenReason] = useState<ClosureReasonKey | null>(null);

  // The closure intake dialog uses target.kind === "claim" | "group";
  // map our richer "invoice_group" naming through to its vocabulary.
  const dialogTargetKind: "claim" | "group" =
    target.kind === "invoice_group" ? "group" : "claim";

  return (
    <>
      {triggers.map((t) => {
        const selected = isSelected(t.reason, outcome, closureReason);
        const button = (
          <ActionRow
            icon={t.icon}
            label={t.label}
            sub={t.sub}
            selected={selected}
            disabled={t.disabled}
            disabledReason={t.disabledReason}
            onClick={() => setOpenReason(t.reason)}
            testId={t.testId}
          />
        );
        const wrapped = t.wrap ? t.wrap(button) : button;
        return <Fragment key={t.reason}>{wrapped}</Fragment>;
      })}

      <ClosureIntakeDialog
        open={openReason !== null}
        onOpenChange={(open) => {
          if (!open) setOpenReason(null);
        }}
        target={{ kind: dialogTargetKind, id: target.id }}
        reason={openReason ?? "non_issue"}
        onSuccess={() => {
          setOpenReason(null);
          onAfterSuccess?.();
        }}
      />
    </>
  );
}
