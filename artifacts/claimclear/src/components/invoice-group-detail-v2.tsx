import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetInvoiceGroup,
  getGetInvoiceGroupQueryKey,
  useSetGroupContext,
  useConfirmUnderstandingReadback,
  useStampPreviewGenerated,
  useGetInvoiceGroupValidTransitions,
  getGetInvoiceGroupValidTransitionsQueryKey,
  useCreatePortalSubmission,
} from "@workspace/api-client-react";
import type {
  ClaimResponse,
  InvoiceGroupDetailResponse,
  PortalResponseItem,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Loader2, Save, FileText, Sparkles, ChevronRight, AlertTriangle, Inbox, ClipboardCheck, Send } from "lucide-react";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import { LegSubStatusPill } from "@/components/leg-sub-status-pill";
import { deriveLegSubStatus, type LegSubStatus } from "@workspace/leg-state";
import { ClosureActions } from "@/components/closure/closure-actions";

// Invoice-group orchestration surface — the only group detail UI post-cutover (Task #199).

interface Props {
  groupId: number;
}

// Resolved-for-preview sub-statuses: ready, dropped, excluded.
const RESOLVED_SUB_STATUSES: ReadonlySet<LegSubStatus> = new Set(["ready", "dropped", "excluded"]);

export function InvoiceGroupDetailV2({ groupId }: Props) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: group, isLoading } = useGetInvoiceGroup(groupId, {
    query: { queryKey: getGetInvoiceGroupQueryKey(groupId), enabled: !!groupId },
  });

  const setContextMutation = useSetGroupContext();
  const confirmReadbackMutation = useConfirmUnderstandingReadback();
  const stampPreviewMutation = useStampPreviewGenerated();
  const submitMutation = useCreatePortalSubmission();
  const [submitError, setSubmitError] = useState<{ error: string; gate?: string } | null>(null);
  const { data: validTransitions } = useGetInvoiceGroupValidTransitions(groupId, {
    query: {
      queryKey: getGetInvoiceGroupValidTransitionsQueryKey(groupId),
      enabled: groupId > 0,
    },
  });

  const [groupContext, setGroupContext] = useState("");
  const [readback, setReadback] = useState("");
  useEffect(() => {
    setGroupContext(group?.groupContext ?? "");
    setReadback(group?.understandingReadback ?? "");
  }, [group?.groupContext, group?.understandingReadback]);

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

  const allResolved = legSubStatuses.length > 0 && legSubStatuses.every((s) => RESOLVED_SUB_STATUSES.has(s));
  const readbackConfirmed = !!group?.understandingReadbackAt;
  const previewGenerated = !!group?.previewGeneratedAt;
  const isPreSubmit = group?.status === "New" || group?.status === "Needs Evidence";

  function invalidateGroup() {
    qc.invalidateQueries({ queryKey: getGetInvoiceGroupQueryKey(groupId) });
    qc.invalidateQueries({ queryKey: getGetInvoiceGroupValidTransitionsQueryKey(groupId) });
    qc.invalidateQueries({ queryKey: ["invoice-groups"] });
  }

  function onSaveGroupContext() {
    setContextMutation.mutate(
      { id: groupId, data: { context: groupContext } },
      {
        onSuccess: () => {
          toast({ title: "Group context saved" });
          // Saving the context clears the readback server-side, so wipe
          // the local readback buffer too.
          setReadback("");
          invalidateGroup();
        },
        onError: (e: unknown) => toast({ title: "Save failed", description: String((e as Error).message), variant: "destructive" }),
      },
    );
  }

  function onConfirmReadback() {
    if (!readback.trim()) return;
    confirmReadbackMutation.mutate(
      { id: groupId, data: { readback } },
      {
        onSuccess: () => {
          toast({ title: "Understanding readback confirmed" });
          invalidateGroup();
        },
        onError: (e: unknown) => toast({ title: "Readback failed", description: String((e as Error).message), variant: "destructive" }),
      },
    );
  }

  function onGeneratePreview() {
    stampPreviewMutation.mutate(
      { id: groupId },
      {
        onSuccess: () => {
          toast({ title: "Submission preview generated" });
          invalidateGroup();
        },
        onError: (e: unknown) => toast({ title: "Preview generation failed", description: String((e as Error).message), variant: "destructive" }),
      },
    );
  }

  function onSubmitToPortal() {
    setSubmitError(null);
    submitMutation.mutate(
      {
        data: {
          invoiceGroupId: groupId,
          actorType: "operator",
          understandingReadback: group?.understandingReadback ?? readback,
        },
      },
      {
        onSuccess: () => {
          toast({ title: "Submitted to portal" });
          invalidateGroup();
        },
        onError: (e: unknown) => {
          let errorMsg = e instanceof Error ? e.message : String(e);
          let gate: string | undefined;
          if (e != null && typeof e === "object" && "response" in e) {
            const axiosErr = e as { response?: { data?: { error?: string; gate?: string } } };
            const resp = axiosErr.response?.data;
            if (resp?.error) errorMsg = resp.error;
            if (resp?.gate) gate = resp.gate;
          }
          if (gate) {
            setSubmitError({ error: errorMsg, gate });
          } else {
            setSubmitError({ error: errorMsg });
          }
          toast({
            title: "Submission failed",
            description: errorMsg,
            variant: "destructive",
          });
        },
      },
    );
  }

  if (isLoading || !group) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading invoice group…
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-5xl mx-auto p-4" data-testid="invoice-group-detail-v2">
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

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <FileText className="h-4 w-4" /> Aggregate context
          </CardTitle>
          <CardDescription>
            Group-level narrative plus a roll-up of every leg's per-leg
            context. Edit per-leg context on each leg's investigation page.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Group context</h3>
              <Button
                size="sm"
                variant="outline"
                onClick={onSaveGroupContext}
                disabled={
                  !isPreSubmit ||
                  setContextMutation.isPending ||
                  groupContext === (group.groupContext ?? "")
                }
                data-testid="group-context-save"
              >
                {setContextMutation.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                ) : (
                  <Save className="h-3.5 w-3.5 mr-1" />
                )}
                Save
              </Button>
            </div>
            <Textarea
              value={groupContext}
              onChange={(e) => setGroupContext(e.target.value)}
              rows={4}
              disabled={!isPreSubmit}
              placeholder="Group-level narrative the dispute write-up will pick up. Pre-submit only — saving clears any prior understanding readback."
              data-testid="group-context-input"
            />
          </div>

          <Separator />

          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Per-leg context roll-up</h3>
            {allRides.filter((r) => r.perLegContext).length === 0 ? (
              <p className="text-xs text-muted-foreground italic">
                No per-leg context recorded yet. Open each leg's investigation
                surface to record one.
              </p>
            ) : (
              <ul className="space-y-2 text-sm">
                {allRides
                  .filter((r) => r.perLegContext)
                  .map((r) => (
                    <li
                      key={r.id}
                      className="rounded-md border bg-muted/30 p-2.5"
                      data-testid={`leg-context-roll-${r.id}`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <Link
                          href={`/claims/${r.id}`}
                          className="text-xs font-medium hover:underline"
                        >
                          Leg #{r.id} · {r.confNumber || "—"}
                        </Link>
                        <LegSubStatusPill leg={r} />
                      </div>
                      <p className="text-xs whitespace-pre-line">{r.perLegContext}</p>
                    </li>
                  ))}
              </ul>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Legs queue</CardTitle>
          <CardDescription>
            Disputed legs only{excludedCount > 0 ? ` · ${excludedCount} excluded leg${excludedCount === 1 ? "" : "s"} hidden` : ""}.
            Resolve every leg before generating the submission preview.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {rides.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">
              No legs included in the dispute for this group.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground border-b">
                  <tr>
                    <th className="text-left py-2 pr-2">Leg</th>
                    <th className="text-left py-2 pr-2">Service date</th>
                    <th className="text-left py-2 pr-2">Amount</th>
                    <th className="text-left py-2 pr-2">Sub-status</th>
                    <th className="py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {rides.map((r) => (
                    <tr key={r.id} className="border-b last:border-b-0" data-testid={`legs-queue-row-${r.id}`}>
                      <td className="py-2 pr-2 font-medium">
                        #{r.id} · {r.confNumber || "—"}
                      </td>
                      <td className="py-2 pr-2 text-muted-foreground">
                        {r.date ? formatDate(r.date) : "—"}
                      </td>
                      <td className="py-2 pr-2 tabular-nums">
                        {formatCurrency(r.claimAmount ?? "0")}
                      </td>
                      <td className="py-2 pr-2">
                        <LegSubStatusPill leg={r} />
                      </td>
                      <td className="py-2 text-right">
                        <Link href={`/claims/${r.id}`}>
                          <Button size="sm" variant="ghost" className="h-7" data-testid={`legs-queue-open-${r.id}`}>
                            Open <ChevronRight className="h-3.5 w-3.5 ml-0.5" />
                          </Button>
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles className="h-4 w-4" /> Submission preview
          </CardTitle>
          <CardDescription>
            Confirm the AI's read of the case, then generate the dispute
            submission preview.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!isPreSubmit && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              This group is past pre-submit ({group.status}); preview generation
              is no longer available from this surface.
            </div>
          )}

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Understanding readback</h3>
              <div className="flex items-center gap-2">
                {readbackConfirmed && (
                  <Badge variant="secondary" className="text-[10px]">
                    Confirmed {group.understandingReadbackAt ? formatDateTime(group.understandingReadbackAt) : ""}
                  </Badge>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={onConfirmReadback}
                  disabled={
                    !isPreSubmit ||
                    !allResolved ||
                    confirmReadbackMutation.isPending ||
                    !readback.trim() ||
                    readback === (group.understandingReadback ?? "")
                  }
                  data-testid="readback-confirm"
                >
                  {confirmReadbackMutation.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                  ) : null}
                  Confirm readback
                </Button>
              </div>
            </div>
            <Textarea
              value={readback}
              onChange={(e) => setReadback(e.target.value)}
              rows={3}
              disabled={!isPreSubmit || !allResolved}
              placeholder="Write what you understand the case to be. Confirming records the timestamp + author and unlocks preview generation."
              data-testid="readback-input"
            />
            {isPreSubmit && !allResolved && (
              <p className="text-xs text-muted-foreground italic" data-testid="readback-locked-reason">
                Readback unlocks once every disputed leg is resolved (ready, dropped, or excluded).
              </p>
            )}
          </div>

          <Separator />

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Generate preview</h3>
              {(() => {
                const previewDisabledReason: string | null = !isPreSubmit
                  ? `Disabled because the group is past pre-submit (${group.status}).`
                  : rides.length === 0
                    ? "Disabled because this group has no legs included in the dispute."
                    : !allResolved
                      ? (() => {
                          const unresolved = legSubStatuses.filter(
                            (s) => !RESOLVED_SUB_STATUSES.has(s),
                          );
                          const counts = unresolved.reduce<Record<string, number>>(
                            (acc, s) => ({ ...acc, [s]: (acc[s] ?? 0) + 1 }),
                            {},
                          );
                          const summary = Object.entries(counts)
                            .map(([s, n]) => `${n} ${s.replace("_", " ")}`)
                            .join(", ");
                          return `Disabled because ${unresolved.length} leg${unresolved.length === 1 ? "" : "s"} still owe action (${summary}).`;
                        })()
                      : !readbackConfirmed
                        ? "Disabled because the understanding readback hasn't been confirmed yet."
                        : null;
                const button = (
                  <Button
                    size="sm"
                    onClick={onGeneratePreview}
                    disabled={previewDisabledReason !== null || stampPreviewMutation.isPending}
                    data-testid="generate-preview"
                  >
                    {stampPreviewMutation.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                    ) : (
                      <Sparkles className="h-3.5 w-3.5 mr-1" />
                    )}
                    {previewGenerated ? "Regenerate preview" : "Generate preview"}
                  </Button>
                );
                if (previewDisabledReason) {
                  return (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span tabIndex={0} data-testid="generate-preview-disabled-wrapper">
                            {button}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent
                          side="top"
                          data-testid="generate-preview-disabled-tooltip"
                        >
                          {previewDisabledReason}
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  );
                }
                return button;
              })()}
            </div>
            <ul className="space-y-1 text-xs">
              <li className={allResolved ? "text-green-700" : "text-muted-foreground"}>
                {allResolved ? "✓" : "○"} Every leg resolved (ready, dropped, or excluded)
              </li>
              <li className={readbackConfirmed ? "text-green-700" : "text-muted-foreground"}>
                {readbackConfirmed ? "✓" : "○"} Understanding readback confirmed
              </li>
              {previewGenerated && (
                <li className="text-green-700">
                  ✓ Preview generated {group.previewGeneratedAt ? formatDateTime(group.previewGeneratedAt) : ""}
                </li>
              )}
            </ul>
          </div>

          {isPreSubmit && previewGenerated && (
            <>
              <Separator />
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold">Submit to portal</h3>
                  {(() => {
                    const missingGates: string[] = [];
                    if (!allResolved) missingGates.push("legs");
                    if (!readbackConfirmed) missingGates.push("readback");
                    const submitDisabledReason: string | null =
                      missingGates.length > 0
                        ? `Cannot submit — missing gate${missingGates.length > 1 ? "s" : ""}: ${missingGates.join(", ")}.`
                        : null;
                    const button = (
                      <Button
                        size="sm"
                        onClick={onSubmitToPortal}
                        disabled={submitDisabledReason !== null || submitMutation.isPending}
                        data-testid="submit-to-portal"
                      >
                        {submitMutation.isPending ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                        ) : (
                          <Send className="h-3.5 w-3.5 mr-1" />
                        )}
                        Submit to Portal
                      </Button>
                    );
                    if (submitDisabledReason) {
                      return (
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span tabIndex={0} data-testid="submit-to-portal-disabled-wrapper">
                                {button}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent
                              side="top"
                              data-testid="submit-to-portal-disabled-tooltip"
                            >
                              {submitDisabledReason}
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      );
                    }
                    return button;
                  })()}
                </div>
                <p className="text-xs text-muted-foreground">
                  Generate Preview calls <code>/portal-submissions/generate-preview</code> (renders preview),
                  then <code>/api/invoice-groups/:id/preview-generated</code> (stamps acceptance).
                  Submit is the separate step that triggers the portal transition.
                </p>
                {submitError && (
                  <div
                    className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900"
                    data-testid="submit-error"
                  >
                    {submitError.error}
                    {submitError.gate && (
                      <span className="ml-1 text-xs text-red-700">(gate: {submitError.gate})</span>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

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
                const responses =
                  (group as InvoiceGroupDetailResponse).responses ?? [];
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
