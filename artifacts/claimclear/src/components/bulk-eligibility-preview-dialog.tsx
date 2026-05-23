// Task #840 — shared confirm dialog for bulk actions that have a
// server-side dry-run preview (bulk-reattest, bulk-exclude / mark
// no-issue, bulk-reclassify). Shows eligible vs skipped breakdown
// with reasons before the operator commits; the confirm button label
// reflects the actual eligible count.
//
// Bulk-approve has its own dialog (BulkApproveDialog) because it also
// requires a note and a live progress bar. The three flows wired here
// don't need a note — the dialog is a pure confirmation step.

import * as React from "react";
void React;
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

const SKIP_REASON_LABELS: Record<string, string> = {
  not_found: "no longer exists",
  tour_sample: "tour sample (read-only)",
  terminal_phase: "group has reached MAS/payout/closed",
  has_disputable_legs: "still has disputable legs",
  no_survivors: "no survivor legs to queue",
  no_eligible_legs: "no legs left needing re-attestation",
  wrong_state: "leg is not in a state this action can change",
  active_submission: "portal submission in flight — wait for it to resolve",
};

export function bulkEligibilitySkipLabel(reason: string): string {
  return SKIP_REASON_LABELS[reason] ?? reason;
}

export interface BulkEligibilityRow {
  id: number;
  label: string | null;
}

export interface BulkEligibilitySkippedRow extends BulkEligibilityRow {
  reason: string;
}

export interface BulkEligibilityPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  // Noun for the rows ("group", "leg", …). Used in the summary
  // ("Groups to queue") and the confirm button label.
  rowNoun: string;
  // Verb shown on the confirm button ("Queue", "Mark", "Apply").
  actionVerb: string;
  eligible: BulkEligibilityRow[];
  skipped: BulkEligibilitySkippedRow[];
  isLoadingPreview: boolean;
  isSubmitting: boolean;
  onConfirm: () => void | Promise<void>;
}

export function BulkEligibilityPreviewDialog({
  open,
  onOpenChange,
  title,
  description,
  rowNoun,
  actionVerb,
  eligible,
  skipped,
  isLoadingPreview,
  isSubmitting,
  onConfirm,
}: BulkEligibilityPreviewDialogProps) {
  const submitDisabled =
    isSubmitting || isLoadingPreview || eligible.length === 0;
  const pluralNoun = eligible.length === 1 ? rowNoun : `${rowNoun}s`;
  return (
    <Dialog open={open} onOpenChange={(o) => !isSubmitting && onOpenChange(o)}>
      <DialogContent className="max-w-xl" data-testid="bulk-eligibility-dialog">
        <div data-testid="bulk-eligibility-dialog-body">
          <div className="flex flex-col space-y-1.5 text-center sm:text-left">
            <h2 className="text-lg font-semibold leading-none tracking-tight">
              {title}
            </h2>
            <p className="text-sm text-muted-foreground">{description}</p>
          </div>
          <div className="space-y-3 text-sm mt-3">
            <div
              className="rounded-md border bg-muted/40 px-3 py-2 grid grid-cols-2 gap-y-1"
              data-testid="bulk-eligibility-dialog-summary"
            >
              <span className="text-muted-foreground">
                {rowNoun.charAt(0).toUpperCase() + rowNoun.slice(1)}s eligible
              </span>
              <span
                className="font-semibold text-right"
                data-testid="bulk-eligibility-dialog-eligible-count"
              >
                {isLoadingPreview ? "…" : eligible.length}
              </span>
              <span className="text-muted-foreground">Will be skipped</span>
              <span
                className="font-semibold text-right"
                data-testid="bulk-eligibility-dialog-skipped-count"
              >
                {isLoadingPreview ? "…" : skipped.length}
              </span>
            </div>
            {skipped.length > 0 && (() => {
              const counts = new Map<string, number>();
              for (const s of skipped) {
                counts.set(s.reason, (counts.get(s.reason) ?? 0) + 1);
              }
              const grouped = Array.from(counts.entries())
                .sort((a, b) => b[1] - a[1]);
              return (
                <div
                  className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs space-y-2"
                  data-testid="bulk-eligibility-dialog-skipped-list"
                >
                  <div>
                    <p className="font-semibold text-amber-900">Skipped by reason:</p>
                    <ul
                      className="list-disc pl-5 text-amber-900 space-y-0.5"
                      data-testid="bulk-eligibility-dialog-skipped-counts"
                    >
                      {grouped.map(([reason, count]) => (
                        <li
                          key={reason}
                          data-testid={`bulk-eligibility-dialog-skipped-count-${reason}`}
                        >
                          <span className="font-semibold">{count}</span>{" "}
                          {bulkEligibilitySkipLabel(reason)}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <p className="font-semibold text-amber-900">Details:</p>
                    <ul className="list-disc pl-5 text-amber-900 space-y-0.5">
                      {skipped.slice(0, 8).map((s) => (
                        <li
                          key={s.id}
                          data-testid={`bulk-eligibility-dialog-skipped-${s.id}`}
                        >
                          {s.label ? s.label : `#${s.id}`} —{" "}
                          {bulkEligibilitySkipLabel(s.reason)}
                        </li>
                      ))}
                      {skipped.length > 8 && (
                        <li className="italic">
                          …and {skipped.length - 8} more
                        </li>
                      )}
                    </ul>
                  </div>
                </div>
              );
            })()}
            {!isLoadingPreview && eligible.length === 0 && (
              <div
                className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900"
                data-testid="bulk-eligibility-dialog-empty"
              >
                Nothing in this selection is eligible — close the dialog and
                adjust your selection.
              </div>
            )}
          </div>
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2 mt-4">
            <Button
              variant="outline"
              type="button"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
              data-testid="bulk-eligibility-dialog-cancel"
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void onConfirm()}
              disabled={submitDisabled}
              data-testid="bulk-eligibility-dialog-confirm"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Working…
                </>
              ) : isLoadingPreview ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Checking…
                </>
              ) : (
                `${actionVerb} ${eligible.length} ${pluralNoun}`
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
