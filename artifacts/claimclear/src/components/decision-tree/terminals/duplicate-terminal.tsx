// Muted card rendered for legs whose `duplicateOfClaimId` is set.
// Mounted both via the role-driven dispatch in `sop-advance-player`
// (when a tree is present) and directly from `claim-detail-v2` when no
// tree is configured yet. Does not use the `tree` prop.

import { Card, CardContent } from "@/components/ui/card";
import { Copy } from "lucide-react";
import type { TerminalCommonProps } from "./types";

export function DuplicateTerminal({ leg }: TerminalCommonProps) {
  const primaryId = leg.duplicateOfClaimId;
  return (
    <Card
      className="bg-muted/30 border-muted-foreground/20 border"
      data-testid="sop-terminal-card"
    >
      <CardContent className="p-4 space-y-2">
        <div className="flex items-start gap-2 text-sm">
          <Copy className="h-4 w-4 mt-0.5 flex-shrink-0 text-muted-foreground" />
          <div className="space-y-1">
            <p className="font-medium">
              Sibling Duplicate of{" "}
              <code className="font-mono">CLM-{primaryId}</code>
            </p>
            <p className="text-xs text-muted-foreground">
              This leg's dispute rolls up to the primary leg's SOP and
              verdict. No independent SOP walk is required.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
