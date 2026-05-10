import { useParams, useSearch } from "wouter";
import {
  useGetInvoiceGroup,
  getGetInvoiceGroupQueryKey,
} from "@workspace/api-client-react";
import { InvoiceGroupDetailV2 } from "@/components/invoice-group-detail-v2";
import { GroupDossierChrome } from "@/components/group-dossier-chrome";

// Task #659 — read-only group dossier. Submission gauntlet lives only
// in the queue right pane; operators reach it via the chrome's
// "Process this invoice in the queue →" CTA.
export default function InvoiceGroupDetail() {
  const params = useParams<{ id: string }>();
  const groupId = parseInt(params.id || "0", 10);
  const search = useSearch();
  const fromManual = new URLSearchParams(search).get("from") === "manual";

  const { data: detail } = useGetInvoiceGroup(groupId, {
    query: {
      queryKey: getGetInvoiceGroupQueryKey(groupId),
      enabled: !!groupId,
    },
  });

  return (
    <div data-testid="invoice-group-detail-page" className="space-y-3">
      <GroupDossierChrome groupId={groupId} detail={detail ?? null} fromManual={fromManual} />
      <InvoiceGroupDetailV2 groupId={groupId} />
    </div>
  );
}
