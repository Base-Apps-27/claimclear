import { Link } from "wouter";
import {
  useGetInvoiceGroup,
  useGetInvoiceGroupValidTransitions,
  useUpdateInvoiceGroupStatus,
  useUpdateInvoiceGroupOutcome,
  getGetInvoiceGroupQueryKey,
  getGetInvoiceGroupValidTransitionsQueryKey,
  getListInvoiceGroupsQueryKey,
  getListWithdrawalsQueryKey,
  getGetResponsesAwaitingReviewCountQueryKey,
} from "@workspace/api-client-react";
import type {
  InvoiceGroupResponse,
  PortalResponseItem,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency } from "@/lib/format";
import { formatDateTime } from "@/lib/format";
import {
  ArrowRight,
  ChevronRight,
  DollarSign,
  ExternalLink,
  Loader2,
  Mail,
  Bot,
  Send,
  CheckCircle,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { ClosureActions } from "@/components/closure/closure-actions";

/**
 * "Mark Paid" Resolution lane is gated behind an open product question
 * (see replit.md → "Open questions still on the table" → First-class
 * "Mark paid" action?). The lane is fully wired so flipping this constant
 * to `true` ships it without further code changes; until the user signs
 * off, the lane is hidden and operators handle "got paid offline" via the
 * existing manual outcome dropdown on the detail page (per task #162
 * Step 7: "If not approved, omit the Resolution lane entirely").
 */
const MARK_PAID_LANE_ENABLED = false;

function getErrorMessage(err: unknown): string | undefined {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (err && typeof err === "object" && "message" in err) {
    const m = (err as { message?: unknown }).message;
    if (typeof m === "string") return m;
  }
  return undefined;
}

// Response types that can land a group in the "Responses Awaiting Review"
// card. Acknowledgments are intentionally excluded — per replit.md they
// don't transition the group to Needs Review and don't need a verdict.
const REVIEWABLE_RESPONSE_TYPES = new Set([
  "approval",
  "denial",
  "partial_approval",
  "info_request",
  "other",
]);

const RESPONSE_TYPE_LABELS: Record<string, string> = {
  approval: "Approval",
  denial: "Denial",
  partial_approval: "Partial",
  info_request: "Info Request",
  other: "Other",
  acknowledgment: "Acknowledged",
};

const RESPONSE_TYPE_PILL_CLASSES: Record<string, string> = {
  approval: "bg-green-100 text-green-800 border-green-300",
  denial: "bg-red-100 text-red-800 border-red-300",
  partial_approval: "bg-amber-100 text-amber-800 border-amber-300",
  info_request: "bg-blue-100 text-blue-800 border-blue-300",
  other: "bg-slate-100 text-slate-700 border-slate-300",
  acknowledgment: "bg-slate-100 text-slate-700 border-slate-300",
};

export function getResponseTypeLabel(type: string | null | undefined): string {
  if (!type) return "Response";
  return RESPONSE_TYPE_LABELS[type] || RESPONSE_TYPE_LABELS.other;
}

export function getResponseTypePillClass(type: string | null | undefined): string {
  if (!type) return RESPONSE_TYPE_PILL_CLASSES.other;
  return RESPONSE_TYPE_PILL_CLASSES[type] || RESPONSE_TYPE_PILL_CLASSES.other;
}

/**
 * Pick the response that should drive the row-level summary. Picks the
 * most recent reviewable response (newest first; acknowledgments skipped
 * because they don't represent a verdict-pending state).
 */
export function pickLatestReviewableResponse(
  responses: PortalResponseItem[] | undefined,
): PortalResponseItem | null {
  if (!responses || responses.length === 0) return null;
  const sorted = [...responses].sort((a, b) => {
    const aTime = a.receivedAt ? new Date(a.receivedAt).getTime() : 0;
    const bTime = b.receivedAt ? new Date(b.receivedAt).getTime() : 0;
    return bTime - aTime;
  });
  return sorted.find((r) => REVIEWABLE_RESPONSE_TYPES.has(r.responseType)) ?? null;
}

interface QueueResponseReviewPanelProps {
  group: InvoiceGroupResponse;
  onCompleted: (message: string) => void;
}

/**
 * Inline review panel for the Responses Awaiting Review card. Surfaces the
 * latest payor response context plus three verdict lanes:
 *
 *  - Continuation: re-dispute / re-attest / submit new invoice. The lane
 *    is driven by `postResponseActions` from the group's validTransitions
 *    payload (so we only render actions the server says are legal). Per
 *    task spec, continuation actions must move the group FORWARD into a
 *    non-terminal workflow status — they must NOT auto-resolve to
 *    Resolved/Approved (that's the Resolution lane's job).
 *
 *    All three currently target status `Needs Evidence` because that is
 *    the only non-terminal status reachable from `Needs Review` via the
 *    public PATCH /invoice-groups/:id/status endpoint
 *    (`VALID_GROUP_STATUS_TRANSITIONS["Needs Review"]` =
 *     ["New", "Needs Evidence", "On Hold", "Resolved", "Denied"] — neither
 *     "Awaiting Response" nor "Portal Queued" are reachable from here).
 *    The action-specific intent (re-dispute vs. re-attest vs. new invoice
 *    number) is captured in the audit-log `reason` so operators can pick
 *    up the next concrete step on the detail page. Follow-up #185 tracks
 *    adding a real group-level POST /post-response-action endpoint that
 *    can route each verdict to its own canonical status/outcome pair
 *    (mirroring the claim-level handler).
 *
 *  - Resolution (Mark Paid): fully wired but hidden behind
 *    `MARK_PAID_LANE_ENABLED` while the open question in replit.md
 *    remains unresolved.
 *
 *  - Closure: Denied by Payor only — `Cannot Dispute` and `Non-Issue` are
 *    stage-1 verdicts and must not appear here (see replit.md "Design
 *    decision in flight").
 */
interface ContinuationActionDef {
  key: string;
  label: string;
  sub: string;
  icon: React.ReactNode;
  toneClass: string;
  targetStatus: string;
  reason: string;
}

export function QueueResponseReviewPanel({ group, onCompleted }: QueueResponseReviewPanelProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const updateStatus = useUpdateInvoiceGroupStatus();
  const updateOutcome = useUpdateInvoiceGroupOutcome();

  const { data: detail, isLoading: detailLoading } = useGetInvoiceGroup(group.id);
  const { data: validTransitions } = useGetInvoiceGroupValidTransitions(group.id);

  const latestResponse = pickLatestReviewableResponse(detail?.responses);
  const postResponseActions = (validTransitions?.postResponseActions || []) as string[];

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getListInvoiceGroupsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListWithdrawalsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetInvoiceGroupQueryKey(group.id) });
    queryClient.invalidateQueries({ queryKey: getGetInvoiceGroupValidTransitionsQueryKey(group.id) });
    // Sidebar nav badge driven by GET /responses/awaiting-review/count.
    // Every verdict here removes the row from the awaiting-review bucket
    // (status moves out of `Needs Review`), so refresh on action so the
    // badge doesn't lag the user's last click — the per-minute poll
    // would otherwise show a stale count for up to 60s.
    queryClient.invalidateQueries({ queryKey: getGetResponsesAwaitingReviewCountQueryKey() });
  };

  const continuationActions: ContinuationActionDef[] = [];

  if (postResponseActions.includes("re_dispute")) {
    continuationActions.push({
      key: "re_dispute",
      label: "Re-dispute",
      sub: "Gather more evidence and re-submit",
      icon: <Send className="h-4 w-4" />,
      toneClass: "bg-amber-50 hover:bg-amber-100 border-amber-300 text-amber-900",
      targetStatus: "Needs Evidence",
      reason: "Re-dispute with additional points — returned to evidence gathering after payor response",
    });
  }
  if (postResponseActions.includes("resolve_reattest")) {
    continuationActions.push({
      key: "resolve_reattest",
      label: "Re-attest",
      sub: "Capture re-attestation; keep the dispute moving",
      icon: <RefreshCw className="h-4 w-4" />,
      toneClass: "bg-blue-50 hover:bg-blue-100 border-blue-300 text-blue-900",
      targetStatus: "Needs Evidence",
      reason: "Resolve via re-attestation — returned to evidence gathering to attach re-attested documentation",
    });
  }
  if (postResponseActions.includes("resolve_new_invoice")) {
    continuationActions.push({
      key: "resolve_new_invoice",
      label: "Submit new invoice",
      sub: "Set up the new invoice # and re-submit",
      icon: <CheckCircle className="h-4 w-4" />,
      toneClass: "bg-indigo-50 hover:bg-indigo-100 border-indigo-300 text-indigo-900",
      targetStatus: "Needs Evidence",
      reason: "Resolve via new invoice number — returned to evidence gathering for re-issued invoice details",
    });
  }

  const handleContinuation = async (action: ContinuationActionDef) => {
    try {
      await updateStatus.mutateAsync({
        id: group.id,
        data: { status: action.targetStatus, reason: action.reason },
      });
      invalidate();
      onCompleted(`${action.label} — moved to ${action.targetStatus}`);
    } catch (err: unknown) {
      toast({
        title: `Couldn't apply "${action.label}"`,
        description: getErrorMessage(err) || "Action failed. Please refresh and try again.",
        variant: "destructive",
      });
    }
  };

  const handleMarkPaid = async () => {
    try {
      await updateOutcome.mutateAsync({
        id: group.id,
        data: { outcome: "Approved" },
      });
      invalidate();
      onCompleted(`#${group.invoiceNumber} marked paid`);
    } catch (err: unknown) {
      toast({
        title: "Couldn't mark paid",
        description: getErrorMessage(err) || "Outcome update failed. Please refresh and try again.",
        variant: "destructive",
      });
    }
  };

  const isPending = updateStatus.isPending || updateOutcome.isPending;

  const senderLabel = latestResponse
    ? latestResponse.senderName || latestResponse.senderEmail || (latestResponse.source === "portal" ? "MAS Portal" : "Payor")
    : null;

  // Trim the body preview to ~2 lines worth of text so the panel stays
  // compact; the "Open full response" link below jumps to the detail page
  // for the full thread (including HTML rendering and reassign tools).
  const bodyPreview = (() => {
    if (!latestResponse) return null;
    const raw = (latestResponse.content || latestResponse.rawContent || "").trim();
    if (!raw) return null;
    const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
    const first = lines.slice(0, 2).join(" ");
    if (first.length > 240) return first.slice(0, 237) + "…";
    return first;
  })();

  return (
    <Card data-testid={`queue-response-review-panel-${group.invoiceNumber}`}>
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-1 min-w-0">
            <CardTitle className="text-lg flex items-center gap-2">
              <span>Review payor response</span>
              <span className="font-mono text-sm text-muted-foreground">#{group.invoiceNumber}</span>
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              The AI hint is just a suggestion — you decide the verdict.
            </p>
          </div>
          <Link href={`/invoice-groups/${group.id}`}>
            <Button variant="ghost" size="sm">
              Full Details <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </Link>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-3 text-sm">
          <div>
            <div className="text-xs text-muted-foreground">Total</div>
            <div className="font-semibold">{formatCurrency(group.totalAmount)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Rides</div>
            <div className="font-semibold">{group.rideCount}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Error type</div>
            <div className="truncate" title={group.errorTypeName ?? "—"}>{group.errorTypeName || "—"}</div>
          </div>
        </div>

        <Separator />

        <div className="rounded-md border bg-muted/30 p-3 space-y-2" data-testid="response-context-block">
          {detailLoading && !latestResponse ? (
            <div className="space-y-2">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : latestResponse ? (
            <>
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2 text-sm">
                  {latestResponse.source === "email" ? (
                    <Mail className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <Bot className="h-4 w-4 text-muted-foreground" />
                  )}
                  <span className="font-medium">{senderLabel}</span>
                  <span className="text-xs text-muted-foreground">
                    · {formatDateTime(latestResponse.receivedAt)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-flex items-center rounded border px-2 py-0.5 text-xs font-semibold ${getResponseTypePillClass(latestResponse.responseType)}`}
                    title="AI / keyword classification — a hint, not the verdict"
                  >
                    AI hint: {getResponseTypeLabel(latestResponse.responseType)}
                    {latestResponse.classifierConfidence ? ` · ${latestResponse.classifierConfidence}` : ""}
                  </span>
                </div>
              </div>
              {latestResponse.aiSummary && (
                <div className="flex items-start gap-2 text-sm">
                  <Sparkles className="h-4 w-4 text-blue-600 mt-0.5 shrink-0" />
                  <p className="italic">{latestResponse.aiSummary}</p>
                </div>
              )}
              {bodyPreview && (
                <p className="text-sm text-muted-foreground whitespace-pre-wrap line-clamp-2">{bodyPreview}</p>
              )}
              <Link
                href={`/invoice-groups/${group.id}#response-${latestResponse.id}`}
                className="text-xs text-blue-700 hover:underline inline-flex items-center gap-1"
                data-testid="link-open-full-response"
              >
                Open full response <ExternalLink className="h-3 w-3" />
              </Link>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              No reviewable response found on this group. Open the full details to investigate.
            </p>
          )}
        </div>

        <div className="space-y-3" data-testid="verdict-lanes">
          <div className="text-xs uppercase font-semibold tracking-wide text-muted-foreground">
            What's the verdict?
          </div>

          <div className="space-y-2" data-testid="verdict-lane-continuation">
            <div className="text-xs font-semibold text-muted-foreground">
              Continuation — keep working the dispute
            </div>
            {continuationActions.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">
                No continuation actions available for this response type.
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {continuationActions.map((action) => (
                  <Button
                    key={action.key}
                    variant="outline"
                    className={`h-auto py-2 px-3 flex flex-col items-start gap-0.5 ${action.toneClass}`}
                    disabled={isPending}
                    onClick={() => handleContinuation(action)}
                    data-testid={`button-continuation-${action.key}`}
                  >
                    <span className="flex items-center gap-2 font-semibold text-sm">
                      {action.icon}
                      {action.label}
                    </span>
                    <span className="text-xs font-normal opacity-80 text-left">{action.sub}</span>
                  </Button>
                ))}
              </div>
            )}
          </div>

          {MARK_PAID_LANE_ENABLED && (
            <div className="space-y-2" data-testid="verdict-lane-resolution">
              <div className="text-xs font-semibold text-muted-foreground">
                Resolution — payor agreed and paid
              </div>
              <Button
                variant="outline"
                className="h-auto py-2 px-3 flex flex-col items-start gap-0.5 bg-green-50 hover:bg-green-100 border-green-300 text-green-900"
                disabled={isPending}
                onClick={handleMarkPaid}
                data-testid="button-resolution-mark-paid"
              >
                <span className="flex items-center gap-2 font-semibold text-sm">
                  <DollarSign className="h-4 w-4" />
                  Mark Paid
                </span>
                <span className="text-xs font-normal opacity-80 text-left">
                  Payor confirmed payment — close as Approved
                </span>
              </Button>
            </div>
          )}

          <div className="space-y-2" data-testid="verdict-lane-closure">
            <div className="text-xs font-semibold text-muted-foreground">
              Closure — payor formally denied
            </div>
            <ClosureActions
              target={{ kind: "invoice_group", id: group.id }}
              outcome={group.outcome}
              closureReason={group.closureReason}
              triggers={[
                {
                  reason: "denied_by_payor",
                  label: "Denied by Payor",
                  sub: "Payor formally denied — close out, no further dispute",
                  icon: <ArrowRight className="h-4 w-4" />,
                  testId: "button-closure-denied-by-payor",
                },
              ]}
              onAfterSuccess={() => {
                invalidate();
                onCompleted(`#${group.invoiceNumber} closed as Denied by Payor`);
              }}
            />
          </div>
        </div>

        {isPending && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            Applying verdict…
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Lightweight per-row enrichment: fetches the group's detail to surface
 * the latest response's type pill and AI summary inline. Falls back to a
 * skeleton while loading. Kept here so the queue page row renderer can
 * stay focused on layout instead of data fetching.
 */
export function ResponseReviewRowMeta({ groupId }: { groupId: number }) {
  const { data: detail, isLoading } = useGetInvoiceGroup(groupId);
  const latestResponse = pickLatestReviewableResponse(detail?.responses);

  if (isLoading && !detail) {
    return (
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-4 w-40" />
      </div>
    );
  }

  if (!latestResponse) {
    return (
      <span className="text-xs text-muted-foreground italic shrink-0">
        Response details unavailable
      </span>
    );
  }

  return (
    <div className="flex items-center gap-2 min-w-0 flex-1">
      <span
        className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap ${getResponseTypePillClass(latestResponse.responseType)}`}
        title="AI / keyword classification — a hint, not the verdict"
      >
        {getResponseTypeLabel(latestResponse.responseType)}
      </span>
      {latestResponse.aiSummary ? (
        <span className="text-xs text-muted-foreground truncate min-w-0" title={latestResponse.aiSummary}>
          {latestResponse.aiSummary}
        </span>
      ) : null}
    </div>
  );
}
