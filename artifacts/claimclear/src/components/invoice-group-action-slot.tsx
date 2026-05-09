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
import { Archive, ShieldCheck } from "lucide-react";
import { InvoiceGroupSubmissionGauntlet } from "@/components/invoice-group-submission-gauntlet";
import { ReattestModal } from "@/components/whats-next/reattest-modal";
import { useClosureLauncher } from "@/components/closure/closure-launcher";
import {
  deriveInvoiceDisputeOutlook,
  canQueueOrCompleteReattest,
} from "@/lib/whats-next-derivation";
import { successToast } from "@/hooks/use-toast";

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
    // Audit-state-divergence guardrail (2026-05-08). The outlook
    // ladder above only inspects per-leg shape (survivors vs
    // dispute-eligible vs dropped) — it does not look at the invoice
    // macro phase. For invoices in `phase=triage / status ∈ {New}`
    // (and other pre-submit shapes), the leg shape can collapse to
    // `reattest_only` while the server's reattest gate still 409s
    // because the invoice has not been submitted to the payor yet.
    // Render the reason inline instead of an active CTA the operator
    // would just bounce off.
    //
    // Pass outlook so the helper takes the Early Re-attest branch
    // (Task #476) — without it the helper falls past the
    // outlook==="reattest_only" case and reports a stale
    // "not submitted yet" reason even though the server's
    // /reattest/queue endpoint explicitly accepts pre-submit phases
    // when the leg shape is reattest_only. See invoice-groups.ts
    // L4015-4023 and the matching branch in canQueueOrCompleteReattest.
    const eligibility = canQueueOrCompleteReattest(group, "reattest_only");
    if (!eligibility.ok) {
      return (
        <Card className={bare ? "border-0 shadow-none" : undefined}>
          <CardContent className="space-y-2 pt-6 text-sm text-muted-foreground">
            <div className="flex items-center gap-2 font-medium text-foreground">
              <ShieldCheck className="h-4 w-4" />
              Re-attestation not available yet
            </div>
            <p>{eligibility.reason}</p>
          </CardContent>
        </Card>
      );
    }
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

  // nothing_to_do — every leg is non-contestable / sibling-duplicate
  // with no survivors. There's no dispute to file and nothing to
  // re-attest, so the only forward motion is to close the invoice
  // out as Withdrawn (cannot_dispute). Render an explicit close-out
  // card explaining why so the operator isn't left staring at an
  // empty submission area.
  return (
    <NothingToDoCloseOut
      group={group}
      groupId={groupId}
      dropped={dropped}
      bare={bare}
    />
  );
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

  const survivorCount = survivors.length;
  const droppedCount = dropped.length;
  // Server-side bulk-queue / complete-reattest both 409 unless the
  // group is in `response-pending`+Needs Review or `mas-action-required`
  // — OR the leg shape is `reattest_only` from any non-terminal phase
  // (Early Re-attest, Task #476, invoice-groups.ts L4015-4023). This
  // component is only mounted via that exact dispatcher branch, so
  // we forward the literal so the helper takes the Early Re-attest
  // path instead of reporting a stale "not submitted yet" reason.
  const reattestEligibility = canQueueOrCompleteReattest(group, "reattest_only");

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
        {reattestEligibility.ok ? (
          <Button
            size="sm"
            onClick={() => setOpen(true)}
            data-testid="invoice-reattest-only-open"
          >
            <ShieldCheck className="h-3.5 w-3.5 mr-1" />
            Re-attest
          </Button>
        ) : (
          // Native title attribute keeps the explanation reachable on
          // hover without depending on Radix TooltipProvider being in
          // scope at every mount site.
          <Button
            size="sm"
            disabled
            title={reattestEligibility.reason}
            data-testid="invoice-reattest-only-blocked"
          >
            <ShieldCheck className="h-3.5 w-3.5 mr-1" />
            Re-attest
          </Button>
        )}
      </div>
      {!reattestEligibility.ok && (
        <p
          className="text-[11px] text-blue-900/70 italic pl-12"
          data-testid="invoice-reattest-only-blocked-reason"
        >
          {reattestEligibility.reason}
        </p>
      )}

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
          successToast({ title: "__VERB__", description: msg });
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

interface NothingToDoProps {
  group: InvoiceGroupDetailResponse;
  groupId: number;
  dropped: ClaimResponse[];
  bare?: boolean;
}

// Task #481 — explicit close-out affordance for the `nothing_to_do`
// outlook. Replaces the previous `return null`, which left operators
// staring at a blank submission area with no guidance about how to
// advance the invoice's lifecycle. The card explains why dispute
// steps don't apply and offers a single CTA that opens the standard
// structured closure intake (cannot_dispute → Withdrawn) — the same
// dialog/launcher the rail uses, so the resulting audit trail and
// query invalidations are identical no matter where the operator
// closed from. If the invoice has already been closed out we render
// a passive confirmation row instead of the button.
function NothingToDoCloseOut({
  group,
  groupId,
  dropped,
  bare,
}: NothingToDoProps) {
  const queryClient = useQueryClient();
  const { open: openClosure, dialog } = useClosureLauncher();
  const droppedCount = dropped.length;

  const alreadyClosed =
    !!group.outcome &&
    // vocab-allow-next-line — comparing against the API enum value, not a label.
    (group.outcome === "Withdrawn" || group.outcome === "Non-Issue");

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
      className="rounded-md border-2 border-amber-200 bg-amber-50/50 p-4 space-y-3"
      data-testid="invoice-nothing-to-do-closeout"
    >
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700">
          <Archive className="h-5 w-5" />
        </span>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-amber-900">
            Nothing left to dispute on this invoice.
          </h3>
          <p
            className="text-xs text-amber-900/80 mt-0.5"
            data-testid="invoice-nothing-to-do-summary"
          >
            {droppedCount > 0 ? (
              <>
                {droppedCount} leg{droppedCount === 1 ? "" : "s"} closed as
                non-contestable / sibling duplicate, with no survivors to
                re-attest.
              </>
            ) : (
              <>
                No legs remain to dispute or re-attest.
              </>
            )}{" "}
            Close the invoice out as Withdrawn so it stops sitting in your
            queue.
          </p>
        </div>
        {alreadyClosed ? (
          <span
            className="text-xs font-medium text-amber-900/80 px-2 py-1"
            data-testid="invoice-nothing-to-do-already-closed"
          >
            Closed · {group.outcome}
          </span>
        ) : (
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              openClosure({
                target: { kind: "group", id: groupId },
                reason: "cannot_dispute",
                onSuccess: invalidate,
              })
            }
            data-testid="invoice-nothing-to-do-close"
          >
            <Archive className="h-3.5 w-3.5 mr-1" />
            Mark as closed
          </Button>
        )}
      </div>
      {dialog}
    </div>
  );

  if (bare) return body;

  return (
    <Card>
      <CardContent className="pt-4">{body}</CardContent>
    </Card>
  );
}
