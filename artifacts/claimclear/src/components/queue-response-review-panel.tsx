import { Link } from "wouter";
import {
  useGetInvoiceGroup,
  useGetInvoiceGroupValidTransitions,
  useUpdateInvoiceGroupStatus,
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
import { Skeleton, SkeletonSwap } from "@/components/ui/skeleton";
import { formatCurrency } from "@/lib/format";
import { formatDateTime } from "@/lib/format";
import {
  ArrowRight,
  ArrowUpRight,
  ExternalLink,
  Loader2,
  Mail,
  Bot,
  Send,
  CheckCircle,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { useClosureConfirmLauncher } from "@/components/closure/closure-launcher";
import { RefNumber } from "@/components/ref-number";

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
 *  - Closure: Denied by Payor only — `Cannot Dispute` and `Non-Issue` are
 *    stage-1 verdicts and must not appear here (see replit.md "Design
 *    decision in flight").
 *
 * Note: there is no "Mark Paid" / Resolution lane. This department's
 * job ends at confirming the submission/reattestation was completed;
 * payment outcomes are not tracked here (user direction, May 1 2026).
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
  // Light "confirm" launcher: this lane records a closure that the
  // payor — not us — decided. The full structured intake (category /
  // root cause / narrative / accountability) doesn't apply because the
  // payor's response is the record. The confirm dialog auto-fills every
  // required server-side field and just asks the operator to confirm.
  const closureConfirm = useClosureConfirmLauncher();

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

  // Task #411 audit, Tier 1 — honest button labels.
  //
  // All three "continuation" verdicts currently route the group back
  // to the same generic "Needs Evidence" state — there is no per-
  // verdict downstream state machine yet (re-dispute does not pre-
  // fill new evidence, re-attest does not open a re-attestation
  // form, "Submit new invoice" does not seed an invoice number). The
  // dedicated workflows are tracked separately. Until those land we:
  //   (a) tag every button with a "Coming soon" badge so operators
  //       see at a glance that the click is interim,
  //   (b) keep the click functional (group → Needs Evidence) so the
  //       work doesn't stall waiting for the new flow, and
  //   (c) ALSO write a tracking note via the existing notes endpoint
  //       so the timeline carries an explicit record of which
  //       continuation path the operator chose. The note serves as
  //       the "linked tracking" the audit asks for — it shows up in
  //       the activity feed and survives the status flip.
  if (postResponseActions.includes("re_dispute")) {
    continuationActions.push({
      key: "re_dispute",
      label: "Re-dispute (workflow coming soon)",
      sub: "Interim: moves group → Needs Evidence and writes a follow-up note. Dedicated re-dispute workflow tracked separately.",
      icon: <Send className="h-4 w-4" />,
      toneClass: "bg-amber-50 hover:bg-amber-100 border-amber-300 text-amber-900",
      targetStatus: "Needs Evidence",
      reason: "Re-dispute with additional points — returned to evidence gathering after payor response",
    });
  }
  if (postResponseActions.includes("resolve_reattest")) {
    continuationActions.push({
      key: "resolve_reattest",
      label: "Re-attest (workflow coming soon)",
      sub: "Interim: moves group → Needs Evidence and writes a follow-up note. Dedicated re-attest workflow tracked separately.",
      icon: <RefreshCw className="h-4 w-4" />,
      toneClass: "bg-blue-50 hover:bg-blue-100 border-blue-300 text-blue-900",
      targetStatus: "Needs Evidence",
      reason: "Resolve via re-attestation — returned to evidence gathering to attach re-attested documentation",
    });
  }
  if (postResponseActions.includes("resolve_new_invoice")) {
    continuationActions.push({
      key: "resolve_new_invoice",
      label: "Submit new invoice (workflow coming soon)",
      sub: "Interim: moves group → Needs Evidence and writes a follow-up note. Dedicated new-invoice workflow tracked separately.",
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
      // Task #411 audit, Tier 1 — write a follow-up tracking note so
      // the timeline carries the operator's chosen continuation path
      // explicitly. This is the "linked tracking note" the audit
      // asks for; even if the status flip is later reverted, the
      // note remains as a record of intent.
      //
      // The status flip is the primary contract the operator
      // invoked — it has already succeeded by this point — so we
      // do NOT throw on note failure. BUT: we MUST distinguish
      // "note saved" from "note attempted but not persisted" in
      // the success message, otherwise we reintroduce the exact
      // "button claims success but side effect missing" anti-
      // pattern this task is meant to eradicate. We check
      // `response.ok` and surface partial-success messaging.
      let notePersisted = false;
      let noteFailureReason: string | null = null;
      try {
        const noteRes = await fetch(`/api/notes`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            invoiceGroupId: group.id,
            content: `Follow-up: operator selected "${action.label}" path after payor response. Interim flow moved group to ${action.targetStatus}. Dedicated workflow for this continuation type is tracked separately.`,
          }),
        });
        if (noteRes.ok) {
          notePersisted = true;
        } else {
          noteFailureReason = `HTTP ${noteRes.status}`;
        }
      } catch (noteErr) {
        noteFailureReason = noteErr instanceof Error ? noteErr.message : String(noteErr);
      }
      invalidate();
      const cleanLabel = action.label.replace(" (workflow coming soon)", "");
      if (notePersisted) {
        onCompleted(`${cleanLabel} — moved to ${action.targetStatus}, follow-up note added`);
      } else {
        // Status moved; note didn't. Tell the operator the truth so
        // they can add the tracking note manually if needed.
        toast({
          title: `${cleanLabel} — moved to ${action.targetStatus}, but follow-up note FAILED`,
          description: `Status flip succeeded. Add a tracking note manually from the group page. (${noteFailureReason ?? "unknown error"})`,
          variant: "destructive",
        });
        onCompleted(`${cleanLabel} — moved to ${action.targetStatus} (follow-up note failed; add manually)`);
      }
    } catch (err: unknown) {
      toast({
        title: `Couldn't apply "${action.label}"`,
        description: getErrorMessage(err) || "Action failed. Please refresh and try again.",
        variant: "destructive",
      });
    }
  };

  const isPending = updateStatus.isPending;

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

  // Read-only banner for the global tour-sample group (migration 0029).
  // Every mutation hitting this group bounces with HTTP 403 at the API
  // layer, so we surface that up front instead of letting the operator
  // click a verdict button and watch it fail. The detail payload
  // includes `isTourSample` whenever the group is the seeded one.
  const isTourSample = (detail as unknown as { isTourSample?: boolean })?.isTourSample === true;

  return (
    <Card data-testid={`queue-response-review-panel-${group.invoiceNumber}`}>
      {isTourSample && (
        <div className="rounded-t-md border-b border-amber-300 bg-amber-50 px-4 py-2 text-xs text-amber-900" data-testid="tour-sample-banner">
          <strong>Sample for the tour</strong> — read-only. Verdict actions are disabled here so you can poke around without changing real data.
        </div>
      )}
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-1 min-w-0">
            <CardTitle className="text-lg flex items-center gap-2 flex-wrap">
              <span>Review payor response</span>
              <span className="font-mono text-sm text-muted-foreground inline-flex items-center gap-1">#<RefNumber value={group.invoiceNumber} variant="inline" /></span>
              {/* Task #753 — Surface the leg the latest reviewable response
                  belongs to so the operator knows which ride the AI hint
                  + verdict actions are about. Server picks the leg in
                  `primaryLeg`; we fall back silently if absent. */}
              {group.primaryLeg && (
                <span
                  className="font-mono text-xs text-muted-foreground inline-flex items-center gap-1"
                  data-testid="review-panel-leg-pair"
                >
                  {group.primaryLeg.confNumber
                    ? <>· Leg #<RefNumber value={group.primaryLeg.confNumber} variant="inline" /></>
                    : <>· Leg #{group.primaryLeg.id}</>}
                </span>
              )}
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              The AI hint is just a suggestion — you decide the verdict.
            </p>
          </div>
          {/* Compact ↗ drilldown — matches the queue-wide affordance. */}
          <Link href={`/invoice-groups/${group.id}`}>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 rounded-full text-muted-foreground hover:text-foreground"
              aria-label="Open invoice group in full view"
              title="Open invoice group in full view"
            >
              <ArrowUpRight className="h-3.5 w-3.5" />
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
          <SkeletonSwap
            loading={detailLoading && !latestResponse}
            skeleton={
              <div className="space-y-2">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-12 w-full" />
              </div>
            }
          >
          {latestResponse ? (
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
          </SkeletonSwap>
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

          <div className="space-y-2" data-testid="verdict-lane-closure">
            <div className="text-xs font-semibold text-muted-foreground">
              Closure — payor formally denied
            </div>
            <Button
              variant="outline"
              className="h-auto py-2 px-3 flex flex-col items-start gap-0.5 bg-red-50 hover:bg-red-100 border-red-300 text-red-900 w-full"
              disabled={isPending}
              onClick={() =>
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
                  onSuccess: () => {
                    invalidate();
                    onCompleted(`#${group.invoiceNumber} closed as Denied by Payor`);
                  },
                })
              }
              data-testid="button-closure-denied-by-payor"
            >
              <span className="flex items-center gap-2 font-semibold text-sm">
                <ArrowRight className="h-4 w-4" />
                Denied by Payor
              </span>
              <span className="text-xs font-normal opacity-80 text-left">
                Payor formally denied — close out, no further dispute
              </span>
            </Button>
            {closureConfirm.dialog}
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

  return (
    <SkeletonSwap
      loading={isLoading && !detail}
      className="flex items-center gap-2 min-w-0 flex-1"
      skeleton={
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-40" />
        </div>
      }
    >
      {!latestResponse ? (
        <span className="text-xs text-muted-foreground italic shrink-0">
          Response details unavailable
        </span>
      ) : (
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
      )}
    </SkeletonSwap>
  );
}
