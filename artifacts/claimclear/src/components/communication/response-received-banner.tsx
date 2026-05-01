import { BellRing, ArrowDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/format";

export interface ResponseBannerData {
  senderName: string;
  subject: string;
  preview: string;
  timestamp: string;
  threadAnchorId?: string;
}

const AUTO_CONFIRM_PATTERN =
  /\b(confirm|received|ticket|auto[- ]?reply|acknowledgment|acknowledged)\b/i;

function isSubstantive(subject: string, preview: string): boolean {
  return !AUTO_CONFIRM_PATTERN.test(subject) || preview.length > 200;
}

interface Props {
  response: ResponseBannerData | null;
  onDismiss: () => void;
}

export function ResponseReceivedBanner({ response, onDismiss }: Props) {
  if (!response) return null;
  if (!isSubstantive(response.subject, response.preview)) return null;

  const anchorId = response.threadAnchorId ?? "invoice-thread";

  return (
    <a
      href={`#${anchorId}`}
      className="block rounded-lg no-underline transition-shadow hover:shadow-md"
      style={{
        background: "hsl(45 93% 95%)",
        border: "1px solid hsl(45 93% 47%)",
        borderLeftWidth: "4px",
        padding: "10px 14px",
      }}
      onClick={(e) => {
        e.preventDefault();
        document
          .getElementById(anchorId)
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      }}
    >
      <div className="flex items-center gap-3">
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
          style={{
            background: "hsl(45 93% 47%)",
            color: "white",
          }}
        >
          <BellRing className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span
              className="text-sm font-bold"
              style={{ color: "hsl(45 93% 30%)" }}
            >
              New response from {response.senderName}
            </span>
            <span className="text-xs text-muted-foreground">·</span>
            <span className="text-xs font-medium">{response.subject}</span>
            <span className="text-xs text-muted-foreground">·</span>
            <span className="text-xs text-muted-foreground">
              {formatDateTime(response.timestamp)}
            </span>
          </div>
          <div className="text-xs mt-0.5 truncate">
            &ldquo;{response.preview}&rdquo;
          </div>
          <div className="text-[11px] mt-0.5 flex items-center gap-1 text-muted-foreground">
            Auto-confirmations and ticket receipts are suppressed.
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <span
            className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded"
            style={{
              background: "hsl(45 93% 47%)",
              color: "white",
            }}
          >
            Jump to thread <ArrowDown className="w-3 h-3" />
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            title="Mark read"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onDismiss();
            }}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </a>
  );
}
