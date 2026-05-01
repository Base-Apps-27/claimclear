import { useParams } from "wouter";
import { InvoiceGroupDetailV2 } from "@/components/invoice-group-detail-v2";

// Per-invoice transition is fully cut over: InvoiceGroupDetailV2 is the
// only group orchestration surface (Aggregate Context · Legs Queue ·
// Generate Submission Preview). The legacy page (and the embedded
// PerInvoiceTransitionSurface flag-on preview) was removed in Task #199.
export default function InvoiceGroupDetail() {
  const params = useParams<{ id: string }>();
  const id = parseInt(params.id || "0", 10);
  return <InvoiceGroupDetailV2 groupId={id} />;
}
