// "Ready to package" CTA rendered inside the queue right-side workflow
// panel (see `pages/queue.tsx`). The full version of this CTA lives on
// the invoice-group detail page (`invoice-group-detail-v2.tsx`); this
// is a compact, queue-shaped variant that shares the same backend
// readiness payload + endpoint.
//
// Why a subcomponent: the readiness payload is only on the *detail*
// response, not the list response that drives the queue tabs. Doing
// the fetch + mutation in a focused component keeps queue.tsx from
// growing another concern and lets the panel render a button-only
// fallback when the group is past pre-submit.

import { useQueryClient } from "@tanstack/react-query";
import {
  useGetInvoiceGroup,
  getGetInvoiceGroupQueryKey,
  usePackageInvoiceGroup,
} from "@workspace/api-client-react";
import type { InvoiceGroupDetailResponse } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ClipboardCheck, Loader2, Send } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface Props {
  groupId: number;
  /** Status from the list payload — used to skip rendering once the
   *  group has already moved past pre-submit. The detail fetch still
   *  refreshes the canonical status, but this avoids an unnecessary
   *  round-trip when the list already says we're done. */
  groupStatusFromList: string;
}

const PRE_SUBMIT_STATUSES = new Set(["New", "Needs Evidence"]);

export function QueueReadyToPackageCta({ groupId, groupStatusFromList }: Props) {
  const qc = useQueryClient();
  const { toast } = useToast();

  // Skip the detail fetch entirely when the list already shows we're
  // past pre-submit. Saves a request on the bulk of the queue.
  const enabled = PRE_SUBMIT_STATUSES.has(groupStatusFromList);

  const { data: group } = useGetInvoiceGroup(groupId, {
    query: { queryKey: getGetInvoiceGroupQueryKey(groupId), enabled },
  });

  const packageMutation = usePackageInvoiceGroup();

  if (!enabled) return null;

  const detail = group as InvoiceGroupDetailResponse | undefined;
  const readiness = detail?.packagingReadiness;

  // First-paint flicker guard: while the detail request is in flight
  // we render nothing. Showing a placeholder + then swapping it for
  // the real CTA was distracting in early manual testing.
  if (!readiness) return null;

  // Defensive: detail's status might have flipped since the list
  // payload (the projector ran in the background). Hide the CTA in
  // that case — the rest of the workflow surface takes over.
  if (detail && !PRE_SUBMIT_STATUSES.has(detail.status)) return null;

  function invalidateGroup() {
    qc.invalidateQueries({ queryKey: getGetInvoiceGroupQueryKey(groupId) });
    qc.invalidateQueries(); // refresh queue lists too
  }

  function onClickPackage() {
    packageMutation.mutate(
      { id: groupId },
      {
        onSuccess: () => {
          toast({
            title: "Invoice packaged",
            description: "Group moved to Generating Email — draft generation will pick up from here.",
          });
          invalidateGroup();
        },
        onError: (e: unknown) => {
          // Mirror the detail-page error handling: the 409 body holds
          // a fresh readiness payload, but we only need the reason
          // string for the toast — the refetched detail repaints
          // the disabled-tooltip from canonical state.
          let errorMsg = e instanceof Error ? e.message : String(e);
          if (e != null && typeof e === "object" && "response" in e) {
            const axiosErr = e as { response?: { data?: { error?: string } } };
            const resp = axiosErr.response?.data;
            if (resp?.error) errorMsg = resp.error;
          }
          toast({
            title: "Cannot package yet",
            description: errorMsg,
            variant: "destructive",
          });
          invalidateGroup();
        },
      },
    );
  }

  const button = (
    <Button
      size="sm"
      onClick={onClickPackage}
      disabled={!readiness.ready || packageMutation.isPending}
      data-testid="queue-ready-to-package-button"
    >
      {packageMutation.isPending ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
      ) : (
        <Send className="h-3.5 w-3.5 mr-1" />
      )}
      Ready to package
    </Button>
  );

  return (
    <div
      className="rounded-md border bg-muted/30 p-3 space-y-2"
      data-testid="queue-ready-to-package-card"
    >
      <div className="flex items-center gap-2 text-sm font-medium">
        <ClipboardCheck className="h-4 w-4" /> Ready to package
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <Badge variant="outline" data-testid="queue-readiness-count-processed">
          {readiness.processedLegCount} processed
        </Badge>
        <Badge variant="outline" data-testid="queue-readiness-count-unprocessed">
          {readiness.unprocessedLegCount} unprocessed
        </Badge>
        <Badge variant="outline" data-testid="queue-readiness-count-excluded">
          {readiness.excludedLegCount} excluded
        </Badge>
        <Badge variant="outline" data-testid="queue-readiness-count-held">
          {readiness.heldLegCount} on hold
        </Badge>
      </div>
      <p
        className={`text-xs ${readiness.ready ? "text-green-700" : "text-muted-foreground"}`}
        data-testid="queue-readiness-reason"
      >
        {readiness.ready
          ? "All worktree review complete."
          : readiness.reason}
      </p>
      {readiness.ready ? (
        button
      ) : (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span tabIndex={0} data-testid="queue-ready-to-package-disabled-wrapper">
                {button}
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" data-testid="queue-ready-to-package-disabled-tooltip">
              {readiness.reason}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </div>
  );
}
