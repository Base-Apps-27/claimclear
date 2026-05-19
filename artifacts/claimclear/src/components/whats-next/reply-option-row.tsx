import { Send, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * The Step-4 "I replied — wait for payor" option. Carries an extra
 * gate (operator must have actually sent an outbound reply on the
 * thread) plus a tooltip explaining the gate, so it lives in its own
 * thin wrapper rather than as a fourth disabled-state branch on every
 * caller of the generic option-row primitive.
 *
 * Extracted to its own module (Task #769) so the row can be unit-
 * tested without pulling the rest of the WhatsNextCard's hook tree —
 * the card imports auth, query-client, and toast hooks at module load.
 *
 * The visual shape is intentionally identical to the other Step-4
 * rows (same height, padding, typography) so the card reads as a
 * single "pick one" list.
 */
export function ReplyOptionRow({
  hasOperatorReply,
  onClick,
  disabled,
}: {
  hasOperatorReply: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  const description = hasOperatorReply
    ? "Drop this off the queue until the payor replies again."
    : "Send a reply on the email thread above to unlock this.";
  const row = (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || !hasOperatorReply}
      className={cn(
        "w-full flex items-center gap-3 rounded-md border bg-card px-3 py-2.5 text-left transition-colors",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        "border-blue-300 hover:bg-blue-50",
      )}
      data-testid="button-awaiting-payor-again"
    >
      <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-700">
        <Send className="h-4 w-4" />
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-semibold">
          I replied — wait for payor
        </span>
        <span className="block text-[11px] text-muted-foreground leading-snug">
          {description}
        </span>
      </span>
      <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
    </button>
  );
  if (!hasOperatorReply) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="block w-full" tabIndex={0}>
            {row}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs text-xs">
          Send a reply to the payor in the email thread above first —
          this unlocks once your reply has been sent.
        </TooltipContent>
      </Tooltip>
    );
  }
  return row;
}
