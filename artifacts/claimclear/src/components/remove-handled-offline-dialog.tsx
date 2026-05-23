import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useExcludeLeg,
  getGetClaimQueryKey,
  getGetInvoiceGroupQueryKey,
  getListInvoiceGroupsQueryKey,
  getListClaimAuditLogsQueryKey,
} from "@workspace/api-client-react";
import { patchGroupLeg } from "@/lib/optimistic-cache-patches";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Link2Off } from "lucide-react";
import { successToast } from "@/hooks/use-toast";
import { markLocalAction } from "@/hooks/use-local-action-mark";
import { useOptimisticMutation } from "@/hooks/use-optimistic-mutation";
import { SavingIndicator } from "@/components/saving-indicator";
import {
  HANDLED_OFFLINE_NOTE_MIN as HANDLED_OFFLINE_NOTE_MIN_HELPER,
  trimmedNoteLength,
  isHandledOfflineNoteValid,
  canSubmitHandledOffline,
  buildHandledOfflinePayload,
  runHandledOfflineSuccessSideEffects,
} from "./remove-handled-offline-dialog-helpers";

// Task #689 — confirmation dialog for the "Remove — handled offline"
// exit. Reuses the existing `excludeLeg` hook with the new
// `handled_offline` reason; the server enforces the >=10-char note
// rule and writes the distinct `claim_removed_handled_offline` audit
// action so the activity timeline reads "Removed — handled offline"
// instead of the generic leg-excluded entry.
//
// Used from two surfaces:
//   1. claim-detail-v2 — header trigger next to the existing Exclude.
//   2. leg-conclusion-row (Queue) — overflow-menu item on the row.
// Both surfaces share this dialog so the eligibility/copy/note rules
// stay in lock-step.

// Re-export the constant from the pure-helper module so callers that
// already import it from this file keep working while the predicate
// logic lives next to its tests.
export const HANDLED_OFFLINE_NOTE_MIN = HANDLED_OFFLINE_NOTE_MIN_HELPER;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  claimId: number;
  // Optional invoice-group id so the dialog can invalidate the
  // group/list query caches that drive the surrounding page.
  groupId?: number | null;
  // Fired after a successful remove; surfaces the close to the parent
  // (e.g. so the queue overflow menu can collapse).
  onRemoved?: () => void;
}

export function RemoveHandledOfflineDialog({
  open,
  onOpenChange,
  claimId,
  groupId,
  onRemoved,
}: Props) {
  const qc = useQueryClient();
  const excludeMutation = useExcludeLeg();
  // Task #835 — optimistic flip: the leg should disappear from the
  // surrounding queue/detail view within a frame. We patch the parent
  // group cache to flip `includedInDispute` false and stamp
  // `dropReason = 'handled_offline'`; on error the snapshot rolls back
  // and the standardized toast surfaces the failure reason.
  const optimistic = useOptimisticMutation<
    { id: number; data: ReturnType<typeof buildHandledOfflinePayload> },
    unknown
  >({
    mutationFn: (vars) => excludeMutation.mutateAsync(vars),
    errorTitle: "Couldn't remove leg — reverted",
    buildPatches: (vars) => {
      if (groupId == null) return [];
      return [
        {
          queryKey: getGetInvoiceGroupQueryKey(groupId),
          updater: (old) => patchGroupLeg(old, vars.id, {
            includedInDispute: false,
            dropReason: "handled_offline",
          }),
        },
      ];
    },
  });
  const [note, setNote] = useState("");
  const [confirmed, setConfirmed] = useState(false);

  // Reset on close so a re-open starts from a clean slate (no stale
  // checkbox / note bleeding across legs).
  useEffect(() => {
    if (!open) {
      setNote("");
      setConfirmed(false);
    }
  }, [open]);

  const trimmedLength = trimmedNoteLength(note);
  const noteValid = isHandledOfflineNoteValid(note);
  const canSubmit = canSubmitHandledOffline({
    note,
    confirmed,
    isPending: optimistic.isPending,
  });

  async function onConfirm() {
    if (!canSubmit) return;
    try {
      await optimistic.run({
        id: claimId,
        data: buildHandledOfflinePayload(note),
      });
      markLocalAction(`claim:${claimId}`);
      successToast({
        title: "Done",
        description: "Leg removed — handled offline",
      });
      runHandledOfflineSuccessSideEffects({
        qc,
        keys: {
          getGetClaimQueryKey,
          getListClaimAuditLogsQueryKey,
          getGetInvoiceGroupQueryKey,
          getListInvoiceGroupsQueryKey,
        },
        claimId,
        groupId,
        onOpenChange,
        onRemoved,
      });
    } catch {
      // useOptimisticMutation already rolled the cache back and fired
      // the destructive toast — nothing further to do here.
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="remove-handled-offline-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2Off className="h-4 w-4 text-slate-600" />
            Remove this leg — handled offline?
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Use this when the leg was already correctly attested or
            handled outside ClaimClear. The leg disappears from the
            dispute work queues but stays visible on the invoice as a
            clean line. The activity timeline will record this as
            <span className="font-medium"> &ldquo;Removed — handled offline&rdquo;</span>.
          </p>
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor={`handled-offline-note-${claimId}`}>
              Note (required, at least {HANDLED_OFFLINE_NOTE_MIN} characters)
            </label>
            <Textarea
              id={`handled-offline-note-${claimId}`}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Confirmed in MAS portal — already paid on 4/12, no further action needed."
              rows={3}
              data-testid="remove-handled-offline-note"
            />
            <p
              className={`text-xs ${
                noteValid ? "text-muted-foreground" : "text-amber-700"
              }`}
              data-testid="remove-handled-offline-note-counter"
            >
              {trimmedLength}/{HANDLED_OFFLINE_NOTE_MIN}+ characters
            </p>
          </div>
          <label
            className="flex items-start gap-2 text-sm cursor-pointer"
            data-testid="remove-handled-offline-confirm-label"
          >
            <Checkbox
              checked={confirmed}
              onCheckedChange={(v) => setConfirmed(v === true)}
              data-testid="remove-handled-offline-confirm-checkbox"
              className="mt-0.5"
            />
            <span>
              I confirm this leg was handled offline and no further
              dispute work is needed in ClaimClear.
            </span>
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <SavingIndicator show={optimistic.showSaving} />
          <Button
            onClick={onConfirm}
            disabled={!canSubmit}
            data-testid="remove-handled-offline-confirm"
          >
            {optimistic.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
            ) : (
              <Link2Off className="h-3.5 w-3.5 mr-1" />
            )}
            Remove leg
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
