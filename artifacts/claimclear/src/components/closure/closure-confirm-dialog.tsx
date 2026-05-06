import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useUpdateClaimOutcome,
  useUpdateInvoiceGroupOutcome,
  getGetClaimQueryKey,
  getGetClaimValidTransitionsQueryKey,
  getListClaimAuditLogsQueryKey,
  getGetInvoiceGroupQueryKey,
  getGetInvoiceGroupValidTransitionsQueryKey,
  getListClaimEvidenceQueryKey,
  getListInvoiceGroupEvidenceQueryKey,
  getListWithdrawalsQueryKey,
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
import { successToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Loader2, Mail, Bot, Sparkles } from "lucide-react";
import { CLOSURE_REASON_BANNER } from "./closure-options";
import { formatDateTime } from "@/lib/format";

/**
 * Light "confirm" dialog for the response-driven Denied-by-Payor flow.
 *
 * Why this exists separately from <ClosureIntakeDialog>:
 *   The structured intake (category / root cause / narrative / audience /
 *   accountability) makes sense when WE are deciding the claim cannot
 *   proceed (per-claim work tree, manual Cannot-Dispute on a group). It
 *   does NOT make sense when the operator is just recording the payor's
 *   final denial — the outcome was determined by them, not us, and the
 *   payor's response IS the record. Forcing the heavy form on top of that
 *   is friction with no recovered information.
 *
 * What the operator sees:
 *   • The Denied-by-Payor banner.
 *   • A summary block of the payor response we're closing against
 *     (source, sender, timestamp, AI hint, AI summary) so they can see
 *     exactly which response is being recorded.
 *   • An optional "Add a note" textarea for anything they want appended
 *     to the audit narrative.
 *   • A single "Mark Denied by Payor" button.
 *
 * What we send to the server (auto-filled):
 *   • outcome: "Denied", closureReason: "denied_by_payor"
 *   • closureCategory: "payor_denial"
 *   • closureRootCause: "denied_no_recourse"  (final denial, no appeal path)
 *   • closureNarrative: built from the payor response context (always
 *     ≥80 chars to satisfy the backend minimum) plus any operator note.
 *   • closureAccountabilityTags: ["external_payor"]
 *
 * Backend validation (lib/closure-validation.ts) requires category, root
 * cause, ≥80-char narrative and ≥1 accountability tag for denied_by_payor;
 * every required field is filled here so the operator just confirms.
 */

export type ConfirmResponseContext = {
  responseId?: number | string;
  source?: "email" | "portal" | string | null;
  senderName?: string | null;
  senderEmail?: string | null;
  receivedAt?: string | null;
  responseType?: string | null;
  responseTypeLabel?: string | null;
  aiSummary?: string | null;
};

export type ClosureConfirmDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: { kind: "claim" | "group"; id: number };
  response: ConfirmResponseContext | null;
  /**
   * Same contract as the full intake dialog: an optional pre-flight that
   * runs before the closure mutation. Used by the Step 4 close-out path
   * to promote per-leg verdict drafts in the same operator gesture as
   * closure. If it rejects, the dialog stays open with the error and
   * the closure mutation does not run.
   */
  beforeSubmit?: () => Promise<void>;
  onSuccess?: () => void;
};

function senderLabelFor(r: ConfirmResponseContext | null): string {
  if (!r) return "the payor";
  return (
    r.senderName ||
    r.senderEmail ||
    (r.source === "portal" ? "MAS Portal" : "the payor")
  );
}

function buildNarrative(
  r: ConfirmResponseContext | null,
  note: string,
): string {
  const sender = senderLabelFor(r);
  const when = r?.receivedAt ? formatDateTime(r.receivedAt) : "an earlier date";
  const typeLabel = r?.responseTypeLabel || r?.responseType || "denial";
  const parts: string[] = [
    `Recorded as Denied by Payor based on the payor response received ${when} from ${sender}.`,
    `Classified as ${typeLabel}.`,
    `The payor's response is the record of why; no internal root-cause investigation is required for this closure.`,
  ];
  if (r?.aiSummary && r.aiSummary.trim().length > 0) {
    parts.push(`AI summary of the response: ${r.aiSummary.trim()}`);
  }
  const trimmedNote = note.trim();
  if (trimmedNote.length > 0) {
    parts.push(`Operator note: ${trimmedNote}`);
  }
  return parts.join(" ");
}

export function ClosureConfirmDialog({
  open,
  onOpenChange,
  target,
  response,
  beforeSubmit,
  onSuccess,
}: ClosureConfirmDialogProps) {
  const queryClient = useQueryClient();
  const banner = CLOSURE_REASON_BANNER.denied_by_payor;

  const [note, setNote] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);

  const updateClaimOutcome = useUpdateClaimOutcome();
  const updateGroupOutcome = useUpdateInvoiceGroupOutcome();

  const isClaim = target.kind === "claim";
  const submitting = isClaim
    ? updateClaimOutcome.isPending
    : updateGroupOutcome.isPending;

  useEffect(() => {
    if (!open) return;
    setNote("");
    setSubmitError(null);
  }, [open]);

  const handleSubmit = async () => {
    if (submitting) return;
    setSubmitError(null);

    if (beforeSubmit) {
      try {
        await beforeSubmit();
      } catch (err: unknown) {
        const msg =
          err instanceof Error ? err.message : "Couldn't save your selections.";
        setSubmitError(msg);
        return;
      }
    }

    const narrative = buildNarrative(response, note);

    const payload = {
      // The literal "Denied" is the API enum value (kept verbatim in the
      // OpenAPI/DB contract). All operator-facing copy goes through vocab
      // — see ClosureIntakeDialog for the matching pattern.
      // vocab-allow-next-line
      outcome: "Denied" as const,
      closureReason: "denied_by_payor" as const,
      closureCategory: "payor_denial",
      closureCategoryOther: null,
      closureRootCause: "denied_no_recourse",
      closureRootCauseOther: null,
      closureNarrative: narrative,
      closureAccountabilityTags: ["external_payor" as const],
      closureAccountabilityOther: null,
      closureDrivers: null,
      closureDispatchers: null,
      closureCommunicatedTo: null,
    };

    try {
      if (isClaim) {
        await updateClaimOutcome.mutateAsync({ id: target.id, data: payload });
        queryClient.invalidateQueries({ queryKey: getGetClaimQueryKey(target.id) });
        queryClient.invalidateQueries({
          queryKey: getGetClaimValidTransitionsQueryKey(target.id),
        });
        queryClient.invalidateQueries({
          queryKey: getListClaimAuditLogsQueryKey(target.id),
        });
        queryClient.invalidateQueries({
          queryKey: getListClaimEvidenceQueryKey(target.id),
        });
        queryClient.invalidateQueries({ queryKey: getListWithdrawalsQueryKey() });
      } else {
        await updateGroupOutcome.mutateAsync({ id: target.id, data: payload });
        queryClient.invalidateQueries({
          queryKey: getGetInvoiceGroupQueryKey(target.id),
        });
        queryClient.invalidateQueries({
          queryKey: getGetInvoiceGroupValidTransitionsQueryKey(target.id),
        });
        queryClient.invalidateQueries({
          queryKey: getListInvoiceGroupEvidenceQueryKey(target.id),
        });
        queryClient.invalidateQueries({ queryKey: getListWithdrawalsQueryKey() });
      }

      successToast({
        title: "__VERB__",
        description: "Marked as Denied by Payor — added to Withdrawals Review",
      });
      onOpenChange(false);
      onSuccess?.();
    } catch (err: unknown) {
      const msg =
        (err as { body?: { error?: string }; responseBody?: { error?: string }; message?: string })
          ?.body?.error ||
        (err as { responseBody?: { error?: string } })?.responseBody?.error ||
        (err instanceof Error ? err.message : null) ||
        "Failed to record closure";
      setSubmitError(msg);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-lg"
        data-testid="closure-confirm-dialog"
      >
        <DialogHeader>
          <DialogTitle>{banner.label}</DialogTitle>
          <DialogDescription>
            Confirm closure based on the payor's response. The full structured
            form isn't needed here — the response is the record.
          </DialogDescription>
        </DialogHeader>

        <div
          className={cn(
            "rounded-md border px-4 py-3 text-sm font-medium",
            banner.bannerClass,
          )}
          data-testid="closure-outcome-banner"
        >
          <div className="font-semibold">{banner.label}</div>
          <div className="text-xs font-normal opacity-90 mt-0.5">
            {banner.description}
          </div>
        </div>

        {response ? (
          <div
            className="rounded-md border bg-muted/30 p-3 space-y-2"
            data-testid="closure-confirm-response-context"
          >
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Recording closure based on this response
            </div>
            <div className="flex items-center gap-2 text-sm flex-wrap">
              {response.source === "email" ? (
                <Mail className="h-4 w-4 text-muted-foreground" />
              ) : (
                <Bot className="h-4 w-4 text-muted-foreground" />
              )}
              <span className="font-medium">{senderLabelFor(response)}</span>
              {response.receivedAt && (
                <span className="text-xs text-muted-foreground">
                  · {formatDateTime(response.receivedAt)}
                </span>
              )}
              {(response.responseTypeLabel || response.responseType) && (
                <span className="inline-flex items-center rounded border bg-background px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
                  AI hint:{" "}
                  {response.responseTypeLabel ?? response.responseType}
                </span>
              )}
            </div>
            {response.aiSummary && (
              <div className="flex items-start gap-2 text-sm">
                <Sparkles className="h-4 w-4 text-blue-600 mt-0.5 shrink-0" />
                <p className="italic">{response.aiSummary}</p>
              </div>
            )}
          </div>
        ) : (
          <div
            className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"
            data-testid="closure-confirm-no-response"
          >
            We couldn't load a payor response to summarize here, but the
            closure will still be recorded as Denied by Payor.
          </div>
        )}

        <div>
          <Label className="text-xs">Add a note (optional)</Label>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder="Anything you want recorded with this closure for the audit trail."
            data-testid="closure-confirm-note"
          />
          <p className="text-[11px] text-muted-foreground mt-1">
            Appended to the audit narrative. Leave blank if there's nothing to
            add.
          </p>
        </div>

        {submitError && (
          <div
            className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
            data-testid="closure-confirm-error"
          >
            {submitError}
          </div>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
            data-testid="closure-confirm-cancel"
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className={cn(banner.submitClass)}
            data-testid="closure-confirm-submit"
          >
            {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {banner.submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
