import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useUpdateInvoiceGroupOutcome,
  getGetInvoiceGroupQueryKey,
  getGetInvoiceGroupValidTransitionsQueryKey,
  getListInvoiceGroupsQueryKey,
} from "@workspace/api-client-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useToast, successToast } from "@/hooks/use-toast";

export const CLOSE_AS_NON_ISSUE_NOTE_MIN = 80;
const NOTE_MIN = CLOSE_AS_NON_ISSUE_NOTE_MIN;

// Single source of truth for the payload that gets POSTed to
// `PATCH /invoice-groups/:id/outcome` when closing as non-issue.
// The backend's `closure-validation` requires every field below for a
// `non_issue` closure, so the dialog and any future callers must
// construct the body through this helper to stay in lockstep.
export function buildCloseAsNonIssuePayload(narrative: string) {
  return {
    // vocab-allow-next-line — API enum value (see lib/vocab/src/outcome.ts), not a UI label.
    outcome: "Non-Issue" as const,
    closureReason: "non_issue" as const,
    closureCategory: "other",
    closureCategoryOther: "Resolved offline (non-issue)",
    closureRootCause: "other",
    closureRootCauseOther: "Resolved offline (non-issue)",
    closureNarrative: narrative,
    closureAccountabilityTags: ["other"] as Array<"other">,
    closureAccountabilityOther: "n/a (resolved offline)",
  };
}

export function isCloseAsNonIssueNoteReady(narrative: string): boolean {
  return narrative.trim().length >= NOTE_MIN;
}

function extractErrorMessage(err: unknown): string {
  if (err && typeof err === "object") {
    const e = err as {
      body?: { error?: unknown };
      responseBody?: { error?: unknown };
      message?: unknown;
    };
    const fromBody =
      typeof e.body?.error === "string" ? e.body.error : undefined;
    const fromResponseBody =
      typeof e.responseBody?.error === "string"
        ? e.responseBody.error
        : undefined;
    const fromMessage =
      typeof e.message === "string" ? e.message : undefined;
    return (
      fromBody ?? fromResponseBody ?? fromMessage ?? "Failed to close as non-issue"
    );
  }
  return "Failed to close as non-issue";
}

export type CloseAsNonIssueDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groupId: number;
  onSuccess?: () => void;
};

export function CloseAsNonIssueDialog({
  open,
  onOpenChange,
  groupId,
  onSuccess,
}: CloseAsNonIssueDialogProps) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const mutation = useUpdateInvoiceGroupOutcome();

  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setNote("");
    setError(null);
  }, [open]);

  const trimmed = note.trim();
  const ready = trimmed.length >= NOTE_MIN && !mutation.isPending;

  async function handleConfirm() {
    if (!ready) return;
    setError(null);
    try {
      await mutation.mutateAsync({
        id: groupId,
        data: buildCloseAsNonIssuePayload(trimmed),
      });
      qc.invalidateQueries({ queryKey: getGetInvoiceGroupQueryKey(groupId) });
      qc.invalidateQueries({
        queryKey: getGetInvoiceGroupValidTransitionsQueryKey(groupId),
      });
      qc.invalidateQueries({ queryKey: getListInvoiceGroupsQueryKey() });
      successToast({
        title: "__VERB__",
        description: "Group closed as non-issue.",
      });
      onOpenChange(false);
      onSuccess?.();
    } catch (err: unknown) {
      const msg = extractErrorMessage(err);
      setError(msg);
      toast({
        title: "Couldn't close as non-issue",
        description: msg,
        variant: "destructive",
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-lg"
        data-testid="close-as-non-issue-dialog"
      >
        <DialogHeader>
          <DialogTitle>Close as non-issue</DialogTitle>
          <DialogDescription>
            Use this when the situation was resolved offline and there is no
            dispute to pursue. The group will be removed from the active
            queue and recorded with a distinct closure reason (separate from
            Withdraw).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div>
            <Label htmlFor="close-non-issue-note" className="text-xs">
              Operator note <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="close-non-issue-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="What was the situation, and how was it resolved offline? (min 80 characters)"
              rows={5}
              data-testid="close-as-non-issue-note-input"
            />
            <div className="text-[11px] text-muted-foreground mt-1">
              {trimmed.length} / {NOTE_MIN} characters
            </div>
          </div>
          {error ? (
            <div className="text-xs text-destructive" role="alert">
              {error}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={mutation.isPending}
            data-testid="close-as-non-issue-cancel-button"
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleConfirm}
            disabled={!ready}
            data-testid="close-as-non-issue-confirm-button"
          >
            {mutation.isPending ? "Closing…" : "Close as non-issue"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
