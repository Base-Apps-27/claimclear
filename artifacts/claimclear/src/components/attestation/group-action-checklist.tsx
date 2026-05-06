import { useQueryClient } from "@tanstack/react-query";
import type { InvoiceGroupDetailResponse } from "@workspace/api-client-react";
import {
  useCompleteGroupReattest,
  useCompleteLegMasAction,
  getListAttestationPendingQueryKey,
  getGetInvoiceGroupAttestationHistoryQueryKey,
  getGetInvoiceGroupQueryKey,
  getGetAttestationCountsQueryKey,
  getGetDashboardSummaryQueryKey,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { MasActionChecklist } from "@/components/mas-action-checklist";

export function GroupActionChecklist({
  detail,
  bucketKey,
}: {
  detail: InvoiceGroupDetailResponse;
  bucketKey: string;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const completeReattest = useCompleteGroupReattest();
  const completeLegMas = useCompleteLegMasAction();

  const invalidateAfterMutation = async () => {
    await Promise.all([
      qc.invalidateQueries({
        queryKey: getGetInvoiceGroupQueryKey(detail.id),
      }),
      qc.invalidateQueries({
        queryKey: getListAttestationPendingQueryKey({ state: "pending" }),
      }),
      qc.invalidateQueries({
        queryKey: getListAttestationPendingQueryKey({ state: "queued" }),
      }),
      qc.invalidateQueries({
        queryKey: getGetInvoiceGroupAttestationHistoryQueryKey(),
      }),
      qc.invalidateQueries({ queryKey: getGetAttestationCountsQueryKey() }),
      qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() }),
    ]);
  };

  return (
    <div data-testid={`group-action-checklist-${bucketKey}`}>
      <MasActionChecklist
        group={detail}
        onCompleteLegMasAction={async (claimId, body) => {
          await completeLegMas.mutateAsync({ id: claimId, data: body });
          await invalidateAfterMutation();
          toast({
            title: "MAS cancellation recorded",
            description: `Marked claim ${claimId} cancelled in MAS.`,
          });
        }}
        onCompleteGroupReattest={async (body) => {
          const invoiceLabel = detail.invoiceNumber ?? `#${detail.id}`;
          const eligible = (detail.rides ?? []).filter(
            (r) => r.outcome === "Approved" || r.outcome === "Partially Approved",
          );
          const blocked = eligible.filter(
            (r) =>
              r.masActionRequired === "cancel" &&
              r.masActionCompletedAt == null,
          );
          try {
            await completeReattest.mutateAsync({
              id: detail.id,
              data: body,
            });
          } catch (err) {
            const status = (err as { response?: { status?: number } } | null)
              ?.response?.status;
            if (status === 409 && blocked.length > 0) {
              const refs = blocked.map((b) => b.confNumber).join(", ");
              toast({
                variant: "destructive",
                title: "Re-attestation skipped some legs",
                description: `${blocked.length} leg${blocked.length === 1 ? "" : "s"} on ${invoiceLabel} still need a MAS cancel before they can graduate: ${refs}.`,
              });
              return;
            }
            throw err;
          }
          await invalidateAfterMutation();
          const total = eligible.length;
          toast({
            title: "Re-attestation confirmed",
            description: `Confirmed re-attestation for invoice ${invoiceLabel} — ${total} leg${total === 1 ? "" : "s"} graduated.`,
          });
        }}
      />
    </div>
  );
}
