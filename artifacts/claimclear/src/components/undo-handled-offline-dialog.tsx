import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useIncludeLeg,
  getGetClaimQueryKey,
  getGetInvoiceGroupQueryKey,
  getListInvoiceGroupsQueryKey,
  getListClaimAuditLogsQueryKey,
} from "@workspace/api-client-react";
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
import { Loader2, Undo2 } from "lucide-react";
import { useToast, successToast } from "@/hooks/use-toast";
import { markLocalAction } from "@/hooks/use-local-action-mark";
import {
  UNDO_HANDLED_OFFLINE_NOTE_MIN as NOTE_MIN_HELPER,
  trimmedNoteLength,
  isUndoHandledOfflineNoteValid,
  canSubmitUndoHandledOffline,
  buildUndoHandledOfflinePayload,
} from "./undo-handled-offline-dialog-helpers";

// Task #694 — confirmation dialog for the "Undo — re-include leg"
// reversal of the Task #689 handled-offline removal. Reuses the
// existing `includeLeg` mutation with the new `undoHandledOffline:
// true` flag; the server enforces the >=10-char note rule, verifies
// the leg's last exit really was handled-offline, and writes the
// distinct `claim_removed_handled_offline_undone` audit action so
// the activity timeline pairs the entry/exit cleanly.

export const UNDO_HANDLED_OFFLINE_NOTE_MIN = NOTE_MIN_HELPER;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  claimId: number;
  groupId?: number | null;
  onUndone?: () => void;
}

export function UndoHandledOfflineDialog({
  open,
  onOpenChange,
  claimId,
  groupId,
  onUndone,
}: Props) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const includeMutation = useIncludeLeg();
  const [note, setNote] = useState("");
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    if (!open) {
      setNote("");
      setConfirmed(false);
    }
  }, [open]);

  const trimmedLength = trimmedNoteLength(note);
  const noteValid = isUndoHandledOfflineNoteValid(note);
  const canSubmit = canSubmitUndoHandledOffline({
    note,
    confirmed,
    isPending: includeMutation.isPending,
  });

  function onConfirm() {
    if (!canSubmit) return;
    includeMutation.mutate(
      {
        id: claimId,
        data: buildUndoHandledOfflinePayload(note),
      },
      {
        onSuccess: () => {
          markLocalAction(`claim:${claimId}`);
          successToast({
            title: "Done",
            description: "Leg re-included in dispute",
          });
          qc.invalidateQueries({ queryKey: getGetClaimQueryKey(claimId) });
          qc.invalidateQueries({
            queryKey: getListClaimAuditLogsQueryKey(claimId),
          });
          if (groupId != null) {
            qc.invalidateQueries({
              queryKey: getGetInvoiceGroupQueryKey(groupId),
            });
          }
          qc.invalidateQueries({ queryKey: getListInvoiceGroupsQueryKey() });
          onOpenChange(false);
          onUndone?.();
        },
        onError: (e: unknown) =>
          toast({
            title: "Could not undo removal",
            description: e instanceof Error ? e.message : String(e),
            variant: "destructive",
          }),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="undo-handled-offline-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Undo2 className="h-4 w-4 text-emerald-600" />
            Undo — re-include this leg?
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            This reverses the earlier &ldquo;Removed — handled offline&rdquo;
            exit and brings the leg back into the dispute work queues. Use
            this when the offline resolution fell through or the original
            removal was a misclick. The activity timeline will record this as
            <span className="font-medium"> &ldquo;Undone — re-included after handled-offline removal&rdquo;</span>.
          </p>
          <div className="space-y-1.5">
            <label
              className="text-sm font-medium"
              htmlFor={`undo-handled-offline-note-${claimId}`}
            >
              Note (required, at least {UNDO_HANDLED_OFFLINE_NOTE_MIN} characters)
            </label>
            <Textarea
              id={`undo-handled-offline-note-${claimId}`}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. MAS portal payment was reversed — re-opening dispute."
              rows={3}
              data-testid="undo-handled-offline-note"
            />
            <p
              className={`text-xs ${
                noteValid ? "text-muted-foreground" : "text-amber-700"
              }`}
              data-testid="undo-handled-offline-note-counter"
            >
              {trimmedLength}/{UNDO_HANDLED_OFFLINE_NOTE_MIN}+ characters
            </p>
          </div>
          <label
            className="flex items-start gap-2 text-sm cursor-pointer"
            data-testid="undo-handled-offline-confirm-label"
          >
            <Checkbox
              checked={confirmed}
              onCheckedChange={(v) => setConfirmed(v === true)}
              data-testid="undo-handled-offline-confirm-checkbox"
              className="mt-0.5"
            />
            <span>
              I confirm the offline resolution no longer applies and this leg
              should rejoin the dispute work queues.
            </span>
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={onConfirm}
            disabled={!canSubmit}
            data-testid="undo-handled-offline-confirm"
          >
            {includeMutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
            ) : (
              <Undo2 className="h-3.5 w-3.5 mr-1" />
            )}
            Re-include leg
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
