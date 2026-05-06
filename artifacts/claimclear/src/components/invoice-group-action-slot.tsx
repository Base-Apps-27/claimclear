import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  usePromoteVerdictDrafts,
  getGetInvoiceGroupQueryKey,
  getGetInvoiceGroupValidTransitionsQueryKey,
  getListInvoiceGroupsQueryKey,
  getGetResponsesAwaitingReviewCountQueryKey,
} from "@workspace/api-client-react";
import type {
  ClaimResponse,
  InvoiceGroupDetailResponse,
} from "@workspace/api-client-react";
import { useAuth } from "@workspace/replit-auth-web";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ShieldCheck } from "lucide-react";
import { InvoiceGroupSubmissionGauntlet } from "@/components/invoice-group-submission-gauntlet";
import { ReattestModal } from "@/components/whats-next/reattest-modal";
import { deriveInvoiceDisputeOutlook } from "@/lib/whats-next-derivation";
import { useToast } from "@/hooks/use-toast";

// Task #476 — single shared gating component that decides, per
// invoice, whether to mount the dispute-submission gauntlet, the
// Re-attest CTA, or nothing. Every place that processes an invoice
// (Queue inline workspace, invoice detail page) routes through this
// component so the outlook is evaluated consistently in one place.
//
// When `outlook` is `reattest_only`, the entire dispute UI is hidden
// (no collapsed accordion, no "show dispute steps anyway" toggle) and
// a single Re-attest CTA takes its place. Clicking Re-attest opens the
// existing `ReattestModal` with the survivor / dropped partition the
// modal already understands — so the operator gets the exact same
// Re-attest now / Queue / Offline picker they'd see after a payor
// response, just surfaced earlier in the lifecycle.

interface Props {
  group: InvoiceGroupDetailResponse;
  groupId: number;
  /** Forwarded to the gauntlet's `gate: "legs"` jump-to-leg button. */
  onJumpToLeg?: (claimId: number) => void;
  /** Forwarded to the gauntlet — strips the Card chrome. */
  bare?: boolean;
}

export function InvoiceGroupActionSlot({
  group,
  groupId,
  onJumpToLeg,
  bare,
}: Props) {
  const rides: ClaimResponse[] = group.rides ?? [];
  const { outlook, survivors, dropped } = deriveInvoiceDisputeOutlook(
    group,
    rides,
  );

  if (outlook === "has_disputable") {
    return (
      <InvoiceGroupSubmissionGauntlet
        group={group}
        groupId={groupId}
        onJumpToLeg={onJumpToLeg}
        bare={bare}
      />
    );
  }

  if (outlook === "reattest_only") {
    return (
      <ReattestOnlyCta
        group={group}
        groupId={groupId}
        survivors={survivors}
        dropped={dropped}
        bare={bare}
      />
    );
  }

  // nothing_to_do — close-out path takes over.
  return null;
}

interface ReattestCtaProps {
  group: InvoiceGroupDetailResponse;
  groupId: number;
  survivors: ClaimResponse[];
  dropped: ClaimResponse[];
  bare?: boolean;
}

function ReattestOnlyCta({
  group,
  groupId,
  survivors,
  dropped,
  bare,
}: ReattestCtaProps) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const promoteDrafts = usePromoteVerdictDrafts();
  const { user } = useAuth();
  const { toast } = useToast();

  const survivorCount = survivors.length;
  const droppedCount = dropped.length;

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getListInvoiceGroupsQueryKey() });
    queryClient.invalidateQueries({
      queryKey: getGetInvoiceGroupQueryKey(groupId),
    });
    queryClient.invalidateQueries({
      queryKey: getGetInvoiceGroupValidTransitionsQueryKey(groupId),
    });
    queryClient.invalidateQueries({
      queryKey: getGetResponsesAwaitingReviewCountQueryKey(),
    });
  };

  const body = (
    <div
      className="rounded-md border-2 border-blue-200 bg-blue-50/50 p-4 space-y-3"
      data-testid="invoice-reattest-only-cta"
    >
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-700">
          <ShieldCheck className="h-5 w-5" />
        </span>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-blue-900">
            Ready to re-attest.
          </h3>
          <p
            className="text-xs text-blue-900/80 mt-0.5"
            data-testid="invoice-reattest-only-summary"
          >
            {survivorCount} leg{survivorCount === 1 ? "" : "s"} need
            re-attestation in the portal.
            {droppedCount > 0 ? (
              <>
                {" "}
                {droppedCount} non-contestable leg
                {droppedCount === 1 ? "" : "s"} will be cancelled.
              </>
            ) : null}
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => setOpen(true)}
          data-testid="invoice-reattest-only-open"
        >
          <ShieldCheck className="h-3.5 w-3.5 mr-1" />
          Re-attest
        </Button>
      </div>

      <ReattestModal
        open={open}
        onOpenChange={setOpen}
        group={group}
        approvedLegs={survivors}
        deniedLegs={dropped}
        canRecordOffline={user?.role === "admin"}
        promoteDrafts={async () => {
          // Mirrors the WhatsNextCard's contract: promote per-leg
          // drafts to operator_confirmed atomically before the modal
          // fires its downstream re-attest action.
          await promoteDrafts.mutateAsync({ id: groupId });
          queryClient.invalidateQueries({
            queryKey: getGetInvoiceGroupQueryKey(groupId),
          });
        }}
        onAfterAction={(msg) => {
          invalidate();
          toast({ title: "Re-attest", description: msg });
        }}
      />
    </div>
  );

  if (bare) return body;

  return (
    <Card>
      <CardContent className="pt-4">{body}</CardContent>
    </Card>
  );
}
