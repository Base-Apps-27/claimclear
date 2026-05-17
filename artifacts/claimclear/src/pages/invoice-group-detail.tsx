import { useParams, useSearch } from "wouter";
import { InvoiceGroupDetailV2 } from "@/components/invoice-group-detail-v2";

// Task #659 — read-only group dossier. Submission gauntlet lives only
// in the queue right pane; operators reach it via the dossier's
// "Process this invoice in the queue →" CTA in the left rail.
//
// Task #767 (D2 graduation, full restructure) — GroupDossierChrome was
// retired here. Its Submission Summary and Overrides-bar content now
// live inside InvoiceGroupDetailV2's left rail so the page reads as the
// single 3-col D2 surface instead of two stacked layouts.
export default function InvoiceGroupDetail() {
  const params = useParams<{ id: string }>();
  const groupId = parseInt(params.id || "0", 10);
  const search = useSearch();
  const fromManual = new URLSearchParams(search).get("from") === "manual";

  return (
    <div data-testid="invoice-group-detail-page">
      <InvoiceGroupDetailV2 groupId={groupId} fromManual={fromManual} />
    </div>
  );
}
