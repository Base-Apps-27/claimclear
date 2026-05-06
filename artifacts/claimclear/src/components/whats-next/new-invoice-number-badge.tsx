import { FileText } from "lucide-react";
import { RefNumber } from "@/components/ref-number";

interface Props {
  invoiceNumber: string;
}

/**
 * Small badge that surfaces the AI-classified new invoice number
 * extracted from the freshest payor response metadata. Visually muted
 * so it reads as a hint, not a verdict — the operator still has to
 * decide what to do with it.
 *
 * Rendered inside the "What's next?" card whenever the inbound-email
 * classifier wrote a `newInvoiceNumber` into `PortalResponseItem.metadata`.
 */
export function NewInvoiceNumberBadge({ invoiceNumber }: Props) {
  return (
    <div
      className="inline-flex items-center gap-1.5 rounded-md border border-indigo-200 bg-indigo-50 px-2 py-1 text-[11px] text-indigo-900"
      data-testid="whats-next-new-invoice-number"
    >
      <FileText className="h-3 w-3" />
      <span className="font-medium">Payor cited a new invoice #:</span>
      <RefNumber value={invoiceNumber} variant="inline" />
    </div>
  );
}
