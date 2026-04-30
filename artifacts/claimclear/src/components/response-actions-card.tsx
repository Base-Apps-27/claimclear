// Shared "Next Steps — Response Received" verdict lanes. Used by the claim
// detail page (inline, full width) and by the WorkflowPlayer when the claim
// is in the response-pending lifecycle phase, so both render identical
// buttons, copy, and disabled-state semantics.
//
// The AI hint badge labels what the system inferred from the latest payer
// response; the human still picks the verdict (resolve/deny/re-dispute).

import { ArrowRight, CheckCircle, Loader2, Send, Sparkles, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export type PostResponseAction =
  | "resolve_reattest"
  | "resolve_new_invoice"
  | "mark_denied_by_payor"
  | "re_dispute";

interface ResponseActionsCardProps {
  postResponseActions: string[];
  latestResponseType: string | null | undefined;
  notes: string;
  onNotesChange: (s: string) => void;
  isPending: boolean;
  onAction: (action: PostResponseAction) => void | Promise<void>;
  /** Compact rendering omits the notes textarea — used inside the player. */
  compact?: boolean;
}

function aiHintLabel(latestResponseType: string | null | undefined): string {
  switch (latestResponseType) {
    case "approval":
      return "Approval";
    case "partial_approval":
      return "Partial approval";
    case "denial":
      return "Denial";
    case "request_more_info":
      return "Request for more info";
    case "acknowledgment":
      return "Acknowledgment";
    default:
      return "Response received";
  }
}

function intro(latestResponseType: string | null | undefined): string {
  if (latestResponseType === "approval" || latestResponseType === "partial_approval") {
    return "A positive response was received. Choose how to proceed:";
  }
  if (latestResponseType === "denial") {
    return "The dispute was denied. Choose how to proceed:";
  }
  return "A response was received. Choose how to proceed:";
}

export function ResponseActionsCard({
  postResponseActions,
  latestResponseType,
  notes,
  onNotesChange,
  isPending,
  onAction,
  compact = false,
}: ResponseActionsCardProps) {
  if (!postResponseActions || postResponseActions.length === 0) return null;

  return (
    <Card className="border-2 border-blue-300 bg-blue-50/30">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-blue-900">
          <ArrowRight className="h-5 w-5" />
          Next Steps — Response Received
          <Badge
            variant="outline"
            className="ml-2 border-blue-300 bg-white/60 text-blue-700"
            data-testid="badge-ai-hint"
          >
            <Sparkles className="h-3 w-3 mr-1" />
            AI hint: {aiHintLabel(latestResponseType)}
          </Badge>
        </CardTitle>
        <p className="text-sm text-blue-700 mt-1">{intro(latestResponseType)}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {postResponseActions.includes("resolve_reattest") && (
            <Button
              variant="outline"
              className="h-auto py-3 px-4 flex flex-col items-start gap-1 bg-green-50 hover:bg-green-100 border-green-300 text-green-900"
              disabled={isPending}
              onClick={() => onAction("resolve_reattest")}
              data-testid="action-post-resolve-reattest"
            >
              <span className="flex items-center gap-2 font-semibold">
                <CheckCircle className="h-4 w-4" /> Resolve — Reattest
              </span>
              <span className="text-xs font-normal text-green-700">
                Team will reattest on external system
              </span>
            </Button>
          )}
          {postResponseActions.includes("resolve_new_invoice") && (
            <Button
              variant="outline"
              className="h-auto py-3 px-4 flex flex-col items-start gap-1 bg-green-50 hover:bg-green-100 border-green-300 text-green-900"
              disabled={isPending}
              onClick={() => onAction("resolve_new_invoice")}
              data-testid="action-post-resolve-new-invoice"
            >
              <span className="flex items-center gap-2 font-semibold">
                <CheckCircle className="h-4 w-4" /> Resolve — New Invoice #
              </span>
              <span className="text-xs font-normal text-green-700">
                Submit under new invoice number provided in response
              </span>
            </Button>
          )}
          {postResponseActions.includes("mark_denied_by_payor") && (
            <Button
              variant="outline"
              className="h-auto py-3 px-4 flex flex-col items-start gap-1 bg-red-50 hover:bg-red-100 border-red-300 text-red-900"
              disabled={isPending}
              onClick={() => onAction("mark_denied_by_payor")}
              data-testid="action-post-mark-denied-by-payor"
            >
              <span className="flex items-center gap-2 font-semibold">
                <X className="h-4 w-4" /> Mark as Denied by Payor
              </span>
              <span className="text-xs font-normal text-red-700">
                Close claim — denial accepted, no further action
              </span>
            </Button>
          )}
          {postResponseActions.includes("re_dispute") && (
            <Button
              variant="outline"
              className="h-auto py-3 px-4 flex flex-col items-start gap-1 bg-amber-50 hover:bg-amber-100 border-amber-300 text-amber-900"
              disabled={isPending}
              onClick={() => onAction("re_dispute")}
              data-testid="action-post-re-dispute"
            >
              <span className="flex items-center gap-2 font-semibold">
                <Send className="h-4 w-4" /> Re-dispute
              </span>
              <span className="text-xs font-normal text-amber-700">
                Gather additional evidence and resubmit through portal
              </span>
            </Button>
          )}
        </div>
        {!compact && (
          <div>
            <Label className="text-xs text-blue-700">Notes (optional)</Label>
            <Textarea
              value={notes}
              onChange={(e) => onNotesChange(e.target.value)}
              placeholder="Add context for this decision (e.g., new invoice number, reason for re-dispute)..."
              className="mt-1 bg-white/80 text-sm"
              rows={2}
            />
          </div>
        )}
        {isPending && (
          <div className="flex items-center gap-2 text-sm text-blue-600">
            <Loader2 className="h-4 w-4 animate-spin" /> Processing...
          </div>
        )}
      </CardContent>
    </Card>
  );
}
