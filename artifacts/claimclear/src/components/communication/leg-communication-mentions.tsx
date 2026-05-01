import { Link } from "wouter";
import { Mail, Lock, ArrowUpRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/format";

export interface LegMention {
  id: string;
  direction: "inbound" | "outbound";
  senderName: string;
  timestamp: string;
  preview: string;
}

interface Props {
  legLabel: string;
  parentGroupId: number;
  mentions: LegMention[];
}

export function LegCommunicationMentions({
  legLabel,
  parentGroupId,
  mentions,
}: Props) {
  return (
    <Card data-testid="leg-communication-mentions">
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Mail className="h-4 w-4" />
            Communication
            <Badge variant="secondary" className="text-xs">
              {mentions.length} mention{mentions.length === 1 ? "" : "s"}
            </Badge>
          </CardTitle>
          <Link href={`/invoice-groups/${parentGroupId}`}>
            <Button size="sm" variant="outline" className="text-xs h-8">
              Open invoice thread
              <ArrowUpRight className="h-3 w-3 ml-1" />
            </Button>
          </Link>
        </div>
      </CardHeader>
      <CardContent className="pt-0 space-y-0">
        <div className="flex items-start gap-1.5 text-xs text-muted-foreground bg-muted/40 rounded p-2 mb-3">
          <Lock className="h-3 w-3 mt-0.5 shrink-0" />
          <span>
            Conversations happen at the invoice level. This shows messages in
            the invoice thread that mention{" "}
            <span className="font-mono font-semibold">{legLabel}</span>. Reply
            or compose from the invoice page.
          </span>
        </div>

        {mentions.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">
            No messages mention this leg yet.
          </p>
        ) : (
          <div className="rounded-md border divide-y">
            {mentions.map((m) => (
              <div
                key={m.id}
                className="px-3 py-2 text-sm flex items-start gap-2"
              >
                <Mail
                  className="h-3 w-3 mt-1 shrink-0"
                  style={{
                    color:
                      m.direction === "inbound"
                        ? "hsl(45 93% 40%)"
                        : "hsl(270 60% 50%)",
                  }}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2 text-xs">
                    <span className="font-semibold">{m.senderName}</span>
                    <span className="text-muted-foreground">
                      {formatDateTime(m.timestamp)}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground truncate">
                    {m.preview}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
