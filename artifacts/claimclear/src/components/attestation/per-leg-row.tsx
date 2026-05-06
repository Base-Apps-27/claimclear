import { useQueryClient } from "@tanstack/react-query";
import {
  useAttestClaim,
  useConfirmQueuedAttestation,
  getListAttestationPendingQueryKey,
  getGetInvoiceGroupQueryKey,
  getGetAttestationCountsQueryKey,
  getGetDashboardSummaryQueryKey,
  getGetClaimQueryKey,
} from "@workspace/api-client-react";
import type {
  ClaimResponse,
  AttestationPendingExtras,
  InvoiceGroupDetailResponse,
} from "@workspace/api-client-react";
import { successToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusPill } from "@/components/cohesion";
import { CheckCircle2 } from "lucide-react";
import { TONE_STYLE } from "@/components/cohesion";

export type AttestationState = "pending" | "queued";

export interface MergedRow {
  state: AttestationState;
  claim: ClaimResponse;
  extras: AttestationPendingExtras | null;
  enteredAt: string | null;
}

export function PerLegRow({
  row,
  invoiceGroupId,
  detail,
}: {
  row: MergedRow;
  invoiceGroupId: number | null;
  detail: InvoiceGroupDetailResponse | null;
}) {
  const qc = useQueryClient();
  const attest = useAttestClaim();
  const confirm = useConfirmQueuedAttestation();
  const { claim, state } = row;

  const liveLeg = detail?.rides?.find((r) => r.id === claim.id);
  const liveAttestationState =
    liveLeg?.attestationState ?? claim.attestationState;
  const alreadyConfirmed = liveAttestationState === "completed";

  const busy = attest.isPending || confirm.isPending;

  const invalidate = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: getGetClaimQueryKey(claim.id) }),
      qc.invalidateQueries({
        queryKey: getListAttestationPendingQueryKey({ state: "pending" }),
      }),
      qc.invalidateQueries({
        queryKey: getListAttestationPendingQueryKey({ state: "queued" }),
      }),
      qc.invalidateQueries({ queryKey: getGetAttestationCountsQueryKey() }),
      qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() }),
      ...(invoiceGroupId != null
        ? [
            qc.invalidateQueries({
              queryKey: getGetInvoiceGroupQueryKey(invoiceGroupId),
            }),
          ]
        : []),
    ]);
  };

  const onConfirmJustThisLeg = async () => {
    if (state === "pending") {
      await attest.mutateAsync({ id: claim.id, data: {} });
    } else {
      await confirm.mutateAsync({ id: claim.id, data: {} });
    }
    await invalidate();
    successToast({
      title: "__VERB__",
      description: `Confirmed re-attestation for ${claim.confNumber}.`,
    });
  };

  return (
    <li
      className="flex items-center gap-3 px-3 py-2.5 text-sm transition-colors hover:bg-muted/40"
      style={
        alreadyConfirmed
          ? { background: TONE_STYLE.green.bg }
          : undefined
      }
      data-testid={`group-leg-row-${claim.id}`}
    >
      <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
        <span className="font-mono font-medium">{claim.confNumber}</span>
        <Badge variant="outline" className="text-[10px] uppercase tracking-wide font-bold">
          {claim.outcome}
        </Badge>
        {alreadyConfirmed ? (
          <span data-testid={`already-confirmed-${claim.id}`}>
            <StatusPill tone="green" className="text-[10px]">
              <CheckCircle2 className="h-3 w-3" /> Already confirmed
            </StatusPill>
          </span>
        ) : (
          <StatusPill
            tone={state === "queued" ? "blue" : "amber"}
            className="text-[10px]"
          >
            {state === "queued" ? "Parked" : "Owed by you"}
          </StatusPill>
        )}
      </div>
      {!alreadyConfirmed && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="text-xs h-7 px-2.5 shrink-0"
          onClick={onConfirmJustThisLeg}
          disabled={busy}
          data-testid={`confirm-just-this-leg-${claim.id}`}
        >
          Confirm just this leg
        </Button>
      )}
    </li>
  );
}
