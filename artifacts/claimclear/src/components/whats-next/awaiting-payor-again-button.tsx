import { useMarkAwaitingPayorAgain } from "@workspace/api-client-react";
import type { InvoiceGroupResponse } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Send } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface Props {
  group: InvoiceGroupResponse;
  /** Invalidate parent caches after the stamp lands. */
  onAfterStamp: () => void;
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
export function AwaitingPayorAgainButton({ group, onAfterStamp }: Props) {
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

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="w-full justify-center gap-1.5 text-xs border-blue-300 bg-blue-50 hover:bg-blue-100 text-blue-900"
      onClick={handleClick}
      disabled={markWaiting.isPending}
      data-testid="button-awaiting-payor-again"
    >
      <Send className="h-3.5 w-3.5" />
      I replied — wait for payor again
    </Button>
  );
}
