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

// Task #876 — per-leg outcome the parent collects while looping the
// real bulk action. When `progress` is provided the dialog renders a
// live progress bar instead of just spinning the confirm button, and
// after the run ends (`phase === "results"`) it surfaces the full
// failure list inline so the operator can audit which specific legs
// failed instead of getting only a truncated toast.
export interface BulkActionFailure {
  id: number;
  label: string | null;
  reason: string;
}

export interface BulkActionProgress {
  processed: number;
  total: number;
  succeeded: number;
  failed: BulkActionFailure[];
  cancelled?: boolean;
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
  // Task #876 — optional live progress + cancel + results support.
  // When `progress` is non-null the dialog enters "running" mode while
  // isSubmitting and "results" mode once isSubmitting flips back off
  // (or the parent sets `showResults`). `onCancel` enables a Cancel
  // button during the run; `onClose` is called from the results-phase
  // close button so the parent can reset its progress state.
  progress?: BulkActionProgress | null;
  onCancel?: () => void;
  cancelRequested?: boolean;
  showResults?: boolean;
  onClose?: () => void;
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
  progress,
  onCancel,
  cancelRequested,
  showResults,
  onClose,
}: BulkEligibilityPreviewDialogProps) {
  const submitDisabled =
    isSubmitting || isLoadingPreview || eligible.length === 0;
  const pluralNoun = eligible.length === 1 ? rowNoun : `${rowNoun}s`;
  const inResults = !isSubmitting && !!showResults && !!progress;
  const inRunning = isSubmitting && !!progress;
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
            {(inRunning || inResults) && progress && (
              <BulkActionProgressBlock
                progress={progress}
                rowNoun={rowNoun}
                phase={inResults ? "results" : "running"}
              />
            )}
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
            {inResults ? (
              <Button
                type="button"
                onClick={() => {
                  if (onClose) onClose();
                  else onOpenChange(false);
                }}
                data-testid="bulk-eligibility-dialog-close"
              >
                Close
              </Button>
            ) : (
              <>
                <Button
                  variant="outline"
                  type="button"
                  onClick={() => {
                    if (inRunning && onCancel) {
                      onCancel();
                    } else {
                      onOpenChange(false);
                    }
                  }}
                  disabled={
                    inRunning
                      ? !onCancel || !!cancelRequested
                      : isSubmitting
                  }
                  data-testid="bulk-eligibility-dialog-cancel"
                >
                  {inRunning
                    ? cancelRequested
                      ? "Cancelling…"
                      : "Cancel run"
                    : "Cancel"}
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
                      {progress
                        ? `Working… ${progress.processed} / ${progress.total}`
                        : "Working…"}
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
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Task #876 — live progress bar + finished-run results pane shared by
// the bulk-exclude and bulk-reclassify flows on the Classification
// Inbox panel. Renders inline inside the dialog body. While the loop
// is in flight (`phase === "running"`) it shows "X / N processed",
// the current succeeded/failed counts, and a green fill bar — the
// same shape as BulkApproveProgressBar so the two flows feel the
// same. Once the loop ends (`phase === "results"`) it switches to a
// summary line and renders the full failure list (label + reason)
// so the operator can act on each one instead of only seeing the
// first reason in a toast.
export interface BulkActionProgressBlockProps {
  progress: BulkActionProgress;
  rowNoun: string;
  phase: "running" | "results";
}

export function BulkActionProgressBlock({
  progress,
  rowNoun,
  phase,
}: BulkActionProgressBlockProps) {
  const total = progress.total;
  const processed = progress.processed;
  const pct = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0;
  const failedCount = progress.failed.length;
  const succeeded = progress.succeeded;
  const remaining = Math.max(0, total - processed);
  return (
    <div
      className="rounded-md border bg-muted/40 px-3 py-2 space-y-1.5"
      data-testid="bulk-eligibility-progress"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center justify-between text-xs">
        <span
          className="font-medium text-foreground"
          data-testid="bulk-eligibility-progress-summary"
        >
          {phase === "running" ? (
            <>
              {processed} / {total} processed
              {succeeded > 0 ? ` · ${succeeded} succeeded` : ""}
              {failedCount > 0 ? ` · ${failedCount} failed` : ""}
            </>
          ) : (
            <>
              {progress.cancelled ? "Cancelled — " : "Done — "}
              {succeeded} succeeded
              {failedCount > 0 ? ` · ${failedCount} failed` : ""}
              {progress.cancelled && remaining > 0
                ? ` · ${remaining} not attempted`
                : ""}
            </>
          )}
        </span>
        <span
          className="text-[11px] text-muted-foreground tabular-nums"
          data-testid="bulk-eligibility-progress-pct"
        >
          {pct}%
        </span>
      </div>
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
        aria-hidden="true"
      >
        <div
          className={
            "h-full transition-all duration-200 " +
            (phase === "results" && failedCount > 0
              ? "bg-amber-500"
              : "bg-emerald-500")
          }
          style={{ width: `${pct}%` }}
          data-testid="bulk-eligibility-progress-fill"
        />
      </div>
      {phase === "results" && failedCount > 0 && (
        <div
          className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs space-y-1 mt-2"
          data-testid="bulk-eligibility-failures-list"
        >
          <p className="font-semibold text-amber-900">
            Failed {rowNoun}
            {failedCount === 1 ? "" : "s"}:
          </p>
          <ul className="list-disc pl-5 text-amber-900 space-y-0.5 max-h-40 overflow-auto">
            {progress.failed.map((f) => (
              <li
                key={f.id}
                data-testid={`bulk-eligibility-failure-${f.id}`}
              >
                <span className="font-semibold">
                  {f.label ? f.label : `#${f.id}`}
                </span>{" "}
                — {f.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
