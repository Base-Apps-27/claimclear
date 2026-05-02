import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetInvoiceGroupQueryKey,
  getListInvoiceGroupsQueryKey,
  getGetResponsesAwaitingReviewCountQueryKey,
  getListWithdrawalsQueryKey,
  getGetInvoiceGroupValidTransitionsQueryKey,
  usePromoteVerdictDrafts,
} from "@workspace/api-client-react";
import type {
  ClaimResponse,
  InvoiceGroupResponse,
  PortalResponseItem,
} from "@workspace/api-client-react";
import { useClosureLauncher } from "@/components/closure/closure-launcher";
import { ActionRow } from "@/components/actions-rail";
import {
  deriveVerdictMix,
  pickSuggestedNewInvoiceNumber,
  pickSuggestedPayorDenialReason,
  isAwaitingPayorAgain,
  type VerdictDerivation,
} from "@/lib/whats-next-derivation";
import { Button } from "@/components/ui/button";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { ReattestModal } from "./reattest-modal";
import { AwaitingPayorAgainButton } from "./awaiting-payor-again-button";
import { NewInvoiceNumberBadge } from "./new-invoice-number-badge";

interface Props {
  group: InvoiceGroupResponse;
  rides: readonly ClaimResponse[];
  responses: readonly PortalResponseItem[];
  /**
   * True if the operator has sent at least one outbound reply on this
   * group's email thread. Gates the "I replied — wait for payor again"
   * button so it can't be clicked before any reply was actually sent.
   */
  hasOperatorReply: boolean;
  onAfterAction: (message: string) => void;
}

/**
 * The "Step 4" card on Responses Awaiting Review. The verdict picker
 * above writes drafts as the operator clicks; this card unlocks once
 * every actionable leg has a draft (or confirmed) selection on file
 * and surfaces the right Step 4 commit affordances based on the
 * resulting mix.
 *
 * Per Task #343 the offered actions are pinned to the two real states
 * the user described:
 *
 *   - **any leg Approved** (`all_approved` or `mixed`) → **Re-attest**
 *     modal (Attest now / Queue for attestation later). Closure is NOT
 *     offered here — the operator can still close out from the leg
 *     detail page if they need to, but the Step 4 card stays focused
 *     on the re-attest path.
 *
 *   - **all legs Denied** (`all_denied`) → **Close out (Denied by
 *     Payor)** trigger only. The payor-denial-reason picker is no
 *     longer rendered here — the closure intake dialog itself collects
 *     all the closure detail fields, and the Step 4 contract is "pick
 *     the next step", not "fill out a form".
 *
 *   - **no_verdicts_yet** → A muted nudge to make a selection on each
 *     leg first.
 *
 * Step 4 commit: every CTA on this card promotes the per-leg drafts to
 * `operator_confirmed` in one transaction *before* invoking the
 * downstream action (re-attest stamp / per-leg queue / closure
 * dialog), so the group only leaves `response-pending` once Step 4 is
 * actually committed.
 */
export function WhatsNextCard({ group, rides, responses, hasOperatorReply, onAfterAction }: Props) {
  const queryClient = useQueryClient();
  const promoteDrafts = usePromoteVerdictDrafts();
  const closureLauncher = useClosureLauncher();

  const derivation = useMemo<VerdictDerivation>(
    () => deriveVerdictMix(rides),
    [rides],
  );
  const newInvoiceNumber = useMemo(
    () => pickSuggestedNewInvoiceNumber(responses),
    [responses],
  );
  // Kept for the heads-up nudge in the no-verdicts-yet state — the
  // payor-denial-reason picker itself is no longer rendered here per
  // the Task #343 Step 4 contract (the closure intake dialog owns
  // that field).
  const _suggestedDenialReason = useMemo(
    () => pickSuggestedPayorDenialReason(responses),
    [responses],
  );
  void _suggestedDenialReason;

  const [reattestOpen, setReattestOpen] = useState(false);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getListInvoiceGroupsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListWithdrawalsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetInvoiceGroupQueryKey(group.id) });
    queryClient.invalidateQueries({
      queryKey: getGetInvoiceGroupValidTransitionsQueryKey(group.id),
    });
    queryClient.invalidateQueries({
      queryKey: getGetResponsesAwaitingReviewCountQueryKey(),
    });
  };

  const showReattest =
    derivation.mix === "all_approved" || derivation.mix === "mixed";
  const showCloseOut = derivation.mix === "all_denied";
  const showAwaitingPayorAgain = !isAwaitingPayorAgain(group);

  // Step 4 close-out commit. Open the closure intake dialog and hand
  // the launcher a `beforeSubmit` hook that promotes per-leg drafts to
  // operator_confirmed when (and ONLY when) the operator actually
  // submits the closure form. Critically:
  //
  //   • Opening the dialog does NOT promote drafts — a cancel-after-
  //     open must leave the group in `response-pending` so it stays
  //     in the Review queue.
  //
  //   • Promotion happens inside the closure dialog's submit handler,
  //     after the form is validated and the operator clicks Submit,
  //     but before the closure mutation runs. If promote fails, the
  //     closure mutation does NOT run and the dialog surfaces the
  //     error inline.
  //
  //   • If promote succeeds but the closure mutation later fails,
  //     drafts are now confirmed but the group hasn't transitioned
  //     out of `response-pending`. The promote endpoint is idempotent
  //     (no fresh drafts → no-op return) so the user's retry is safe;
  //     the backend ordering of "scan-then-phase-guard" makes this
  //     explicit.
  const openCloseOut = () => {
    closureLauncher.open({
      target: { kind: "group", id: group.id },
      reason: "denied_by_payor",
      beforeSubmit: async () => {
        await promoteDrafts.mutateAsync({ id: group.id });
        // Refetch so the closure mutation that follows sees the
        // post-promotion verdict state.
        queryClient.invalidateQueries({
          queryKey: getGetInvoiceGroupQueryKey(group.id),
        });
      },
      onSuccess: () => {
        invalidate();
        onAfterAction(`#${group.invoiceNumber} closed as Denied by Payor`);
      },
    });
  };

  return (
    <div
      className="rounded-md border bg-card overflow-hidden"
      data-testid="whats-next-card"
    >
      <div className="px-4 py-2.5 border-b bg-muted/30">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold">What's next?</h3>
            <p
              className="text-[11px] text-muted-foreground"
              data-testid="whats-next-mix-summary"
            >
              <VerdictMixSummary d={derivation} />
            </p>
          </div>
        </div>
        {newInvoiceNumber && (
          <div className="mt-2">
            <NewInvoiceNumberBadge invoiceNumber={newInvoiceNumber} />
          </div>
        )}
      </div>

      <div className="p-3 space-y-3">
        {derivation.mix === "no_verdicts_yet" && (
          <p
            className="text-xs text-muted-foreground italic"
            data-testid="whats-next-empty"
          >
            Record a verdict on each leg above first — next steps unlock
            once the verdicts are in.
          </p>
        )}

        {derivation.mix === "mixed" && !derivation.allLegsHaveVerdict && (
          <p
            className="text-xs text-muted-foreground italic"
            data-testid="whats-next-partial"
          >
            {derivation.pendingCount} leg
            {derivation.pendingCount === 1 ? "" : "s"} still need
            {derivation.pendingCount === 1 ? "s" : ""} a selection — make
            a pick on every leg above to unlock next steps.
          </p>
        )}

        {showReattest && derivation.allLegsHaveVerdict && (
          <div className="space-y-1.5" data-testid="whats-next-lane-reattest">
            <div className="text-[10px] uppercase font-semibold tracking-wide text-muted-foreground">
              {derivation.mix === "mixed"
                ? `Approved leg${derivation.approvedCount === 1 ? "" : "s"} (${derivation.approvedCount}) — re-attest in the portal`
                : "Re-attest in the payor portal"}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full h-auto py-2 px-3 flex flex-col items-start gap-0.5 bg-amber-50 hover:bg-amber-100 border-amber-300 text-amber-900"
              onClick={() => setReattestOpen(true)}
              data-testid="button-open-reattest"
            >
              <span className="flex items-center gap-2 font-semibold text-xs">
                <ShieldCheck className="h-3.5 w-3.5" />
                Re-attest
              </span>
              <span className="text-[11px] font-normal opacity-80 text-left">
                Walk through the portal steps now, or queue them for someone
                with portal access.
              </span>
            </Button>
          </div>
        )}

        {showCloseOut && (
          <div className="space-y-1.5" data-testid="whats-next-lane-closure">
            <div className="text-[10px] uppercase font-semibold tracking-wide text-muted-foreground">
              Closure — payor formally denied
            </div>
            <ActionRow
              icon={<ArrowRight className="h-3.5 w-3.5" />}
              label="Close out (Denied by Payor)"
              sub="Payor formally denied — close out, no further dispute"
              disabled={promoteDrafts.isPending}
              onClick={openCloseOut}
              testId="button-closure-denied-by-payor"
            />
          </div>
        )}

        {derivation.mix === "all_approved" && (
          <p
            className="text-[11px] text-muted-foreground italic"
            data-testid="whats-next-no-denial-needed"
          >
            No denied legs on this response — only the re-attest step
            remains.
          </p>
        )}

        {derivation.mix === "no_verdicts_yet" && newInvoiceNumber && (
          <p className="text-[11px] text-muted-foreground italic">
            Heads up: the payor cited a new invoice number above. Record
            the per-leg verdicts to surface the right next-step controls.
          </p>
        )}

        {showAwaitingPayorAgain && (
          <div className="pt-1">
            <AwaitingPayorAgainButton
              group={group}
              onAfterStamp={invalidate}
              hasOperatorReply={hasOperatorReply}
            />
            <p className="mt-1 text-[10px] text-muted-foreground text-center">
              {hasOperatorReply
                ? "Use this when you've already sent a reply and want this row to come back when the payor responds."
                : "Send a reply to the payor in the email thread above to unlock this."}
            </p>
          </div>
        )}
      </div>

      <ReattestModal
        open={reattestOpen}
        onOpenChange={setReattestOpen}
        group={group}
        approvedLegs={derivation.approvedLegs}
        deniedLegs={derivation.deniedLegs}
        promoteDrafts={async () => {
          // Re-attest (Attest now / Queue for later) commits Step 4 by
          // first promoting every draft on the group to
          // `operator_confirmed`, then running the existing
          // re-attest/queue path. The modal awaits this hook before
          // either tab's submit so promotion and the downstream action
          // succeed or fail together.
          await promoteDrafts.mutateAsync({ id: group.id });
          queryClient.invalidateQueries({
            queryKey: getGetInvoiceGroupQueryKey(group.id),
          });
        }}
        onAfterAction={(msg) => {
          invalidate();
          onAfterAction(msg);
        }}
      />

      {closureLauncher.dialog}
    </div>
  );
}

function VerdictMixSummary({ d }: { d: VerdictDerivation }) {
  if (d.total === 0) return <>No actionable legs on this response.</>;
  if (d.mix === "no_verdicts_yet") {
    return (
      <>
        {d.total} leg{d.total === 1 ? "" : "s"} awaiting a selection — make a
        pick above to unlock the next step.
      </>
    );
  }
  if (d.mix === "all_approved") {
    return (
      <>
        All {d.total} leg{d.total === 1 ? "" : "s"} approved — only the
        re-attest step remains.
      </>
    );
  }
  if (d.mix === "all_denied") {
    return (
      <>
        All {d.total} leg{d.total === 1 ? "" : "s"} denied — close out as
        Denied by Payor when ready.
      </>
    );
  }
  return (
    <>
      {d.approvedCount} approved · {d.deniedCount} denied
      {d.pendingCount > 0 ? ` · ${d.pendingCount} still pending` : ""}.
    </>
  );
}
