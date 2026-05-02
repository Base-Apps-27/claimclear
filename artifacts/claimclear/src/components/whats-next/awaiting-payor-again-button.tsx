import { useMarkAwaitingPayorAgain } from "@workspace/api-client-react";
import type { InvoiceGroupResponse } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Send } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface Props {
  group: InvoiceGroupResponse;
  /** Invalidate parent caches after the stamp lands. */
  onAfterStamp: () => void;
  /**
   * True once the operator has actually sent an outbound reply on this
   * group's email thread. The button is disabled until then — clicking
   * "I replied" without having replied is the bug we're guarding here.
   */
  hasOperatorReply: boolean;
}

/**
 * "I replied — wait for payor again" — flips the
 * `awaiting_payor_again_at` stamp on the group and drops the row off
 * the Responses Awaiting Review page until the next inbound payor
 * reply arrives. The visible affordance for the operator's "I sent
 * something back, ball is in their court now" gesture.
 *
 * Hidden by the parent if the stamp is already set (defensive against
 * stale SSE windows).
 */
export function AwaitingPayorAgainButton({
  group,
  onAfterStamp,
  hasOperatorReply,
}: Props) {
  const { toast } = useToast();
  const markWaiting = useMarkAwaitingPayorAgain();

  const handleClick = async () => {
    try {
      await markWaiting.mutateAsync({ id: group.id, data: {} });
      onAfterStamp();
      toast({
        title: "Marked awaiting payor",
        description: "This row will reappear when the next reply arrives.",
        duration: 3000,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Could not record.";
      toast({
        title: "Failed",
        description: msg,
        variant: "destructive",
      });
    }
  };

  const disabled = markWaiting.isPending || !hasOperatorReply;
  const button = (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="w-full justify-center gap-1.5 text-xs border-blue-300 bg-blue-50 hover:bg-blue-100 text-blue-900 disabled:opacity-60"
      onClick={handleClick}
      disabled={disabled}
      data-testid="button-awaiting-payor-again"
    >
      <Send className="h-3.5 w-3.5" />
      I replied — wait for payor again
    </Button>
  );

  // Wrap in a tooltip when the gate is closed so the operator
  // understands why the button isn't clickable. We render the button
  // inside a span so the tooltip target still receives pointer events
  // even though the underlying button is disabled.
  if (!hasOperatorReply) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="block w-full" tabIndex={0}>
            {button}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs text-xs">
          Send a reply to the payor in the email thread above first —
          this button unlocks once your reply has been sent.
        </TooltipContent>
      </Tooltip>
    );
  }
  return button;
}
