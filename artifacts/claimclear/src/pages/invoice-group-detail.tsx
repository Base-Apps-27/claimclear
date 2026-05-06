import { useParams, useSearch } from "wouter";
import { Sparkles } from "lucide-react";
import { InvoiceGroupDetailV2 } from "@/components/invoice-group-detail-v2";
import { TONE_STYLE } from "@/components/cohesion";

// Per-invoice transition is fully cut over: InvoiceGroupDetailV2 is the
// only group orchestration surface (Aggregate Context · Legs Queue ·
// Generate Submission Preview). The legacy page (and the embedded
// PerInvoiceTransitionSurface flag-on preview) was removed in Task #199.
export default function InvoiceGroupDetail() {
  const params = useParams<{ id: string }>();
  const id = parseInt(params.id || "0", 10);
  const search = useSearch();
  // `?from=manual` is set by the manual-invoice form so the operator
  // lands here knowing where to start. The banner is the only thing
  // the page wrapper adds — V2 owns everything else.
  const fromManual = new URLSearchParams(search).get("from") === "manual";
  return (
    <div className="space-y-3">
      {fromManual && (
        <div
          className="rounded-md border px-4 py-3 flex items-start gap-3"
          style={{
            background: TONE_STYLE.purple.bg,
            borderColor: TONE_STYLE.purple.border,
            color: TONE_STYLE.purple.fg,
          }}
          data-testid="banner-from-manual"
        >
          <Sparkles className="h-4 w-4 mt-0.5 flex-shrink-0" />
          <div className="text-sm">
            Invoice saved. Pick an error type for each leg below to start triage,
            then walk the SOP and queue the dispute.
          </div>
        </div>
      )}
      <InvoiceGroupDetailV2 groupId={id} />
    </div>
  );
}
