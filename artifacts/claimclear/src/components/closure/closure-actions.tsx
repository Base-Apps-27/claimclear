import { Fragment, type ReactNode } from "react";
import { ActionRow } from "@/components/actions-rail";
import { useClosureLauncher } from "./closure-launcher";
import { assertNeverClosureReason, type ClosureReasonKey } from "./closure-options";

/**
 * Single source of truth for initiating a structured closure (Withdraw /
 * Non-Issue) from a list of inline trigger buttons. Renders each trigger
 * with consistent "currently selected" highlighting and delegates the
 * dialog wiring to <useClosureLauncher>, which is also used by non-button
 * surfaces (e.g. the decision-tree player). The intake dialog itself runs
 * the entity + valid-transitions + Withdrawals list query invalidations on
 * success, so every surface that goes through the launcher gets the same
 * refresh behaviour for free.
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
  // Exhaustive over ClosureReasonKey — adding a new key forces an explicit
  // match arm below or this stops compiling at `assertNeverClosureReason`.
  switch (reason) {
    case "non_issue":
      return outcome === "Non-Issue";
    case "denied_by_payor":
      return outcome === "Denied" && closureReason === "denied_by_payor";
    case "cannot_dispute":
      // cannot_dispute closes the entity as Withdrawn.
      return outcome === "Withdrawn" && closureReason === "cannot_dispute";
    default:
      return assertNeverClosureReason(reason);
  }
}

export function ClosureActions({
  target,
  outcome,
  closureReason,
  triggers,
  variant: _variant = "action-row",
  onAfterSuccess,
}: ClosureActionsProps) {
  const { open: openClosure, dialog } = useClosureLauncher();

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
            onClick={() =>
              openClosure({
                target: { kind: dialogTargetKind, id: target.id },
                reason: t.reason,
                onSuccess: onAfterSuccess,
              })
            }
            testId={t.testId}
          />
        );
        const wrapped = t.wrap ? t.wrap(button) : button;
        return <Fragment key={t.reason}>{wrapped}</Fragment>;
      })}

      {dialog}
    </>
  );
}
