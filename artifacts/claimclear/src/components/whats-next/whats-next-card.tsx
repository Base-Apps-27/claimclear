import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetInvoiceGroupQueryKey,
  getListInvoiceGroupsQueryKey,
  getGetResponsesAwaitingReviewCountQueryKey,
  getListWithdrawalsQueryKey,
  getGetInvoiceGroupValidTransitionsQueryKey,
} from "@workspace/api-client-react";
import type {
  ClaimResponse,
  InvoiceGroupResponse,
  PortalResponseItem,
} from "@workspace/api-client-react";
import { ClosureActions } from "@/components/closure/closure-actions";
import {
  deriveVerdictMix,
  pickSuggestedNewInvoiceNumber,
  pickSuggestedPayorDenialReason,
  isAwaitingPayorAgain,
  type VerdictDerivation,
} from "@/lib/whats-next-derivation";
import { Button } from "@/components/ui/button";
import { ArrowRight, RefreshCw, ShieldCheck } from "lucide-react";
import { ReattestModal } from "./reattest-modal";
import { PayorDenialReasonPicker } from "./payor-denial-reason-picker";
import { AwaitingPayorAgainButton } from "./awaiting-payor-again-button";
import { NewInvoiceNumberBadge } from "./new-invoice-number-badge";

interface Props {
  group: InvoiceGroupResponse;
  rides: readonly ClaimResponse[];
  responses: readonly PortalResponseItem[];
  onAfterAction: (message: string) => void;
}

/**
 * The verdict-derived "What's next?" card on Responses Awaiting Review
 * (Task #322). Replaces the legacy `postResponseActions` lane that
 * routed every continuation choice through "Needs Evidence".
 *
 * Affordances are derived from the per-leg verdict mix:
 *
 *   - **all_approved** → Re-attest CTA (modal w/ two tabs) +
 *     "I replied — wait for payor again" button.
 *
 *   - **all_denied** → Payor-denial-reason picker + Closure (Denied
 *     by payor) + "I replied — wait for payor again" button.
 *
 *   - **mixed** → Both flows side-by-side. Re-attest covers the
 *     approved legs; the denial-reason picker + closure covers the
 *     denied legs. Closure is gated on every leg having a verdict —
 *     until then we surface a hint instead.
 *
 *   - **no_verdicts_yet** → A muted nudge to record a verdict first.
 *     The CTAs only render once at least one operator-confirmed
 *     verdict is on file so the operator never gets a misleading
 *     "next step" while the rail above still has work to do.
 *
 * Closure remains a separate, explicit terminal step — never folded
 * into the re-attest flow — to keep the audit trail clean.
 */
export function WhatsNextCard({ group, rides, responses, onAfterAction }: Props) {
  const queryClient = useQueryClient();

  const derivation = useMemo<VerdictDerivation>(
    () => deriveVerdictMix(rides),
    [rides],
  );
  const newInvoiceNumber = useMemo(
    () => pickSuggestedNewInvoiceNumber(responses),
    [responses],
  );
  const suggestedDenialReason = useMemo(
    () => pickSuggestedPayorDenialReason(responses),
    [responses],
  );

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
  const showDenialFlow =
    derivation.mix === "all_denied" || derivation.mix === "mixed";
  const closureGateOpen = derivation.allLegsHaveVerdict;
  const showAwaitingPayorAgain =
    derivation.mix !== "no_verdicts_yet" && !isAwaitingPayorAgain(group);

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

        {showReattest && (
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

        {showDenialFlow && (
          <>
            <PayorDenialReasonPicker
              group={group}
              suggestedCode={suggestedDenialReason}
              onAfterSave={invalidate}
            />

            <div className="space-y-1.5" data-testid="whats-next-lane-closure">
              <div className="text-[10px] uppercase font-semibold tracking-wide text-muted-foreground">
                Closure — payor formally denied
              </div>
              {!closureGateOpen ? (
                <p
                  className="text-[11px] text-muted-foreground italic"
                  data-testid="whats-next-closure-gated"
                >
                  Record a verdict on every leg before closing — keeps the
                  closure decision auditable.
                </p>
              ) : (
                <ClosureActions
                  target={{ kind: "invoice_group", id: group.id }}
                  outcome={group.outcome}
                  closureReason={group.closureReason}
                  triggers={[
                    {
                      reason: "denied_by_payor",
                      label: "Denied by Payor",
                      sub: "Payor formally denied — close out, no further dispute",
                      icon: <ArrowRight className="h-3.5 w-3.5" />,
                      testId: "button-closure-denied-by-payor",
                    },
                  ]}
                  onAfterSuccess={() => {
                    invalidate();
                    onAfterAction(
                      `#${group.invoiceNumber} closed as Denied by Payor`,
                    );
                  }}
                />
              )}
            </div>
          </>
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
            <AwaitingPayorAgainButton group={group} onAfterStamp={invalidate} />
            <p className="mt-1 text-[10px] text-muted-foreground text-center">
              Use this when you've already sent a reply and want this row to
              come back when the payor responds.
            </p>
          </div>
        )}
      </div>

      <ReattestModal
        open={reattestOpen}
        onOpenChange={setReattestOpen}
        group={group}
        approvedLegs={derivation.approvedLegs}
        onAfterAction={(msg) => {
          invalidate();
          onAfterAction(msg);
        }}
      />
    </div>
  );
}

function VerdictMixSummary({ d }: { d: VerdictDerivation }) {
  if (d.total === 0) return <>No actionable legs on this response.</>;
  if (d.mix === "no_verdicts_yet") {
    return (
      <>
        {d.total} leg{d.total === 1 ? "" : "s"} awaiting a verdict — record
        them above first.
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
        All {d.total} leg{d.total === 1 ? "" : "s"} denied — capture the
        payor's reason, then close out or push back.
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
