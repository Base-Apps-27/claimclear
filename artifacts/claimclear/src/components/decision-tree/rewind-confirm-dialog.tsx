// Shared confirmation dialog for SOP rewind actions (Task #526 / #527).
//
// Renders the R5 mockup in two variants:
//   - "light"  → no AI draft exists for the parent invoice yet. Single
//                primary "Rewind walk" CTA, no warning callout.
//   - "heavy"  → the parent group has a generated draft and/or a
//                reviewed-at stamp. Amber callout listing what gets
//                discarded; primary CTA reads "Rewind & discard draft"
//                and is amber-tinted.
//
// The dialog itself fetches the impact preview lazily (only when open)
// using `useGetSopRewindImpact`. This keeps the player render path
// free of any speculative GETs while still letting the breadcrumb,
// terminal "Change my answer", "Restart walk", and per-leg cards-row
// menu (R3, sibling task) all share the exact same component.

import * as React from "react";
import {
  useGetSopRewindImpact,
  getGetSopRewindImpactQueryKey,
} from "@workspace/api-client-react";
import type {
  SopRewindAction,
  SopRewindImpactResponse,
} from "@workspace/api-client-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Loader2, RotateCcw, Trash2 } from "lucide-react";

void React;

export type RewindDialogVariant = "light" | "heavy";

/**
 * Pure: derive which dialog flavor R5 should render from the impact
 * preview the backend exposes. `draftWillBeDiscarded === true` is the
 * single switch — anything else (answer count, terminal clear,
 * walk-tied evidence to delete) renders the light variant.
 */
export function pickRewindDialogVariant(
  impact: Pick<SopRewindImpactResponse, "draftWillBeDiscarded">,
): RewindDialogVariant {
  return impact.draftWillBeDiscarded ? "heavy" : "light";
}

export interface RewindConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  legId: number;
  /** Display label rendered in the header, e.g. "CLM-123". */
  legRef?: string | null;
  action: SopRewindAction;
  /** Required when `action === "jump"`. */
  nodeId?: string | null;
  /** Snapshot of the verdict before rewind, for the body. */
  currentVerdictLabel?: string | null;
  /** Caller fires the matching mutation. Receives the impact preview
   *  (so the caller knows whether to pass `discardDraft: true`). */
  onConfirm: (args: { impact: SopRewindImpactResponse }) => void;
  /** True while the matching mutation is in flight. */
  isPending?: boolean;
}

function actionVerb(action: SopRewindAction): string {
  switch (action) {
    case "back-step":
      return "Back-step";
    case "jump":
      return "Rewind";
    case "restart":
      return "Restart";
  }
}

export function RewindConfirmDialog(props: RewindConfirmDialogProps) {
  const {
    open,
    onOpenChange,
    legId,
    legRef,
    action,
    nodeId,
    currentVerdictLabel,
    onConfirm,
    isPending = false,
  } = props;

  const params =
    action === "jump"
      ? { action, nodeId: nodeId ?? "" }
      : { action };

  const enabled =
    open && legId > 0 && (action !== "jump" || !!nodeId);

  const { data: impact, isLoading, error } = useGetSopRewindImpact(
    legId,
    params,
    {
      query: {
        queryKey: getGetSopRewindImpactQueryKey(legId, params),
        enabled,
        // Keep the impact fresh per open — staleTime 0 so reopening
        // after a draft was generated reflects the new draft state.
        staleTime: 0,
      },
    },
  );

  const variant: RewindDialogVariant = impact
    ? pickRewindDialogVariant(impact)
    : "light";

  const headerTitle =
    action === "restart"
      ? `Restart walk for ${legRef ?? `Leg ${legId}`}?`
      : action === "jump"
        ? `Rewind walk for ${legRef ?? `Leg ${legId}`}?`
        : `Back-step walk for ${legRef ?? `Leg ${legId}`}?`;

  const primaryLabel =
    variant === "heavy"
      ? action === "restart"
        ? "Restart & discard draft"
        : "Rewind & discard draft"
      : action === "restart"
        ? "Restart walk"
        : "Rewind walk";

  return (
    <Dialog open={open} onOpenChange={(next) => !isPending && onOpenChange(next)}>
      <DialogContent
        className="sm:max-w-lg"
        data-testid="rewind-confirm-dialog"
        data-variant={variant}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <RotateCcw className="h-4 w-4 text-blue-600" />
            {headerTitle}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {error ? (
            <p
              className="text-sm text-destructive"
              data-testid="rewind-confirm-error"
            >
              Could not load rewind impact:{" "}
              {(error as Error).message || "Unknown error"}
            </p>
          ) : isLoading || !impact ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Checking what this rewind will change…
            </div>
          ) : (
            <>
              <KV
                k="Currently"
                v={
                  currentVerdictLabel ||
                  impact.currentSopOutcome ||
                  "Mid-walk"
                }
              />
              <KV
                k="Going back"
                v={`${impact.answersToPop} answer${
                  impact.answersToPop === 1 ? "" : "s"
                } will be undone`}
              />
              {action === "restart" && impact.evidenceWillBeCleared > 0 && (
                <KV
                  k="Evidence"
                  v={`${impact.evidenceWillBeCleared} walk-tied evidence row${
                    impact.evidenceWillBeCleared === 1 ? "" : "s"
                  } will be deleted`}
                />
              )}

              {variant === "heavy" ? (
                <div
                  className="flex gap-2.5 p-3 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-900"
                  data-testid="rewind-confirm-discard-callout"
                >
                  <AlertTriangle className="h-4 w-4 text-amber-700 dark:text-amber-300 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">
                      This will also discard:
                    </p>
                    <ul className="text-xs text-amber-900 dark:text-amber-100 list-disc pl-4 space-y-0.5">
                      {impact.previewGeneratedAt && (
                        <li>The generated dispute note for this invoice</li>
                      )}
                      {impact.draftReviewedAt && (
                        <li>
                          Your <em>reviewed-at</em> stamp
                        </li>
                      )}
                      {!impact.previewGeneratedAt &&
                        !impact.draftReviewedAt && (
                          <li>The cached AI dispute draft for this invoice</li>
                        )}
                    </ul>
                    <p className="text-[11px] text-amber-700 dark:text-amber-300">
                      You'll regenerate the note after fixing the walk.
                    </p>
                  </div>
                </div>
              ) : (
                <p
                  className="text-xs text-muted-foreground"
                  data-testid="rewind-confirm-light-note"
                >
                  No AI draft exists yet for this invoice — nothing else
                  changes.
                </p>
              )}
            </>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
            data-testid="rewind-confirm-cancel"
          >
            Cancel
          </Button>
          <Button
            disabled={isPending || !impact}
            className={
              variant === "heavy"
                ? "bg-amber-600 hover:bg-amber-700 text-white"
                : ""
            }
            onClick={() => impact && onConfirm({ impact })}
            data-testid={
              variant === "heavy"
                ? "rewind-confirm-heavy"
                : "rewind-confirm-light"
            }
          >
            {isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
            ) : variant === "heavy" ? (
              <Trash2 className="h-3.5 w-3.5 mr-1.5" />
            ) : (
              <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
            )}
            {primaryLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-2 text-sm">
      <span className="text-[11px] uppercase tracking-wider text-muted-foreground w-20 shrink-0 mt-0.5">
        {k}
      </span>
      <span className="text-sm">{v}</span>
    </div>
  );
}

// Re-export the action constant for downstream callers (the cards-row
// task imports this dialog + the action enum together).
export { type SopRewindAction, type SopRewindImpactResponse };
