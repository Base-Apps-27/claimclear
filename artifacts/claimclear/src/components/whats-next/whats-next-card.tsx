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
import { useClosureConfirmLauncher } from "@/components/closure/closure-launcher";
import {
  pickLatestReviewableResponse,
  getResponseTypeLabel,
} from "@/components/queue-response-review-panel";
import {
  deriveVerdictMix,
  pickSuggestedNewInvoiceNumber,
  pickSuggestedNewInvoiceNumberWithSource,
  pickSuggestedPayorDenialReason,
  isAwaitingPayorAgain,
  type VerdictDerivation,
} from "@/lib/whats-next-derivation";
import { Button } from "@/components/ui/button";
import {
  ShieldCheck,
  Send,
  XCircle,
  CheckCircle2,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ReattestModal } from "./reattest-modal";
import { useMarkAwaitingPayorAgain } from "@workspace/api-client-react";
import { useAuth } from "@workspace/replit-auth-web";
import { useToast, successToast } from "@/hooks/use-toast";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { NewInvoiceNumberBadge } from "./new-invoice-number-badge";

interface Props {
  group: InvoiceGroupResponse;
  rides: readonly ClaimResponse[];
  responses: readonly PortalResponseItem[];
  /**
   * True if the operator has sent at least one outbound reply on this
   * group's email thread. Gates the "Reply — wait for payor again"
   * option so it can't be picked before any reply was actually sent.
   */
  hasOperatorReply: boolean;
  onAfterAction: (message: string) => void;
}

/**
 * Step 4 — the **conclusion** of the response-review flow. Once every
 * actionable leg has a verdict on file the card visibly "wakes up" and
 * presents the operator's three real choices as a single, sibling list:
 *
 *   • **Re-attest** — applies whenever any leg was approved. Opens the
 *     Re-attest modal which itself asks "now or queue for later?".
 *   • **Reply — wait for payor again** — applies whenever the row hasn't
 *     already been stamped as awaiting payor. Disabled until the
 *     operator has actually sent an outbound reply on the email thread.
 *   • **Close out (Denied by Payor)** — applies whenever every leg was
 *     denied. Opens the closure intake dialog.
 *
 * These three options are presented as identically-styled "OptionRow"
 * buttons so the visual hierarchy reads "pick one of these" rather
 * than the previous mishmash of a yellow box, a small text-style link,
 * and a footer button.
 *
 * Step 4 commit semantics are unchanged from prior tasks: every CTA on
 * this card promotes the per-leg drafts to `operator_confirmed` in one
 * transaction *before* invoking the downstream action (re-attest stamp
 * / per-leg queue / closure dialog), so the group only leaves
 * `response-pending` once Step 4 is actually committed.
 */
export function WhatsNextCard({
  group,
  rides,
  responses,
  hasOperatorReply,
  onAfterAction,
}: Props) {
  const queryClient = useQueryClient();
  const promoteDrafts = usePromoteVerdictDrafts();
  // Light "confirm" launcher: Step 4 close-out is the per-claim group's
  // recording of a payor-driven denial. The full structured intake
  // doesn't apply (they decided, not us); the payor response is the
  // record. The confirm dialog auto-fills every required server-side
  // field and still runs the same `beforeSubmit` (promote-drafts) hook
  // so close-out and draft promotion stay in one operator gesture.
  const closureConfirm = useClosureConfirmLauncher();
  const markWaiting = useMarkAwaitingPayorAgain();
  const { toast } = useToast();
  const { user } = useAuth();

  const derivation = useMemo<VerdictDerivation>(
    () => deriveVerdictMix(rides),
    [rides],
  );
  // Task #455 — once the operator commits the rename through the
  // Re-attest flow, `group.invoiceNumber` holds the new value. The
  // raw `pickSuggestedNewInvoiceNumber` would still echo the same
  // string off the response metadata, so the badge would never
  // disappear. Filter out a suggestion that already matches the
  // current invoice # so it stops showing once consumed.
  const newInvoiceNumber = useMemo(() => {
    const v = pickSuggestedNewInvoiceNumber(responses);
    if (!v) return null;
    if (v === group.invoiceNumber) return null;
    return v;
  }, [responses, group.invoiceNumber]);
  // Same consumption logic for the modal pre-fill: a suggestion that
  // matches the current invoice # is already applied — don't re-prompt.
  const newInvoiceSuggestion = useMemo(() => {
    const s = pickSuggestedNewInvoiceNumberWithSource(responses);
    if (!s) return null;
    if (s.invoiceNumber === group.invoiceNumber) return null;
    return s;
  }, [responses, group.invoiceNumber]);
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
    const latestResponse = pickLatestReviewableResponse([...responses]);
    closureConfirm.open({
      target: { kind: "group", id: group.id },
      response: latestResponse
        ? {
            responseId: latestResponse.id,
            source: latestResponse.source,
            senderName: latestResponse.senderName,
            senderEmail: latestResponse.senderEmail,
            receivedAt: latestResponse.receivedAt,
            responseType: latestResponse.responseType,
            responseTypeLabel: getResponseTypeLabel(latestResponse.responseType),
            aiSummary: latestResponse.aiSummary,
          }
        : null,
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

  const handleAwaitingPayorAgain = async () => {
    try {
      await markWaiting.mutateAsync({ id: group.id, data: {} });
      invalidate();
      successToast({
        title: "__VERB__",
        description: "Awaiting payor — we'll bring this back when the payor responds.",
      });
      onAfterAction(`#${group.invoiceNumber} marked awaiting payor again.`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Could not stamp.";
      toast({
        title: "Couldn't update",
        description: msg,
        variant: "destructive",
      });
    }
  };

  // The card only enters its "decision time" visual state once every
  // actionable leg has a verdict on file. Before that we render a quiet
  // placeholder so the operator's eye isn't pulled here prematurely.
  const decisionReady =
    derivation.allLegsHaveVerdict &&
    (showReattest || showCloseOut || showAwaitingPayorAgain);

  return (
    <div
      className={cn(
        // Task #495 — broaden the "wake-up" transition past colour so the
        // border, ring, and shadow all crossfade together. `transition-all`
        // covers shadow + ring; `motion-reduce:transition-none` honours
        // operators with reduced-motion preferences (the swap is still
        // instantaneous, just unanimated).
        "rounded-md border overflow-hidden bg-card transition-all duration-300 ease-out motion-reduce:transition-none",
        decisionReady
          ? "border-blue-300 shadow-sm ring-1 ring-blue-200"
          : "border-border ring-0 ring-blue-200/0 shadow-none",
      )}
      data-testid="whats-next-card"
      data-decision-ready={decisionReady ? "true" : "false"}
    >
      {/*
        Task #495 — the gradient header used to swap between
        `bg-muted/30` and `bg-gradient-to-r from-blue-50 to-indigo-50`
        via class-name change, which CSS cannot interpolate (gradients
        and named colours don't crossfade). Layer the gradient as an
        absolutely-positioned overlay and animate its opacity instead so
        the wake-up reads as a smooth fade rather than a flash.
      */}
      <div className="relative px-4 py-3 border-b border-border">
        <div
          aria-hidden
          className={cn(
            "absolute inset-0 bg-muted/30 transition-opacity duration-300 ease-out motion-reduce:transition-none",
            decisionReady ? "opacity-0" : "opacity-100",
          )}
        />
        <div
          aria-hidden
          className={cn(
            "absolute inset-0 bg-gradient-to-r from-blue-50 to-indigo-50 transition-opacity duration-300 ease-out motion-reduce:transition-none",
            decisionReady ? "opacity-100" : "opacity-0",
          )}
        />
        <div
          aria-hidden
          className={cn(
            "absolute inset-x-0 bottom-0 h-px bg-blue-200 transition-opacity duration-300 ease-out motion-reduce:transition-none",
            decisionReady ? "opacity-100" : "opacity-0",
          )}
        />
        <div className="relative">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              {decisionReady && (
                <CheckCircle2 className="h-4 w-4 text-blue-700 flex-shrink-0" />
              )}
              <h3
                className={cn(
                  "text-sm font-semibold truncate",
                  decisionReady ? "text-blue-900" : "",
                )}
              >
                {decisionReady
                  ? "How do you want to move forward?"
                  : "What's next?"}
              </h3>
            </div>
            <p
              className={cn(
                "text-[11px] mt-0.5",
                decisionReady ? "text-blue-900/80" : "text-muted-foreground",
              )}
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
      </div>

      <div className="p-3 space-y-2">
        {derivation.mix === "no_verdicts_yet" && (
          <p
            className="text-xs text-muted-foreground italic"
            data-testid="whats-next-empty"
          >
            Record a verdict on each leg above first — your options here
            unlock once the verdicts are in.
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
            a pick on every leg above to unlock your options.
          </p>
        )}

        {decisionReady && (
          <>
            {showReattest && (
              <OptionRow
                tone="amber"
                icon={<ShieldCheck className="h-4 w-4" />}
                title="Re-attest"
                description={
                  derivation.mix === "mixed"
                    ? `${derivation.approvedCount} approved leg${derivation.approvedCount === 1 ? "" : "s"} need re-attestation in the portal.`
                    : "Re-attest the corrected info in the payor portal."
                }
                onClick={() => setReattestOpen(true)}
                testId="button-open-reattest"
              />
            )}

            {showCloseOut && (
              <OptionRow
                tone="rose"
                icon={<XCircle className="h-4 w-4" />}
                title="Cancel altogether"
                description="Payor formally denied — close this out as Denied by Payor."
                onClick={openCloseOut}
                disabled={promoteDrafts.isPending}
                testId="button-closure-denied-by-payor"
              />
            )}

            {showAwaitingPayorAgain && (
              <ReplyOptionRow
                hasOperatorReply={hasOperatorReply}
                onClick={handleAwaitingPayorAgain}
                disabled={markWaiting.isPending}
              />
            )}
          </>
        )}

        {derivation.mix === "no_verdicts_yet" && newInvoiceNumber && (
          <p className="text-[11px] text-muted-foreground italic">
            Heads up: the payor cited a new invoice number above. Record
            the per-leg verdicts to surface the right next-step controls.
          </p>
        )}
      </div>

      <ReattestModal
        open={reattestOpen}
        onOpenChange={setReattestOpen}
        group={group}
        approvedLegs={derivation.approvedLegs}
        deniedLegs={derivation.deniedLegs}
        canRecordOffline={user?.role === "admin"}
        suggestedNewInvoiceNumber={newInvoiceSuggestion?.invoiceNumber ?? null}
        suggestedNewInvoiceNumberSourceResponseId={
          newInvoiceSuggestion?.sourceResponseId ?? null
        }
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

      {closureConfirm.dialog}
    </div>
  );
}

/**
 * Shared visual atom for the three Step-4 options. All three render
 * the same shape so the card reads as a single "pick one" list. The
 * `tone` prop tints the leading icon and hover state, but every row is
 * the same height, padding, and typography.
 */
interface OptionRowProps {
  tone: "amber" | "blue" | "rose";
  icon: React.ReactNode;
  title: string;
  description: string;
  onClick: () => void;
  disabled?: boolean;
  testId?: string;
}

function OptionRow({
  tone,
  icon,
  title,
  description,
  onClick,
  disabled,
  testId,
}: OptionRowProps) {
  const toneClasses = {
    amber:
      "border-amber-300 hover:bg-amber-50 [&_[data-icon-bg]]:bg-amber-100 [&_[data-icon-bg]]:text-amber-700",
    blue:
      "border-blue-300 hover:bg-blue-50 [&_[data-icon-bg]]:bg-blue-100 [&_[data-icon-bg]]:text-blue-700",
    rose:
      "border-rose-300 hover:bg-rose-50 [&_[data-icon-bg]]:bg-rose-100 [&_[data-icon-bg]]:text-rose-700",
  }[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "w-full flex items-center gap-3 rounded-md border bg-card px-3 py-2.5 text-left transition-colors",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        toneClasses,
      )}
      data-testid={testId}
    >
      <span
        data-icon-bg
        className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full"
      >
        {icon}
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-semibold">{title}</span>
        <span className="block text-[11px] text-muted-foreground leading-snug">
          {description}
        </span>
      </span>
      <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
    </button>
  );
}

/**
 * The Reply option carries an extra gate (operator must have actually
 * sent an outbound reply on the thread) plus a tooltip explaining the
 * gate, so it gets its own thin wrapper around `OptionRow` rather than
 * a fourth disabled-state branch on every caller.
 */
function ReplyOptionRow({
  hasOperatorReply,
  onClick,
  disabled,
}: {
  hasOperatorReply: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  const row = (
    <OptionRow
      tone="blue"
      icon={<Send className="h-4 w-4" />}
      title="I replied — wait for payor"
      description={
        hasOperatorReply
          ? "Drop this off the queue until the payor replies again."
          : "Send a reply on the email thread above to unlock this."
      }
      onClick={onClick}
      disabled={disabled || !hasOperatorReply}
      testId="button-awaiting-payor-again"
    />
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
        All {d.total} leg{d.total === 1 ? "" : "s"} approved — pick how to
        wrap up.
      </>
    );
  }
  if (d.mix === "all_denied") {
    return (
      <>
        All {d.total} leg{d.total === 1 ? "" : "s"} denied — pick how to
        wrap up.
      </>
    );
  }
  return (
    <>
      {d.approvedCount} approved · {d.deniedCount} denied
      {d.pendingCount > 0 ? ` · ${d.pendingCount} still pending` : " — pick how to wrap up."}
    </>
  );
}
