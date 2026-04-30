import { useState } from "react";
import {
  useAttestClaim,
  useQueueAttestationForClaim,
  useConfirmQueuedAttestation,
  getGetClaimQueryKey,
  getGetAttestationCountsQueryKey,
  getListClaimAuditLogsQueryKey,
  getGetDashboardSummaryQueryKey,
} from "@workspace/api-client-react";
import type { ClaimResponse } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ShieldCheck, Inbox, Check } from "lucide-react";

type AttestationPromptProps = {
  claim: ClaimResponse;
  /** Compact mode hides the headline + subtitle (used inside the queue). */
  compact?: boolean;
  onActionDone?: () => void;
};

/**
 * Surface for the off-system re-attestation step. Renders one of three
 * shapes depending on `claim.attestationState`:
 *   - pending: amber prompt with two CTAs ("I attested" / "Park for portal user")
 *   - queued:  blue prompt with one CTA ("Confirm attestation")
 *   - completed: green confirmation chip (read-only history reminder)
 *
 * Anything else (`not_required` or non-Approved verdicts) renders nothing.
 *
 * The component owns its own note state and mutations so it can be dropped
 * anywhere a `ClaimResponse` is in scope (claim-detail page, queue rows, etc).
 */
export function AttestationPrompt({ claim, compact, onActionDone }: AttestationPromptProps) {
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const [showNote, setShowNote] = useState(false);

  const attest = useAttestClaim();
  const queue = useQueueAttestationForClaim();
  const confirm = useConfirmQueuedAttestation();

  const invalidate = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: getGetClaimQueryKey(claim.id) }),
      qc.invalidateQueries({ queryKey: getListClaimAuditLogsQueryKey(claim.id) }),
      qc.invalidateQueries({ queryKey: getGetAttestationCountsQueryKey() }),
      qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() }),
      // Refresh both pending and queued lists in the queue surface.
      qc.invalidateQueries({ queryKey: ["/claims/attestation-pending"] }),
    ]);
  };

  const isApprovedFamily = claim.outcome === "Approved" || claim.outcome === "Partially Approved";
  if (!isApprovedFamily) return null;

  const state = claim.attestationState;
  if (state === "not_required") return null;

  const trimmedNote = note.trim();
  const noteForRequest = trimmedNote === "" ? undefined : trimmedNote;

  const handleAttest = async () => {
    await attest.mutateAsync({ id: claim.id, data: { note: noteForRequest } });
    setNote("");
    setShowNote(false);
    await invalidate();
    onActionDone?.();
  };

  const handleQueue = async () => {
    await queue.mutateAsync({ id: claim.id, data: { note: noteForRequest } });
    setNote("");
    setShowNote(false);
    await invalidate();
    onActionDone?.();
  };

  const handleConfirm = async () => {
    await confirm.mutateAsync({ id: claim.id, data: { note: noteForRequest } });
    setNote("");
    setShowNote(false);
    await invalidate();
    onActionDone?.();
  };

  if (state === "completed") {
    const when = claim.attestedAt ? new Date(claim.attestedAt).toLocaleString() : null;
    return (
      <div
        className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 flex items-start gap-3"
        data-testid="attestation-prompt-completed"
      >
        <Check className="h-5 w-5 mt-0.5 text-emerald-700 shrink-0" />
        <div className="flex-1">
          <div className="font-semibold">Re-attestation complete</div>
          <div className="text-xs text-emerald-800/80 mt-0.5">
            {claim.attestedBy ? `Confirmed by ${claim.attestedBy}` : "Confirmed"}
            {when ? ` on ${when}` : ""}
            {claim.attestationNote ? ` — ${claim.attestationNote}` : ""}
          </div>
        </div>
      </div>
    );
  }

  const tone = state === "pending" ? "amber" : "blue";
  const Icon = state === "pending" ? ShieldCheck : Inbox;
  const headline = state === "pending"
    ? "Don't forget — re-attest in the payor portal"
    : "Queued for someone with payor-portal access";
  const subtitle = state === "pending"
    ? "Approved verdicts only become billable once the operator re-attests in the payor portal. We track that step here so it doesn't fall through the cracks."
    : claim.attestationQueuedBy
      ? `Parked by ${claim.attestationQueuedBy}${claim.attestationQueuedAt ? ` on ${new Date(claim.attestationQueuedAt).toLocaleString()}` : ""}.`
      : "This claim is waiting for someone with portal access to confirm the re-attestation.";

  const wrapClass = tone === "amber"
    ? "border-amber-300 bg-amber-50"
    : "border-blue-300 bg-blue-50";
  const iconClass = tone === "amber" ? "text-amber-700" : "text-blue-700";
  const titleClass = tone === "amber" ? "text-amber-900" : "text-blue-900";
  const subClass = tone === "amber" ? "text-amber-900/80" : "text-blue-900/80";

  const busy = attest.isPending || queue.isPending || confirm.isPending;

  return (
    <div
      className={`rounded-md border ${wrapClass} px-4 py-3`}
      data-testid={`attestation-prompt-${state}`}
    >
      <div className="flex items-start gap-3">
        <Icon className={`h-5 w-5 mt-0.5 shrink-0 ${iconClass}`} />
        <div className="flex-1 min-w-0">
          {!compact && (
            <>
              <div className={`font-semibold text-sm ${titleClass}`}>{headline}</div>
              <div className={`text-xs mt-0.5 ${subClass}`}>{subtitle}</div>
            </>
          )}
          {compact && (
            <div className={`text-xs ${subClass}`}>{subtitle}</div>
          )}
          {claim.attestationNote && (
            <div className={`text-xs mt-1 ${subClass}`}>
              <span className="font-medium">Note:</span> {claim.attestationNote}
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {state === "pending" && (
              <>
                <Button
                  size="sm"
                  onClick={handleAttest}
                  disabled={busy}
                  data-testid="attest-self-confirm"
                >
                  <ShieldCheck className="h-4 w-4 mr-1.5" /> I attested in the portal
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleQueue}
                  disabled={busy}
                  data-testid="attest-queue"
                >
                  <Inbox className="h-4 w-4 mr-1.5" /> Park for portal user
                </Button>
              </>
            )}
            {state === "queued" && (
              <Button
                size="sm"
                onClick={handleConfirm}
                disabled={busy}
                data-testid="attest-queue-confirm"
              >
                <ShieldCheck className="h-4 w-4 mr-1.5" /> Confirm I attested
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShowNote((v) => !v)}
              disabled={busy}
              data-testid="attest-toggle-note"
            >
              {showNote ? "Hide note" : "Add note"}
            </Button>
          </div>

          {showNote && (
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Optional context — e.g. portal ticket #, confirmation snippet, or who you handed it off to."
              className="mt-2 text-sm"
              rows={2}
              data-testid="attest-note-input"
            />
          )}
        </div>
      </div>
    </div>
  );
}
