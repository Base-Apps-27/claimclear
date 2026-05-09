// Sibling-detection prompt rendered above the first SOP question when
// the leg has a trip-overriding primary candidate. Eligibility lives in
// `lib/sop-sibling-eligibility.ts`. CTA calls `useMarkLegDuplicate`.

import { useQueryClient } from "@tanstack/react-query";
import {
  useMarkLegDuplicate,
  getGetClaimQueryKey,
  getGetInvoiceGroupQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Copy, Loader2 } from "lucide-react";
import { useToast, successToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

export interface SiblingDuplicatePromptProps {
  legId: number;
  invoiceGroupId?: number | null;
  primaryClaimId: number;
  primaryConfNumber: string;
  primaryErrorTypeName?: string | null;
}

export function buildMarkDuplicateRequest(args: {
  legId: number;
  primaryClaimId: number;
}): { id: number; data: { primaryClaimId: number; note: null } } {
  return {
    id: args.legId,
    data: { primaryClaimId: args.primaryClaimId, note: null },
  };
}

// Presentational view split out so Guard #10 (full-card disable while a
// mark-duplicate is in flight) can be exercised in tests without driving
// react-query through a mutation lifecycle.
export function SiblingDuplicatePromptView({
  isPending,
  onClick,
  primaryConfNumber,
  primaryErrorTypeName,
}: {
  isPending: boolean;
  onClick: () => void;
  primaryConfNumber: string;
  primaryErrorTypeName?: string | null;
}) {
  return (
    <Card
      aria-busy={isPending}
      data-pending={isPending ? "true" : "false"}
      className={cn(
        "bg-amber-50 border-amber-200 dark:bg-amber-950/20 dark:border-amber-900 transition-opacity",
        isPending && "opacity-60 pointer-events-none",
      )}
      data-testid="sop-sibling-prompt"
    >
      <CardContent className="p-3 space-y-2">
        <div className="flex items-start gap-2 text-sm">
          <Copy className="h-4 w-4 mt-0.5 flex-shrink-0 text-amber-700 dark:text-amber-300" />
          <div className="space-y-1">
            <p className="font-medium">Looks like a sibling duplicate</p>
            <p className="text-xs text-muted-foreground">
              <span className="font-mono">{primaryConfNumber}</span>
              {primaryErrorTypeName ? ` (${primaryErrorTypeName})` : ""} is a
              trip-overriding primary on this invoice. Mark this leg as a
              sibling duplicate to skip the redundant SOP walk.
            </p>
          </div>
        </div>
        <div className="flex justify-end">
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            disabled={isPending}
            onClick={onClick}
            data-testid="sop-sibling-prompt-btn"
          >
            {isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
            Mark as sibling duplicate of {primaryConfNumber}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function SiblingDuplicatePrompt({
  legId,
  invoiceGroupId,
  primaryClaimId,
  primaryConfNumber,
  primaryErrorTypeName,
}: SiblingDuplicatePromptProps) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const markDuplicate = useMarkLegDuplicate();

  function handleClick() {
    if (markDuplicate.isPending) return;
    markDuplicate.mutate(
      buildMarkDuplicateRequest({ legId, primaryClaimId }),
      {
        onSuccess: () => {
          successToast({ title: "__VERB__", description: "Leg marked as Sibling Duplicate" });
          qc.invalidateQueries({ queryKey: getGetClaimQueryKey(legId) });
          if (invoiceGroupId != null) {
            qc.invalidateQueries({
              queryKey: getGetInvoiceGroupQueryKey(invoiceGroupId),
            });
          }
        },
        onError: (err: unknown) => {
          toast({
            title: "Could not mark as duplicate",
            description: String((err as Error).message),
            variant: "destructive",
          });
        },
      },
    );
  }

  return (
    <SiblingDuplicatePromptView
      isPending={markDuplicate.isPending}
      onClick={handleClick}
      primaryConfNumber={primaryConfNumber}
      primaryErrorTypeName={primaryErrorTypeName}
    />
  );
}
