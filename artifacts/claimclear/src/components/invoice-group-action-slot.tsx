import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  usePromoteVerdictDrafts,
  useSopRestartLeg,
  useUnmarkLegDuplicate,
  getGetInvoiceGroupQueryKey,
  getGetInvoiceGroupValidTransitionsQueryKey,
  getListInvoiceGroupsQueryKey,
  getGetResponsesAwaitingReviewCountQueryKey,
  getGetClaimQueryKey,
} from "@workspace/api-client-react";
import type {
  ClaimResponse,
  InvoiceGroupDetailResponse,
} from "@workspace/api-client-react";
import { useAuth } from "@workspace/replit-auth-web";
import { HideForClerk } from "@/lib/role";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Archive, Loader2, ShieldCheck, Undo2 } from "lucide-react";
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
  /** Task #685 (R3) — forwarded to the gauntlet's per-leg overflow
   *  "Reclassify…" item. Parent (queue mini) opens A's ClassifyDialog
   *  scoped to the chosen leg. */
  onReclassifyLeg?: (claimId: number) => void;
  /** Forwarded to the gauntlet — strips the Card chrome. */
  bare?: boolean;
}

export function InvoiceGroupActionSlot({
  group,
  groupId,
  onJumpToLeg,
  onReclassifyLeg,
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
        onReclassifyLeg={onReclassifyLeg}
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
        onJumpToLeg={onJumpToLeg}
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
  /** Back-out affordance: jumps the queue workspace back to a leg tab
   *  so the operator can use the existing per-leg "Reopen walk" /
   *  "Clear recorded verdict" UX if they landed here by mistake. */
  onJumpToLeg?: (claimId: number) => void;
}

function ReattestOnlyCta({
  group,
  groupId,
  survivors,
  dropped,
  bare,
  onJumpToLeg,
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

      {/* Back-out affordance — every terminal needs an exit. The hero
          itself can't undo a verdict (that lives on the leg), so the
          honest move is to send the operator back to a leg tab where
          the existing "Reopen walk" / "Clear recorded verdict" UX is
          already wired. Picks the first survivor (the legs that drove
          the re-attest state); falls back to a dropped leg so the
          button is never dead. */}
      {onJumpToLeg && (survivors.length > 0 || dropped.length > 0) && (
        <div className="pl-12">
          <Button
            size="sm"
            variant="outline"
            className="h-8 px-3 text-xs bg-white border-blue-300 text-blue-800 hover:bg-blue-100 hover:text-blue-900"
            onClick={() => {
              const target = survivors[0] ?? dropped[0];
              if (target) onJumpToLeg(target.id);
            }}
            data-testid="invoice-reattest-only-reopen-leg"
            title="Go back to a leg to fix a verdict, classification, or evidence before re-attesting"
          >
            <Undo2 className="h-3.5 w-3.5 mr-1" />
            Reopen a leg
          </Button>
        </div>
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

  // Task #714 — `"No Action Needed"` is the system-asserted Non-Issue
  // variant. A group at (Resolved, No Action Needed) is closed by the
  // auto-cascade and the operator has nothing left to do here.
  // Each comparison is against an API enum value, not a UI label,
  // hence the per-line vocab-allow markers.
  const alreadyClosed =
    !!group.outcome &&
    // vocab-allow-next-line — API enum value, not a label.
    (group.outcome === "Withdrawn" ||
      // vocab-allow-next-line — API enum value, not a label.
      group.outcome === "Non-Issue" ||
      // vocab-allow-next-line — API enum value, not a label.
      group.outcome === "No Action Needed");

  // Task #689 — Reopen path. Until now this card was an unconditional
  // dead-end: the only forward CTA was "Mark as closed" and there was
  // no way to back out a leg the operator had wrongly marked as
  // sibling-duplicate or wrongly walked into a non-contestable
  // terminal. The per-leg LegTerminalRewindFooter we shipped in #687
  // never reaches this view because the workspace collapses straight
  // to "closeout" when outlook === "nothing_to_do" and the SOP player
  // is unmounted. So we surface the same back-out here, scoped to the
  // legs that pushed the invoice into nothing-to-do (the `dropped`
  // list). Each dropped leg is reopened with the correct API:
  //   • duplicateOfClaimId set → DELETE /claims/:id/duplicate-of
  //   • sopOutcome set         → POST /claims/:id/sop-restart
  // After all undo calls settle we invalidate the group so the card
  // recomputes its outlook and the operator falls back into the SOP
  // player automatically.
  const sopRestartLeg = useSopRestartLeg();
  const unmarkDuplicate = useUnmarkLegDuplicate();
  const [reopenOpen, setReopenOpen] = useState(false);
  const [reopenPending, setReopenPending] = useState(false);

  const reopenable = dropped.filter(
    (r) => r.duplicateOfClaimId != null || r.sopOutcome != null,
  );
  const reopenCount = reopenable.length;

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

  async function onReopen() {
    if (reopenPending || reopenCount === 0) return;
    setReopenPending(true);
    try {
      const ops: Promise<unknown>[] = [];
      for (const r of reopenable) {
        if (r.duplicateOfClaimId != null) {
          ops.push(
            unmarkDuplicate.mutateAsync({ id: r.id }).catch(() => undefined),
          );
        } else if (r.sopOutcome != null) {
          ops.push(
            sopRestartLeg
              .mutateAsync({ id: r.id, data: {} })
              .catch(() => undefined),
          );
        }
      }
      await Promise.all(ops);
      invalidate();
      for (const r of reopenable) {
        queryClient.invalidateQueries({ queryKey: getGetClaimQueryKey(r.id) });
      }
      successToast({
        title:
          reopenCount === 1
            ? "Leg reopened"
            : `${reopenCount} legs reopened`,
        description:
          "The terminal state was undone. You can re-walk the SOP from the workspace.",
      });
      setReopenOpen(false);
    } finally {
      setReopenPending(false);
    }
  }

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
          <HideForClerk>
            <div className="flex items-center gap-2">
              {reopenCount > 0 && (
              <Button
                size="sm"
                variant="ghost"
                className="text-amber-900 hover:bg-amber-100/60"
                onClick={() => setReopenOpen(true)}
                disabled={reopenPending}
                data-testid="invoice-nothing-to-do-reopen"
                title={
                  reopenCount === 1
                    ? "Undo this leg's terminal state and return it to the SOP walk"
                    : `Undo all ${reopenCount} legs' terminal states and return them to the SOP walk`
                }
              >
                {reopenPending ? (
                  <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                ) : (
                  <Undo2 className="h-3.5 w-3.5 mr-1" />
                )}
                {reopenCount === 1 ? "Reopen leg" : `Reopen ${reopenCount} legs`}
              </Button>
            )}
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
            </div>
          </HideForClerk>
        )}
      </div>
      {dialog}
      <AlertDialog
        open={reopenOpen}
        onOpenChange={(next) => !reopenPending && setReopenOpen(next)}
      >
        <AlertDialogContent data-testid="invoice-nothing-to-do-reopen-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {reopenCount === 1
                ? "Reopen this leg?"
                : `Reopen ${reopenCount} legs?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {reopenCount === 1
                ? "This undoes the leg's terminal state — sibling-duplicate marks are cleared and SOP outcomes are reset — and drops you back into the SOP walk so you can re-decide."
                : `This undoes the terminal state on all ${reopenCount} legs that pushed this invoice into "nothing to do." Sibling-duplicate marks are cleared and SOP outcomes are reset, then you'll land back in the SOP walk to re-decide.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={reopenPending}>
              Keep as-is
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void onReopen();
              }}
              disabled={reopenPending}
              data-testid="invoice-nothing-to-do-reopen-confirm"
            >
              {reopenPending ? (
                <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
              ) : (
                <Undo2 className="h-3.5 w-3.5 mr-1" />
              )}
              {reopenCount === 1 ? "Reopen leg" : `Reopen ${reopenCount} legs`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );

  if (bare) return body;

  return (
    <Card>
      <CardContent className="pt-4">{body}</CardContent>
    </Card>
  );
}
