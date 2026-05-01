import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetInvoiceGroup,
  getGetInvoiceGroupQueryKey,
  useGetInvoiceGroupValidTransitions,
  getGetInvoiceGroupValidTransitionsQueryKey,
  usePackageInvoiceGroup,
} from "@workspace/api-client-react";
import type {
  ClaimResponse,
  InvoiceGroupDetailResponse,
  PortalResponseItem,
  GroupPackagingReadiness,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Loader2, Inbox, ClipboardCheck, Send } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { LegSubStatusPill } from "@/components/leg-sub-status-pill";
import { deriveLegSubStatus, type LegSubStatus } from "@workspace/leg-state";
import { ClosureActions } from "@/components/closure/closure-actions";
import { GroupAggregateContextPanel } from "@/components/group-aggregate-context-panel";
import { InvoiceGroupLegsList } from "@/components/invoice-group-legs-list";
import { InvoiceGroupSubmissionGauntlet } from "@/components/invoice-group-submission-gauntlet";
import { GroupCommunicationThread } from "@/components/communication/group-communication-thread";
import { ResponseReceivedBanner } from "@/components/communication/response-received-banner";
import { getMockConversations, getMockBannerData } from "@/components/communication/mock-data";

// Invoice-group orchestration surface — the only group detail UI post-cutover (Task #199).
//
// Task #232 split this into shared subcomponents (GroupAggregateContextPanel,
// InvoiceGroupLegsList, InvoiceGroupSubmissionGauntlet) so the queue page's
// inline workspace can render the exact same primary controls without
// duplicating the form/mutation plumbing.

interface Props {
  groupId: number;
}

export function InvoiceGroupDetailV2({ groupId }: Props) {
  const qc = useQueryClient();
  const { data: group, isLoading } = useGetInvoiceGroup(groupId, {
    query: { queryKey: getGetInvoiceGroupQueryKey(groupId), enabled: !!groupId },
  });

  // "Ready to package" mutation — POSTs the new endpoint that flips
  // a pre-submit group into Generating Email. Always operator-driven;
  // the readiness payload (computed server-side) gates the CTA. The
  // submit/readback/preview mutations all moved into
  // InvoiceGroupSubmissionGauntlet during the Task #232 refactor.
  const packageMutation = usePackageInvoiceGroup();

  const { data: validTransitions } = useGetInvoiceGroupValidTransitions(groupId, {
    query: {
      queryKey: getGetInvoiceGroupValidTransitionsQueryKey(groupId),
      enabled: groupId > 0,
    },
  });

  const allRides: ClaimResponse[] = (group as InvoiceGroupDetailResponse | undefined)?.rides ?? [];
  // Legs Queue and the preview gate only consider legs included in the
  // dispute. Excluded legs ride along but are not investigation work.
  const rides = useMemo(
    () => allRides.filter((r) => r.includedInDispute !== false),
    [allRides],
  );
  const excludedCount = allRides.length - rides.length;
  const legSubStatuses = useMemo(() => rides.map((r) => deriveLegSubStatus(r)), [rides]);

  const subStatusCounts: Record<string, number> = useMemo(() => {
    const acc: Record<string, number> = {};
    for (const s of legSubStatuses) {
      acc[s] = (acc[s] ?? 0) + 1;
    }
    return acc;
  }, [legSubStatuses]);

  const isPreSubmit = group?.status === "New" || group?.status === "Needs Evidence";
  // "Ready to package" payload from GET /invoice-groups/:id — null
  // until the first fetch lands; the CTA is hidden in that interval.
  const packagingReadiness: GroupPackagingReadiness | undefined =
    (group as InvoiceGroupDetailResponse | undefined)?.packagingReadiness;

  function invalidateGroup() {
    qc.invalidateQueries({ queryKey: getGetInvoiceGroupQueryKey(groupId) });
    qc.invalidateQueries({ queryKey: getGetInvoiceGroupValidTransitionsQueryKey(groupId) });
    qc.invalidateQueries({ queryKey: ["invoice-groups"] });
  }

  // Operator clicked "Ready to package" — fire the new system-controlled
  // transition. Server returns 409 + reason if readiness has slipped
  // since the page loaded; we surface that via the toast and let the
  // refetched group repaint the disabled state.
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
          // The 409 carries fresh readiness in its body; refetching the
          // group is the simplest way to repaint the CTA's disabled
          // tooltip with the canonical reason.
          invalidateGroup();
        },
      },
    );
  }

  // Mock communications wiring (incoming from main): the comm thread
  // and response banner are still UI-only previews. The submit/save/
  // readback/preview handlers that used to live here moved into the
  // extracted subcomponents (GroupAggregateContextPanel +
  // InvoiceGroupSubmissionGauntlet) in Task #232 — keeping them here
  // would duplicate the mutation plumbing.
  const { toast } = useToast();
  const mockLegIds = useMemo(
    () =>
      allRides.map((r) => ({
        id: r.id,
        label: r.confNumber ? `${r.confNumber}` : `Leg #${r.id}`,
      })),
    [allRides],
  );
  const mockConversations = useMemo(
    () => getMockConversations(mockLegIds),
    [mockLegIds],
  );
  const [bannerData, setBannerData] = useState(getMockBannerData());


  if (isLoading || !group) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading invoice group…
      </div>
    );
  }

  const detail = group as InvoiceGroupDetailResponse;

  return (
    <div className="space-y-4 max-w-5xl mx-auto p-4" data-testid="invoice-group-detail-v2">
      <ResponseReceivedBanner
        response={bannerData}
        onDismiss={() => setBannerData(null)}
      />

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle>
                {group.invoiceNumber || `Invoice group #${group.id}`}{" "}
                <Badge variant="outline" className="ml-2">{group.status}</Badge>
              </CardTitle>
              <CardDescription className="mt-1">
                {group.rideCount ?? allRides.length} legs · {formatCurrency(group.totalAmount ?? "0")}
                {excludedCount > 0 ? ` · ${excludedCount} excluded` : ""}
                {group.errorTypeName ? ` · ${group.errorTypeName}` : ""}
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-1.5 justify-end">
              {Object.entries(subStatusCounts).map(([sub, n]) => (
                <span key={sub} className="inline-flex items-center gap-1 text-xs">
                  <LegSubStatusPill subStatus={sub as LegSubStatus} />
                  <span className="text-muted-foreground tabular-nums">{n}</span>
                </span>
              ))}
            </div>
          </div>
        </CardHeader>
      </Card>

      <GroupAggregateContextPanel group={detail} groupId={groupId} />

      <InvoiceGroupLegsList rides={rides} excludedCount={excludedCount} />


      {/*
        Ready to package CTA — operator-driven flip from pre-submit
        into Generating Email. Hidden once the group is past
        pre-submit (the existing Submission preview / portal flow
        below takes over). Disabled state surfaces the readiness
        reason as a tooltip; clicking when enabled fires the new
        POST /invoice-groups/:id/package endpoint.
      */}
      {isPreSubmit && packagingReadiness && (
        <Card data-testid="ready-to-package-card">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <ClipboardCheck className="h-4 w-4" /> Ready to package
            </CardTitle>
            <CardDescription>
              Move this invoice out of pre-submit once every leg's worktree
              is done. Held legs ride along — they don't block packaging.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Badge variant="outline" data-testid="readiness-count-processed">
                {packagingReadiness.processedLegCount} processed
              </Badge>
              <Badge variant="outline" data-testid="readiness-count-unprocessed">
                {packagingReadiness.unprocessedLegCount} unprocessed
              </Badge>
              <Badge variant="outline" data-testid="readiness-count-excluded">
                {packagingReadiness.excludedLegCount} excluded
              </Badge>
              <Badge variant="outline" data-testid="readiness-count-held">
                {packagingReadiness.heldLegCount} on hold
              </Badge>
            </div>
            <div className="flex items-center justify-between gap-3">
              <p
                className={`text-sm ${packagingReadiness.ready ? "text-green-700" : "text-muted-foreground"}`}
                data-testid="readiness-reason"
              >
                {packagingReadiness.ready
                  ? "All worktree review complete. Click to advance into draft generation."
                  : packagingReadiness.reason}
              </p>
              {(() => {
                const button = (
                  <Button
                    size="sm"
                    onClick={onClickPackage}
                    disabled={!packagingReadiness.ready || packageMutation.isPending}
                    data-testid="ready-to-package-button"
                  >
                    {packageMutation.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                    ) : (
                      <Send className="h-3.5 w-3.5 mr-1" />
                    )}
                    Ready to package
                  </Button>
                );
                if (!packagingReadiness.ready) {
                  return (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span tabIndex={0} data-testid="ready-to-package-disabled-wrapper">
                            {button}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent
                          side="top"
                          data-testid="ready-to-package-disabled-tooltip"
                        >
                          {packagingReadiness.reason}
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  );
                }
                return button;
              })()}
            </div>
          </CardContent>
        </Card>
      )}

      <InvoiceGroupSubmissionGauntlet group={detail} groupId={groupId} />

      <GroupCommunicationThread
        conversations={mockConversations}
        groupInvoiceNumber={group.invoiceNumber || `#${group.id}`}
        onSyncInbox={() => {
          toast({ title: "Inbox sync queued" });
        }}
        onReply={async (input) => {
          toast({
            title: "Reply sent",
            description: `Sent to ${input.to.join(", ")}`,
          });
        }}
      />

      {/* Post-submit response / verdict summary — read-only.
          Shown once the group has actually been submitted (anything past pre-submit). */}
      {!isPreSubmit && (
        <Card data-testid="group-response-summary-card">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Inbox className="h-4 w-4" /> Payor response & verdict
            </CardTitle>
            <CardDescription>
              Read-only summary of what the payor has sent back and the
              recorded group verdict. Manage responses on the legacy group page.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <h3 className="text-sm font-semibold">Group verdict</h3>
              {group.outcome && group.outcome !== "Pending" ? (
                <div className="rounded-md border bg-muted/30 p-3 text-sm space-y-1">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" data-testid="group-verdict-outcome">
                      {group.outcome}
                    </Badge>
                    {group.closureReason && (
                      <span className="text-xs text-muted-foreground">
                        · {group.closureReason}
                      </span>
                    )}
                  </div>
                  {group.approvedAmount && (
                    <p className="text-xs text-muted-foreground">
                      Approved amount: {formatCurrency(group.approvedAmount)}
                    </p>
                  )}
                </div>
              ) : (
                <p
                  className="text-sm text-muted-foreground italic"
                  data-testid="group-verdict-empty"
                >
                  No verdict recorded yet.
                </p>
              )}
            </div>

            <Separator />

            <div className="space-y-2">
              <h3 className="text-sm font-semibold">Payor responses</h3>
              {(() => {
                const responses = detail.responses ?? [];
                if (responses.length === 0) {
                  return (
                    <p
                      className="text-sm text-muted-foreground italic"
                      data-testid="group-responses-empty"
                    >
                      No responses received yet.
                    </p>
                  );
                }
                return (
                  <ul className="space-y-2">
                    {responses.slice(0, 5).map((r: PortalResponseItem) => (
                      <li
                        key={r.id}
                        className="rounded-md border bg-muted/20 p-2.5 text-sm"
                        data-testid={`group-response-${r.id}`}
                      >
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <Badge variant="secondary" className="text-[10px]">
                            {r.responseType}
                          </Badge>
                          <Badge variant="outline" className="text-[10px]">
                            {r.source}
                          </Badge>
                          {r.subject && (
                            <span className="text-xs font-medium truncate">
                              {r.subject}
                            </span>
                          )}
                          <span className="text-xs text-muted-foreground ml-auto">
                            {r.senderName || r.senderEmail || "Unknown sender"}
                          </span>
                        </div>
                        {r.aiSummary && (
                          <p className="text-xs text-muted-foreground line-clamp-2">
                            {r.aiSummary}
                          </p>
                        )}
                      </li>
                    ))}
                    {responses.length > 5 && (
                      <li className="text-xs text-muted-foreground italic">
                        +{responses.length - 5} more — see legacy page for the full thread.
                      </li>
                    )}
                  </ul>
                );
              })()}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Post-MAS reattest summary — read-only.
          Shown only when the group has been flagged for reattestation. */}
      {group.reattestRequired && (
        <Card data-testid="group-reattest-summary-card">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <ClipboardCheck className="h-4 w-4" /> Post-MAS reattestation
            </CardTitle>
            <CardDescription>
              Read-only summary of the post-MAS reattestation requirement.
              Mark complete on the legacy group page.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {group.reattestCompletedAt ? (
              <div
                className="rounded-md border bg-emerald-50 border-emerald-200 p-3 text-sm space-y-1"
                data-testid="group-reattest-complete"
              >
                <p className="text-emerald-900">
                  Reattestation complete · {formatDateTime(group.reattestCompletedAt)}
                  {group.reattestCompletedBy ? ` by ${group.reattestCompletedBy}` : ""}
                </p>
                {group.reattestNote && (
                  <p className="text-xs text-emerald-800">{group.reattestNote}</p>
                )}
              </div>
            ) : (
              <div
                className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
                data-testid="group-reattest-pending"
              >
                Reattestation required but not yet completed — finish in the legacy group page.
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Closure — uses the shared group-only closure intake dialog (unchanged). */}
      <Card data-testid="group-closure-card">
        <CardHeader>
          <CardTitle className="text-base">Close this group</CardTitle>
          <CardDescription>
            Withdraw the group or record a payor denial. Opens the standard
            closure intake dialog.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {group.status === "Resolved" || group.status === "Denied" ? (
            <p className="text-sm text-muted-foreground italic">
              Already closed — outcome <strong>{group.outcome}</strong>
              {group.closureReason ? ` · ${group.closureReason}` : ""}.
            </p>
          ) : (
            <ClosureActions
              target={{ kind: "invoice_group", id: groupId }}
              outcome={group.outcome}
              closureReason={group.closureReason}
              triggers={[
                {
                  reason: "denied_by_payor",
                  label: "Denied by Payor",
                  sub: "Payor formally denied — recorded response required",
                  disabled: !validTransitions?.hasResponse,
                  disabledReason: validTransitions?.hasResponse
                    ? "Close because the payor formally denied this group."
                    : "Disabled because no portal or email response has been recorded yet.",
                  testId: "v2-group-close-denied-by-payor",
                },
                ...(validTransitions?.hasBeenSubmitted
                  ? []
                  : ([{
                      reason: "cannot_dispute" as const,
                      label: "Withdraw — Cannot Dispute",
                      sub: "No clear path to recover",
                      disabledReason: "Close because we decided not to dispute (no clear path to recover).",
                      testId: "v2-group-close-cannot-dispute",
                    }])),
              ]}
              onAfterSuccess={invalidateGroup}
            />
          )}
        </CardContent>
      </Card>

    </div>
  );
}
