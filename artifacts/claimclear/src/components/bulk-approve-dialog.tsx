// Task #750 — extracted bulk-approve confirmation dialog + skip-reason
// label helpers. Lives in its own module so the unit test can import it
// without dragging in the full Responses-Awaiting-Review page (which
// pulls @workspace/api-client-react and the SSE/auth hooks — far too
// much for a static-render test).

import * as React from "react";
import { useEffect, useState } from "react";

void React;
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatCurrency } from "@/lib/format";
import { Loader2 } from "lucide-react";

// Keep this number in lockstep with the API-side `BULK_APPROVE_MAX_ROWS`
// constant in artifacts/api-server/src/routes/invoice-groups.ts.
export const BULK_APPROVE_MAX_ROWS = 200;

const BULK_APPROVE_SKIP_REASON_LABELS: Record<string, string> = {
  no_response: "no reviewable response on file",
  not_ai: "not AI-classified",
  partial_approval: "partial approval — needs single-item review",
  not_approval: "not an approval response",
  low_confidence: "AI confidence below high",
  no_group: "not linked to an invoice group",
  group_not_found: "invoice group has been deleted",
  tour_sample: "tour sample (read-only)",
  active_submission: "portal submission in flight — try again after it resolves",
  presence_locked: "another reviewer is currently viewing the group",
  no_disputed_legs: "no disputable legs to approve",
  already_queued: "already queued for re-attestation (idempotent skip)",
  not_found: "portal response no longer exists",
  ineligible: "fails the AI/approval/high-confidence gate",
};

export function bulkApproveSkipLabel(reason: string): string {
  return BULK_APPROVE_SKIP_REASON_LABELS[reason] ?? reason;
}

export interface BulkApproveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eligible: Array<{ groupId: number; portalResponseId: number; refNumber: string | null; totalAmount: number }>;
  skipped: Array<{ groupId: number; refNumber: string | null; reason: string }>;
  totalDollars: number;
  cap: number;
  isSubmitting: boolean;
  onConfirm: (note: string) => Promise<void> | void;
}

export function BulkApproveDialog({
  open,
  onOpenChange,
  eligible,
  skipped,
  totalDollars,
  cap,
  isSubmitting,
  onConfirm,
}: BulkApproveDialogProps) {
  const [note, setNote] = useState("");
  useEffect(() => {
    if (!open) setNote("");
  }, [open]);
  const trimmedNote = note.trim();
  const submitDisabled = trimmedNote.length === 0 || eligible.length === 0 || isSubmitting;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl" data-testid="bulk-approve-dialog">
        <BulkApproveDialogBody
          eligible={eligible}
          skipped={skipped}
          totalDollars={totalDollars}
          cap={cap}
          isSubmitting={isSubmitting}
          note={note}
          onNoteChange={setNote}
          submitDisabled={submitDisabled}
          onCancel={() => onOpenChange(false)}
          onConfirm={() => onConfirm(trimmedNote)}
        />
      </DialogContent>
    </Dialog>
  );
}

// Extracted body so the unit test can render the dialog's content
// without going through Radix's portal (which renders nothing under
// `renderToStaticMarkup`). The dialog itself is the thinnest possible
// wrapper around this component — every behavior the operator sees is
// driven by props here.
export interface BulkApproveDialogBodyProps {
  eligible: Array<{ groupId: number; portalResponseId: number; refNumber: string | null; totalAmount: number }>;
  skipped: Array<{ groupId: number; refNumber: string | null; reason: string }>;
  totalDollars: number;
  cap: number;
  isSubmitting: boolean;
  note: string;
  onNoteChange: (value: string) => void;
  submitDisabled: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function BulkApproveDialogBody({
  eligible,
  skipped,
  totalDollars,
  cap,
  isSubmitting,
  note,
  onNoteChange,
  submitDisabled,
  onCancel,
  onConfirm,
}: BulkApproveDialogBodyProps) {
  return (
    <div data-testid="bulk-approve-dialog-body">
      <div className="flex flex-col space-y-1.5 text-center sm:text-left">
        <h2 className="text-lg font-semibold leading-none tracking-tight">
          Bulk Approve High-confidence Responses
        </h2>
        <p className="text-sm text-muted-foreground">
          Each eligible group will get every disputed leg marked Approved
          and queued for re-attestation. Single-item flow is unchanged.
          The Awaiting attestation tile will rise by the success count.
        </p>
      </div>
      <div className="space-y-3 text-sm">
        <div
          className="rounded-md border bg-muted/40 px-3 py-2 grid grid-cols-2 gap-y-1"
          data-testid="bulk-approve-dialog-summary"
        >
          <span className="text-muted-foreground">Groups to approve</span>
          <span className="font-semibold text-right" data-testid="bulk-approve-dialog-eligible-count">
            {eligible.length}
          </span>
          <span className="text-muted-foreground">Combined disputed-leg total</span>
          <span className="font-semibold text-right">{formatCurrency(String(totalDollars))}</span>
          <span className="text-muted-foreground">Will be skipped</span>
          <span className="font-semibold text-right" data-testid="bulk-approve-dialog-skipped-count">
            {skipped.length}
          </span>
        </div>
        {skipped.length > 0 && (
          <div
            className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs space-y-1"
            data-testid="bulk-approve-dialog-skipped-list"
          >
            <p className="font-semibold text-amber-900">Will be skipped:</p>
            <ul className="list-disc pl-5 text-amber-900 space-y-0.5">
              {skipped.slice(0, 8).map((s) => (
                <li key={s.groupId} data-testid={`bulk-approve-dialog-skipped-${s.groupId}`}>
                  #{s.refNumber ?? s.groupId} — {bulkApproveSkipLabel(s.reason)}
                </li>
              ))}
              {skipped.length > 8 && (
                <li className="italic">…and {skipped.length - 8} more</li>
              )}
            </ul>
          </div>
        )}
        <div className="space-y-1">
          <Label htmlFor="bulk-approve-note">
            Note <span className="text-muted-foreground">(required, recorded on every group)</span>
          </Label>
          <Textarea
            id="bulk-approve-note"
            data-testid="bulk-approve-note"
            rows={3}
            value={note}
            onChange={(e) => onNoteChange(e.target.value)}
            placeholder="e.g. Reviewed batch of payor approvals against weekly export"
            disabled={isSubmitting}
          />
        </div>
        <p className="text-[11px] text-muted-foreground">
          Cap: {cap} rows per run. Each group is processed in its own
          transaction (server-side batches of 10). One bad group will
          not poison the rest.
        </p>
      </div>
      <div className="flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2">
        <Button
          variant="outline"
          type="button"
          onClick={onCancel}
          disabled={isSubmitting}
          data-testid="bulk-approve-dialog-cancel"
        >
          Cancel
        </Button>
        <Button
          type="button"
          onClick={onConfirm}
          disabled={submitDisabled}
          data-testid="bulk-approve-dialog-confirm"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Approving…
            </>
          ) : (
            `Approve ${eligible.length} group${eligible.length === 1 ? "" : "s"}`
          )}
        </Button>
      </div>
    </div>
  );
}
