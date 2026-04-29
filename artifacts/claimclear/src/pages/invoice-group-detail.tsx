import { useParams, Link } from "wouter";
import {
  useGetInvoiceGroup,
  useUpdateInvoiceGroupStatus,
  useUpdateInvoiceGroupOutcome,
  useTriageInvoiceGroup,
  useHoldInvoiceGroup,
  useRemoveInvoiceGroupHold,
  getGetInvoiceGroupQueryKey,
  useListInvoiceGroupEvidence,
  getListInvoiceGroupEvidenceQueryKey,
  useDeleteInvoiceGroupEvidence,
  useProcessResponse,
  useReassignResponse,
  useListInvoiceGroups,
  useListClaims,
  getListResponsesQueryKey,
  getGetInvoiceGroupValidTransitionsQueryKey,
  useGetInvoiceGroupValidTransitions,
  usePlaceClaimOnHold,
  useRemoveClaimHold,
} from "@workspace/api-client-react";
import { closureReasonLabel } from "@/lib/closure-reasons";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { ClaimResponse, InvoiceGroupResponse, PortalResponseItem, ProcessResponseBodyResponseType, UpdateInvoiceGroupOutcomeBodyClosureReason } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Fragment, useState } from "react";
import DOMPurify from "dompurify";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/status-badge";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/format";
import {
  ArrowLeft,
  Loader2,
  AlertCircle,
  FileText,
  DollarSign,
  Hash,
  User,
  Calendar,
  Car,
  Trash2,
  StickyNote,
  Mail,
  Filter,
  Inbox,
  Bot,
  CheckCircle,
  X,
  Eye,
  ArrowRightLeft,
  MailQuestion,
  Search,
  PauseCircle,
  Play,
  SplitSquareHorizontal,
} from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  humanizeAuditAction,
  ACTION_CATEGORY_LABELS,
  type ActionCategory,
} from "@/lib/audit-action-meta";

export default function InvoiceGroupDetail() {
  const params = useParams<{ id: string }>();
  const id = parseInt(params.id || "0", 10);
  const queryClient = useQueryClient();

  const { data: group, isLoading, error } = useGetInvoiceGroup(id, {
    query: { enabled: id > 0, queryKey: getGetInvoiceGroupQueryKey(id) },
  });

  const { data: collectedEvidence } = useListInvoiceGroupEvidence(id, {
    query: { enabled: id > 0, queryKey: getListInvoiceGroupEvidenceQueryKey(id) },
  });

  const updateStatus = useUpdateInvoiceGroupStatus();
  const updateOutcome = useUpdateInvoiceGroupOutcome();
  const { data: groupValidTransitions } = useGetInvoiceGroupValidTransitions(id, {
    query: { enabled: id > 0, queryKey: getGetInvoiceGroupValidTransitionsQueryKey(id) },
  });
  const triageGroup = useTriageInvoiceGroup();
  const holdGroup = useHoldInvoiceGroup();
  const removeHold = useRemoveInvoiceGroupHold();
  const placeLegHold = usePlaceClaimOnHold();
  const removeLegHold = useRemoveClaimHold();
  const deleteEvidence = useDeleteInvoiceGroupEvidence();
  const processResponseMutation = useProcessResponse();
  const reassignResponseMutation = useReassignResponse();

  const [holdReason, setHoldReason] = useState("");

  // Per-leg hold dialog state — tracks which ride row's Hold dialog is open,
  // plus its reason / pending-from inputs. Mirrors the claim-detail flow so
  // the user doesn't have to drill into a separate page to park a single leg.
  const [legHoldDialogFor, setLegHoldDialogFor] = useState<number | null>(null);
  const [legHoldReason, setLegHoldReason] = useState("");
  const [legHoldPendingFrom, setLegHoldPendingFrom] = useState("");
  const [legActionError, setLegActionError] = useState<string | null>(null);
  const [activityFilter, setActivityFilter] = useState<ActionCategory | "all">("all");
  const [expandedResponseIds, setExpandedResponseIds] = useState<Set<number>>(new Set());
  const toggleResponseExpanded = (responseId: number) => {
    setExpandedResponseIds((prev) => {
      const next = new Set(prev);
      if (next.has(responseId)) next.delete(responseId);
      else next.add(responseId);
      return next;
    });
  };

  const [reassignTarget, setReassignTarget] = useState<PortalResponseItem | null>(null);
  const [reassignTab, setReassignTab] = useState<"group" | "claim">("group");
  const [reassignSearch, setReassignSearch] = useState("");
  const [reassignSelectedGroupId, setReassignSelectedGroupId] = useState<number | null>(null);
  const [reassignSelectedClaimId, setReassignSelectedClaimId] = useState<number | null>(null);

  const { data: reassignGroupsData } = useListInvoiceGroups(
    { search: reassignSearch || undefined, limit: 10 },
    { query: { queryKey: ["reassignGroupSearch", reassignSearch], enabled: !!reassignTarget && reassignTab === "group" && reassignSearch.length >= 2 } },
  );
  const { data: reassignClaimsData } = useListClaims(
    { search: reassignSearch || undefined, limit: 10 },
    { query: { queryKey: ["reassignClaimSearchFromGroup", reassignSearch], enabled: !!reassignTarget && reassignTab === "claim" && reassignSearch.length >= 2 } },
  );

  const invalidateAfterResponseChange = () => {
    queryClient.invalidateQueries({ queryKey: getGetInvoiceGroupQueryKey(id) });
    queryClient.invalidateQueries({ queryKey: getGetInvoiceGroupValidTransitionsQueryKey(id) });
    queryClient.invalidateQueries({ queryKey: getListResponsesQueryKey() });
  };

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getGetInvoiceGroupQueryKey(id) });
  };

  const handleDeleteEvidence = async (evidenceId: number) => {
    await deleteEvidence.mutateAsync({ id, evidenceId });
    queryClient.invalidateQueries({ queryKey: getListInvoiceGroupEvidenceQueryKey(id) });
    invalidate();
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !group) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" asChild>
          <Link href="/invoice-groups"><ArrowLeft className="h-4 w-4 mr-2" /> Back</Link>
        </Button>
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            <AlertCircle className="h-8 w-8 mx-auto mb-2" />
            Invoice group not found.
          </CardContent>
        </Card>
      </div>
    );
  }

  const rides: ClaimResponse[] = (group as any).rides ?? [];
  const auditLogs: any[] = (group as any).auditLogs ?? [];
  const notes: any[] = (group as any).notes ?? [];
  const responses: PortalResponseItem[] = (group as any).responses ?? [];

  // A group is "partial" when at least one leg is on hold and at least one is
  // not — surfaced as a Partial badge in the header so users can see at a
  // glance that the group has been split into separate workflows.
  const heldLegCount = rides.filter((r) => r.status === "On Hold").length;
  const isPartial: boolean = (group as any).isPartial ?? (heldLegCount > 0 && heldLegCount < rides.length);

  const handleTriage = async (outcome: "non_issue" | "issue_found") => {
    await triageGroup.mutateAsync({
      id,
      data: { triageOutcome: outcome },
    });
    invalidate();
  };

  const handleOutcome = async (
    outcome: string,
    closureReason?: UpdateInvoiceGroupOutcomeBodyClosureReason,
  ) => {
    await updateOutcome.mutateAsync({
      id,
      data: { outcome, closureReason },
    });
    invalidate();
  };

  const handleHold = async () => {
    await holdGroup.mutateAsync({
      id,
      data: { reason: holdReason },
    });
    setHoldReason("");
    invalidate();
  };

  const handleRemoveHold = async () => {
    await removeHold.mutateAsync({ id });
    invalidate();
  };

  const openLegHoldDialog = (legId: number) => {
    setLegHoldDialogFor(legId);
    setLegHoldReason("");
    setLegHoldPendingFrom("");
    setLegActionError(null);
  };

  const closeLegHoldDialog = () => {
    setLegHoldDialogFor(null);
    setLegHoldReason("");
    setLegHoldPendingFrom("");
    setLegActionError(null);
  };

  const handlePlaceLegHold = async () => {
    if (!legHoldDialogFor || !legHoldReason.trim()) return;
    try {
      await placeLegHold.mutateAsync({
        id: legHoldDialogFor,
        data: { holdReason: legHoldReason, holdPendingFrom: legHoldPendingFrom || undefined },
      });
      closeLegHoldDialog();
      invalidate();
    } catch (err: any) {
      setLegActionError(err?.response?.data?.error || err?.message || "Failed to place leg on hold");
    }
  };

  const handleRemoveLegHold = async (legId: number) => {
    setLegActionError(null);
    try {
      await removeLegHold.mutateAsync({ id: legId });
      invalidate();
    } catch (err: any) {
      setLegActionError(err?.response?.data?.error || err?.message || "Failed to remove leg hold");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/invoice-groups"><ArrowLeft className="h-4 w-4 mr-2" /> Back</Link>
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight font-mono">Invoice #{group.invoiceNumber}</h1>
            <StatusBadge status={group.status} />
            {group.outcome !== "Pending" && (
              <Badge variant={group.outcome === "Approved" ? "default" : group.outcome === "Denied" ? "destructive" : "secondary"}>
                {group.outcome}
              </Badge>
            )}
            {group.closureReason && (
              <Badge variant="secondary" data-testid="badge-closure-reason">
                {closureReasonLabel(group.closureReason)}
              </Badge>
            )}
            {isPartial && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge
                      variant="outline"
                      className="border-amber-300 bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200 dark:border-amber-700 gap-1"
                      data-testid="badge-partial"
                    >
                      <SplitSquareHorizontal className="h-3 w-3" />
                      Partial
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent>
                    {heldLegCount} of {rides.length} leg{rides.length === 1 ? "" : "s"} on hold — the rest can be submitted independently.
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            {group.rideCount} ride{group.rideCount !== 1 ? "s" : ""} &middot; {formatCurrency(group.totalAmount)}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Group Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs text-muted-foreground">Invoice Number</Label>
                  <p className="font-mono font-medium">{group.invoiceNumber}</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Client Number</Label>
                  <p>{group.clientNumber || '-'}</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Total Amount</Label>
                  <p className="font-medium">{formatCurrency(group.totalAmount)}</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Error Type</Label>
                  <p>{group.errorTypeName || <span className="text-muted-foreground italic">Unassigned</span>}</p>
                </div>
              </div>
              {group.errorDetails && (
                <div>
                  <Label className="text-xs text-muted-foreground">Error Details</Label>
                  <p className="text-sm mt-1 bg-muted/50 rounded px-3 py-2">{group.errorDetails}</p>
                </div>
              )}
              {group.holdReason && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-md px-4 py-3">
                  <p className="text-sm font-medium text-yellow-800">On Hold</p>
                  <p className="text-sm text-yellow-700">{group.holdReason}</p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Evidence</CardTitle>
              <CardDescription>Evidence items collected for this invoice group during workflow execution.</CardDescription>
            </CardHeader>
            <CardContent>
              {(() => {
                const evidenceItems = Array.isArray(collectedEvidence?.evidence) ? collectedEvidence.evidence : [];
                if (evidenceItems.length === 0) {
                  return (
                    <p className="text-sm text-muted-foreground">No group evidence collected yet.</p>
                  );
                }
                return (
                  <div className="space-y-3">
                    <Label className="text-xs text-muted-foreground">Collected Evidence ({evidenceItems.length} items)</Label>
                    <div className="grid gap-3">
                      {evidenceItems.map((ev) => (
                        <div key={ev.id} className="border rounded-lg p-3 space-y-2 bg-muted/30">
                          <div className="flex items-start justify-between">
                            <div>
                              <p className="text-sm font-medium">{ev.evidenceTypeName}</p>
                              {ev.treeNodeId && (
                                <p className="text-[10px] text-muted-foreground">
                                  Tree node: {ev.treeNodeId}
                                </p>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] text-muted-foreground">
                                {ev.collectedBy && `by ${ev.collectedBy} · `}
                                {formatDateTime(ev.collectedAt)}
                              </span>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 text-destructive"
                                onClick={() => handleDeleteEvidence(ev.id)}
                                disabled={deleteEvidence.isPending}
                                title="Delete evidence"
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </div>
                          </div>
                          {ev.imageUrl && (
                            <a
                              href={ev.imageUrl.startsWith("/objects/") ? `/api/storage${ev.imageUrl}` : ev.imageUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="block"
                            >
                              <img
                                src={ev.imageUrl.startsWith("/objects/") ? `/api/storage${ev.imageUrl}` : ev.imageUrl}
                                alt={ev.evidenceTypeName}
                                className="rounded border max-h-40 w-auto hover:opacity-90 transition-opacity"
                              />
                            </a>
                          )}
                          {ev.notes && (
                            <p className="text-xs bg-white dark:bg-background rounded p-2 border">{ev.notes}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Rides ({rides.length})</CardTitle>
              <CardDescription>Individual rides in this invoice group.</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="text-xs text-muted-foreground bg-muted/50 uppercase border-b">
                    <tr>
                      <th className="px-4 py-3 font-medium">
                        <span className="flex items-center gap-1"><Hash className="h-3 w-3" /> Conf #</span>
                      </th>
                      <th className="px-4 py-3 font-medium">
                        <span className="flex items-center gap-1"><FileText className="h-3 w-3" /> Ref #</span>
                      </th>
                      <th className="px-4 py-3 font-medium">
                        <span className="flex items-center gap-1"><Calendar className="h-3 w-3" /> Date</span>
                      </th>
                      <th className="px-4 py-3 font-medium">
                        <span className="flex items-center gap-1"><User className="h-3 w-3" /> Client</span>
                      </th>
                      <th className="px-4 py-3 font-medium">
                        <span className="flex items-center gap-1"><Car className="h-3 w-3" /> Car #</span>
                      </th>
                      <th className="px-4 py-3 font-medium">Error Details</th>
                      <th className="px-4 py-3 font-medium">
                        <span className="flex items-center gap-1"><DollarSign className="h-3 w-3" /> Amount</span>
                      </th>
                      <th className="px-4 py-3 font-medium">Status</th>
                      <th className="px-4 py-3 font-medium text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rides.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="px-4 py-6 text-center text-muted-foreground">
                          No rides in this group.
                        </td>
                      </tr>
                    ) : (
                      rides.map((ride) => {
                        const isHeld = ride.status === "On Hold";
                        return (
                          <Fragment key={ride.id}>
                            <tr
                              className={`border-b last:border-0 hover:bg-muted/30 transition-colors ${isHeld ? "bg-amber-50/40 dark:bg-amber-950/20" : ""}`}
                              data-testid={`leg-row-${ride.id}`}
                            >
                              <td className="px-4 py-3 font-mono font-medium text-primary">
                                <Link href={`/claims/${ride.id}`}>{ride.confNumber}</Link>
                              </td>
                              <td className="px-4 py-3 text-xs text-muted-foreground">{ride.refNumber || '-'}</td>
                              <td className="px-4 py-3 whitespace-nowrap">{formatDate(ride.date)}</td>
                              <td className="px-4 py-3">{ride.clientNumber || '-'}</td>
                              <td className="px-4 py-3">{ride.carNumber || '-'}</td>
                              <td className="px-4 py-3 max-w-[200px]">
                                <span className="text-xs text-muted-foreground line-clamp-2">{ride.errorDetails || '-'}</span>
                              </td>
                              <td className="px-4 py-3 font-medium whitespace-nowrap">{formatCurrency(ride.claimAmount)}</td>
                              <td className="px-4 py-3"><StatusBadge status={ride.status} /></td>
                              <td className="px-4 py-3 text-right whitespace-nowrap">
                                {isHeld ? (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleRemoveLegHold(ride.id)}
                                    disabled={removeLegHold.isPending}
                                    data-testid={`btn-remove-leg-hold-${ride.id}`}
                                  >
                                    <Play className="h-3.5 w-3.5 mr-1" />Remove Hold
                                  </Button>
                                ) : (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => openLegHoldDialog(ride.id)}
                                    data-testid={`btn-hold-leg-${ride.id}`}
                                  >
                                    <PauseCircle className="h-3.5 w-3.5 mr-1" />Hold
                                  </Button>
                                )}
                              </td>
                            </tr>
                            {isHeld && ride.holdReason && (
                              <tr className="bg-amber-50/40 dark:bg-amber-950/20 border-b last:border-0">
                                <td colSpan={9} className="px-4 pb-3 -mt-1">
                                  <div className="text-xs text-amber-800 dark:text-amber-200 flex items-start gap-2">
                                    <PauseCircle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                                    <span>
                                      <span className="font-medium">On hold:</span> {ride.holdReason}
                                      {ride.holdPendingFrom ? <span className="opacity-70"> · pending from {ride.holdPendingFrom}</span> : null}
                                    </span>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
              {legActionError && (
                <div className="px-4 py-2 text-xs text-destructive border-t bg-destructive/5" data-testid="leg-action-error">
                  {legActionError}
                </div>
              )}
              {isPartial && (
                <div className="px-4 py-2 text-xs text-amber-800 dark:text-amber-200 border-t bg-amber-50/60 dark:bg-amber-950/30 flex items-center gap-2">
                  <SplitSquareHorizontal className="h-3.5 w-3.5" />
                  This invoice is split: only the {rides.length - heldLegCount} non-held leg{rides.length - heldLegCount === 1 ? "" : "s"} will be included in the next portal submission.
                </div>
              )}
            </CardContent>
          </Card>

          <Dialog open={legHoldDialogFor !== null} onOpenChange={(open) => { if (!open) closeLegHoldDialog(); }}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Place this leg on hold</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  This leg will be excluded from the next portal submission for this invoice. The other legs can still move forward independently.
                </p>
                <div>
                  <Label className="text-xs">Reason</Label>
                  <Textarea
                    value={legHoldReason}
                    onChange={(e) => setLegHoldReason(e.target.value)}
                    placeholder="Why is this leg on hold? (e.g. waiting on driver statement)"
                    data-testid="input-leg-hold-reason"
                  />
                </div>
                <div>
                  <Label className="text-xs">Pending from (optional)</Label>
                  <Input
                    value={legHoldPendingFrom}
                    onChange={(e) => setLegHoldPendingFrom(e.target.value)}
                    placeholder="Person or department"
                    data-testid="input-leg-hold-pending-from"
                  />
                </div>
                {legActionError && (
                  <div className="text-xs text-destructive">{legActionError}</div>
                )}
                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="ghost" onClick={closeLegHoldDialog}>Cancel</Button>
                  <Button
                    onClick={handlePlaceLegHold}
                    disabled={!legHoldReason.trim() || placeLegHold.isPending}
                    data-testid="btn-confirm-leg-hold"
                  >
                    {placeLegHold.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <PauseCircle className="h-4 w-4 mr-1" />}
                    Place on Hold
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>

          {responses.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Inbox className="h-5 w-5" />
                  Responses Received
                  <Badge variant="secondary">{responses.length}</Badge>
                </CardTitle>
                {group.closureReason && (
                  <CardDescription
                    data-testid="responses-closure-reason"
                    className="pt-1"
                  >
                    Closure reason: <span className="font-medium">{closureReasonLabel(group.closureReason)}</span>
                  </CardDescription>
                )}
              </CardHeader>
              <CardContent className="space-y-3">
                {responses.map((resp) => {
                  const typeColors: Record<string, string> = {
                    approval: "bg-green-50 border-green-200 text-green-800",
                    denial: "bg-red-50 border-red-200 text-red-800",
                    partial_approval: "bg-amber-50 border-amber-200 text-amber-800",
                    info_request: "bg-blue-50 border-blue-200 text-blue-800",
                    acknowledgment: "bg-slate-50 border-slate-200 text-slate-700",
                    other: "bg-gray-50 border-gray-200 text-gray-700",
                  };
                  const typeLabels: Record<string, string> = {
                    approval: "Approved",
                    denial: "Denied",
                    partial_approval: "Partially Approved",
                    info_request: "Info Requested",
                    acknowledgment: "Acknowledged",
                    other: "Other",
                  };
                  const colorClass = typeColors[resp.responseType] || typeColors.other;
                  return (
                    <div key={resp.id} className={`border rounded-lg p-4 space-y-2 ${colorClass}`}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          {resp.source === "email" ? (
                            <Mail className="h-4 w-4" />
                          ) : (
                            <Bot className="h-4 w-4" />
                          )}
                          <span className="text-sm font-medium">
                            {resp.source === "email" ? "Email" : "Portal"} Response
                          </span>
                          <Badge variant="outline" className="text-xs">
                            {typeLabels[resp.responseType] || resp.responseType}
                          </Badge>
                          {!resp.processed && (
                            <Badge variant="secondary" className="text-xs bg-yellow-100 text-yellow-800">
                              Needs Review
                            </Badge>
                          )}
                        </div>
                        <span className="text-xs opacity-70">
                          {resp.receivedAt ? formatDateTime(resp.receivedAt) : ""}
                        </span>
                      </div>

                      {resp.subject && (
                        <p className="text-sm font-medium">{resp.subject}</p>
                      )}

                      {(() => {
                        const fullBody = (resp.rawContent && resp.rawContent.trim().length > 0)
                          ? resp.rawContent
                          : (resp.content || "");
                        if (!fullBody) return null;
                        const isLong = fullBody.length > 400 || fullBody.split("\n").length > 6;
                        const isExpanded = expandedResponseIds.has(resp.id);
                        const isHtml = resp.bodyFormat === "html";
                        const sanitizedHtml = isHtml
                          ? DOMPurify.sanitize(fullBody, {
                              ALLOWED_TAGS: ["p", "br", "strong", "em", "u", "b", "i", "ul", "ol", "li", "a", "blockquote", "pre", "code", "h1", "h2", "h3", "h4", "h5", "h6", "span", "div"],
                              ALLOWED_ATTR: ["href", "target", "rel"],
                            })
                          : "";
                        return (
                          <div className="space-y-1">
                            {isHtml ? (
                              <div
                                className={`text-sm bg-white/60 border border-current/10 rounded-md p-3 break-words font-sans overflow-y-auto prose prose-sm max-w-none ${
                                  isExpanded ? "max-h-[32rem]" : "max-h-32"
                                }`}
                                // Sanitized via DOMPurify above with a strict tag/attr allow-list.
                                dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
                              />
                            ) : (
                              <div
                                className={`text-sm bg-white/60 border border-current/10 rounded-md p-3 whitespace-pre-wrap break-words font-sans overflow-y-auto ${
                                  isExpanded ? "max-h-[32rem]" : "max-h-32"
                                }`}
                              >
                                {fullBody}
                              </div>
                            )}
                            {isLong && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 px-2 text-xs opacity-70 hover:opacity-100"
                                onClick={() => toggleResponseExpanded(resp.id)}
                              >
                                {isExpanded ? "Show less" : "Show full message"}
                              </Button>
                            )}
                          </div>
                        );
                      })()}

                      {(resp.senderEmail || resp.matchedVia) && (
                        <div className="flex items-center gap-3 text-xs opacity-60">
                          {resp.senderEmail && (
                            <span>From: {resp.senderName || resp.senderEmail}</span>
                          )}
                          {resp.matchedVia && (
                            <span>Matched: {resp.matchedVia}</span>
                          )}
                        </div>
                      )}

                      <div className="flex items-center gap-2 pt-1 flex-wrap">
                        {!resp.processed && (
                          <>
                            <Button
                              size="sm" variant="outline"
                              className="text-xs h-7 bg-green-100 hover:bg-green-200 text-green-800 border-green-300"
                              disabled={processResponseMutation.isPending}
                              onClick={async () => {
                                await processResponseMutation.mutateAsync({ id: resp.id, data: { responseType: "approval" } });
                                invalidateAfterResponseChange();
                              }}
                            >
                              <CheckCircle className="h-3 w-3 mr-1" /> Approve
                            </Button>
                            <Button
                              size="sm" variant="outline"
                              className="text-xs h-7 bg-red-100 hover:bg-red-200 text-red-800 border-red-300"
                              disabled={processResponseMutation.isPending}
                              onClick={async () => {
                                await processResponseMutation.mutateAsync({ id: resp.id, data: { responseType: "denial" } });
                                invalidateAfterResponseChange();
                              }}
                            >
                              <X className="h-3 w-3 mr-1" /> Deny
                            </Button>
                            <Button
                              size="sm" variant="outline"
                              className="text-xs h-7"
                              disabled={processResponseMutation.isPending}
                              onClick={async () => {
                                await processResponseMutation.mutateAsync({ id: resp.id, data: { responseType: resp.responseType as ProcessResponseBodyResponseType } });
                                invalidateAfterResponseChange();
                              }}
                            >
                              <Eye className="h-3 w-3 mr-1" /> Mark Reviewed
                            </Button>
                          </>
                        )}
                        <Button
                          size="sm" variant="ghost"
                          className="text-xs h-7 px-2 ml-auto opacity-70 hover:opacity-100"
                          onClick={() => {
                            setReassignTarget(resp);
                            setReassignTab("group");
                            setReassignSearch("");
                            setReassignSelectedGroupId(null);
                            setReassignSelectedClaimId(null);
                          }}
                        >
                          <ArrowRightLeft className="h-3 w-3 mr-1" /> Not the right group?
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          {group.status === "Needs Review" && (
            <Card className="border-blue-200 bg-blue-50/50">
              <CardHeader>
                <CardTitle className="text-sm">Triage Required</CardTitle>
                <CardDescription className="text-xs">This group has no error details — review on the portal and classify.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full"
                  onClick={() => handleTriage("non_issue")}
                  disabled={triageGroup.isPending}
                >
                  Non-Issue (Resolve)
                </Button>
                <Button
                  size="sm"
                  className="w-full"
                  onClick={() => handleTriage("issue_found")}
                  disabled={triageGroup.isPending}
                >
                  Issue Found
                </Button>
              </CardContent>
            </Card>
          )}

          {group.status === "On Hold" && (
            <Card className="border-yellow-200 bg-yellow-50/50">
              <CardHeader>
                <CardTitle className="text-sm">On Hold</CardTitle>
                <CardDescription className="text-xs">{group.holdReason || "No reason provided"}</CardDescription>
              </CardHeader>
              <CardContent>
                <Button
                  size="sm"
                  className="w-full"
                  onClick={handleRemoveHold}
                  disabled={removeHold.isPending}
                >
                  Remove Hold
                </Button>
              </CardContent>
            </Card>
          )}

          {(groupValidTransitions?.validOutcomes?.length ?? 0) > 0 && (() => {
            const outcomes = (groupValidTransitions?.validOutcomes || []) as string[];
            const closureOffered = outcomes.includes("Denied") || outcomes.includes("Withdrawn");
            const nonClosure = outcomes.filter((o) => o !== "Denied" && o !== "Withdrawn" && o !== "Pending");
            const hasResponse = groupValidTransitions?.hasResponse ?? !!groupValidTransitions?.latestResponseType;
            return (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Record Outcome</CardTitle>
                  <CardDescription className="text-xs">Set the final outcome for this invoice group.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  {nonClosure.map((o) => (
                    <Button
                      key={o}
                      size="sm"
                      variant={group.outcome === o ? "default" : "outline"}
                      className="w-full"
                      onClick={() => handleOutcome(o)}
                      disabled={updateOutcome.isPending}
                      data-testid={`button-group-outcome-${o.toLowerCase().replace(/\s+/g, "-")}`}
                    >
                      {o}
                    </Button>
                  ))}
                  {closureOffered && (
                    <TooltipProvider>
                      <div className="space-y-2 pt-1">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="block">
                              <Button
                                size="sm"
                                variant={group.outcome === "Denied" ? "default" : "outline"}
                                className="w-full"
                                onClick={() => handleOutcome("Denied")}
                                disabled={!hasResponse || updateOutcome.isPending}
                                data-testid="button-group-outcome-payer-denied"
                              >
                                Payer Denied
                              </Button>
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>
                            {hasResponse ? "Mark as denied based on the payer's recorded response." : "Disabled because no portal or email response has been recorded yet."}
                          </TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              size="sm"
                              variant={group.outcome === "Withdrawn" && group.closureReason === "not_contestable" ? "default" : "outline"}
                              className="w-full"
                              onClick={() => handleOutcome("Withdrawn", "not_contestable")}
                              disabled={updateOutcome.isPending}
                              data-testid="button-group-outcome-not-contestable"
                            >
                              Withdraw — Not Contestable
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Close because we decided not to dispute (no clear path to recover).</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              size="sm"
                              variant={group.outcome === "Withdrawn" && group.closureReason === "accepted_loss" ? "default" : "outline"}
                              className="w-full"
                              onClick={() => handleOutcome("Withdrawn", "accepted_loss")}
                              disabled={updateOutcome.isPending}
                              data-testid="button-group-outcome-accepted-loss"
                            >
                              Withdraw — Accepted Loss
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Close after a denial because we accept the loss and won't re-dispute.</TooltipContent>
                        </Tooltip>
                      </div>
                    </TooltipProvider>
                  )}
                </CardContent>
              </Card>
            );
          })()}

          {group.status !== "On Hold" && group.status !== "Resolved" && group.status !== "Denied" && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Place on Hold</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <Textarea
                  placeholder="Reason for hold..."
                  value={holdReason}
                  onChange={(e) => setHoldReason(e.target.value)}
                  rows={2}
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full"
                  onClick={handleHold}
                  disabled={holdGroup.isPending || !holdReason.trim()}
                >
                  Place on Hold
                </Button>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-sm">Activity</CardTitle>
              <Select value={activityFilter} onValueChange={(v) => setActivityFilter(v as ActionCategory | "all")}>
                <SelectTrigger className="h-7 w-[170px] text-xs" data-testid="select-activity-filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(ACTION_CATEGORY_LABELS) as Array<ActionCategory | "all">).map((key) => (
                    <SelectItem key={key} value={key} className="text-xs">
                      {ACTION_CATEGORY_LABELS[key]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardHeader>
            <CardContent>
              {(() => {
                type FeedItem =
                  | { kind: "audit"; id: number; timestamp: string; log: any; category: ActionCategory }
                  | { kind: "note"; id: number; timestamp: string; note: any };

                const feed: FeedItem[] = [
                  ...auditLogs.map((log: any) => {
                    const meta = humanizeAuditAction(log.action, "group");
                    return {
                      kind: "audit" as const,
                      id: log.id,
                      timestamp: log.timestamp,
                      log,
                      category: meta.category,
                    };
                  }),
                  ...notes.map((note: any) => ({
                    kind: "note" as const,
                    id: note.id,
                    timestamp: note.createdAt,
                    note,
                  })),
                ].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

                const filtered = activityFilter === "all"
                  ? feed
                  : feed.filter((item) =>
                      item.kind === "audit"
                        ? item.category === activityFilter
                        : activityFilter === "communication",
                    );

                if (filtered.length === 0) {
                  return activityFilter === "all" ? (
                    <EmptyState
                      icon={StickyNote}
                      title="No activity yet"
                      description="Status changes, notes, and edits on this group will appear here."
                      className="py-6"
                    />
                  ) : (
                    <EmptyState
                      icon={Filter}
                      title="No matching activity"
                      description="Try a different category to see more activity."
                      primaryAction={{ label: "Clear filter", onClick: () => setActivityFilter("all") }}
                      className="py-6"
                    />
                  );
                }

                return (
                  <div className="space-y-3 max-h-[400px] overflow-y-auto" data-testid="list-activity-feed">
                    {filtered.map((item) => {
                      if (item.kind === "audit") {
                        const meta = humanizeAuditAction(item.log.action, "group");
                        const Icon = meta.icon;
                        return (
                          <div key={`audit-${item.id}`} className="flex gap-2 border-l-2 border-muted pl-3 py-1">
                            <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${meta.iconClass}`} />
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-medium">{meta.label}</p>
                              {item.log.details && (
                                <p className="text-xs text-muted-foreground break-words">{item.log.details}</p>
                              )}
                              <p className="text-[10px] text-muted-foreground/60">
                                <span>{item.log.userName || item.log.userEmail || "System"} · </span>
                                {new Date(item.timestamp).toLocaleString()}
                              </p>
                            </div>
                          </div>
                        );
                      }
                      const isEmail = item.note.type === "email";
                      const Icon = isEmail ? Mail : StickyNote;
                      return (
                        <div key={`note-${item.id}`} className="flex gap-2 border-l-2 border-muted pl-3 py-1">
                          <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${isEmail ? "text-blue-600" : "text-amber-600"}`} />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium">
                              {isEmail ? "Email note" : "Note added"}
                              {item.note.emailSubject && (
                                <span className="text-muted-foreground font-normal"> · {item.note.emailSubject}</span>
                              )}
                            </p>
                            <p className="text-xs text-muted-foreground whitespace-pre-wrap break-words">{item.note.content}</p>
                            <p className="text-[10px] text-muted-foreground/60">
                              {item.note.author && <span>{item.note.author} · </span>}
                              {new Date(item.timestamp).toLocaleString()}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={!!reassignTarget} onOpenChange={(open) => { if (!open) setReassignTarget(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArrowRightLeft className="h-5 w-5" /> Reassign response
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Move this response to a different invoice group or claim, or unmatch it so it returns to the unmatched inbox.
            </p>

            <Tabs
              value={reassignTab}
              onValueChange={(v) => {
                setReassignTab(v as "group" | "claim");
                setReassignSearch("");
                setReassignSelectedGroupId(null);
                setReassignSelectedClaimId(null);
              }}
            >
              <TabsList className="grid grid-cols-2 w-full">
                <TabsTrigger value="group">Invoice group</TabsTrigger>
                <TabsTrigger value="claim">Claim</TabsTrigger>
              </TabsList>

              <TabsContent value="group" className="space-y-2 pt-3">
                <Label className="text-xs">Search for the correct invoice group</Label>
                <div className="relative">
                  <Search className="h-4 w-4 absolute left-2 top-2.5 text-muted-foreground" />
                  <Input
                    className="pl-8"
                    placeholder="Search by invoice #, client #, error details …"
                    value={reassignSearch}
                    onChange={(e) => { setReassignSearch(e.target.value); setReassignSelectedGroupId(null); }}
                  />
                </div>
                {reassignSearch.length >= 2 && reassignGroupsData?.groups && (
                  <div className="border rounded-md max-h-56 overflow-y-auto divide-y">
                    {reassignGroupsData.groups.length === 0 && (
                      <div className="p-3 text-xs text-muted-foreground">No invoice groups found.</div>
                    )}
                    {reassignGroupsData.groups
                      .filter((g: InvoiceGroupResponse) => g.id !== id)
                      .map((g: InvoiceGroupResponse) => (
                        <button
                          type="button"
                          key={g.id}
                          onClick={() => setReassignSelectedGroupId(g.id)}
                          className={`w-full text-left p-2 text-sm hover:bg-muted ${reassignSelectedGroupId === g.id ? "bg-blue-50" : ""}`}
                        >
                          <div className="font-medium">Invoice #{g.invoiceNumber} — {g.clientNumber || "—"}</div>
                          <div className="text-xs text-muted-foreground">
                            {g.rideCount ?? 0} ride{(g.rideCount ?? 0) !== 1 ? "s" : ""} · {g.status}
                          </div>
                        </button>
                      ))}
                  </div>
                )}
              </TabsContent>

              <TabsContent value="claim" className="space-y-2 pt-3">
                <Label className="text-xs">Search for the correct claim</Label>
                <div className="relative">
                  <Search className="h-4 w-4 absolute left-2 top-2.5 text-muted-foreground" />
                  <Input
                    className="pl-8"
                    placeholder="Search by ref #, conf #, client #, car # …"
                    value={reassignSearch}
                    onChange={(e) => { setReassignSearch(e.target.value); setReassignSelectedClaimId(null); }}
                  />
                </div>
                {reassignSearch.length >= 2 && reassignClaimsData?.claims && (
                  <div className="border rounded-md max-h-56 overflow-y-auto divide-y">
                    {reassignClaimsData.claims.length === 0 && (
                      <div className="p-3 text-xs text-muted-foreground">No claims found.</div>
                    )}
                    {reassignClaimsData.claims.map((c: ClaimResponse) => (
                      <button
                        type="button"
                        key={c.id}
                        onClick={() => setReassignSelectedClaimId(c.id)}
                        className={`w-full text-left p-2 text-sm hover:bg-muted ${reassignSelectedClaimId === c.id ? "bg-blue-50" : ""}`}
                      >
                        <div className="font-medium">Ref #{c.refNumber || c.id} — {c.clientNumber || "—"}</div>
                        <div className="text-xs text-muted-foreground">
                          Conf #{c.confNumber || "—"} · Car #{c.carNumber || "—"} · {c.status}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </TabsContent>
            </Tabs>

            <div className="flex gap-2 justify-between pt-2">
              <Button
                variant="outline"
                disabled={reassignResponseMutation.isPending}
                onClick={async () => {
                  if (!reassignTarget) return;
                  await reassignResponseMutation.mutateAsync({
                    id: reassignTarget.id,
                    data: { unmatch: true },
                  });
                  invalidateAfterResponseChange();
                  setReassignTarget(null);
                }}
              >
                <MailQuestion className="h-4 w-4 mr-1" /> Unmatch
              </Button>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => setReassignTarget(null)}>Cancel</Button>
                <Button
                  disabled={
                    reassignResponseMutation.isPending ||
                    (reassignTab === "group" ? !reassignSelectedGroupId : !reassignSelectedClaimId)
                  }
                  onClick={async () => {
                    if (!reassignTarget) return;
                    if (reassignTab === "group" && reassignSelectedGroupId) {
                      await reassignResponseMutation.mutateAsync({
                        id: reassignTarget.id,
                        data: { targetGroupId: reassignSelectedGroupId },
                      });
                    } else if (reassignTab === "claim" && reassignSelectedClaimId) {
                      await reassignResponseMutation.mutateAsync({
                        id: reassignTarget.id,
                        data: { targetClaimId: reassignSelectedClaimId },
                      });
                    } else {
                      return;
                    }
                    invalidateAfterResponseChange();
                    setReassignTarget(null);
                  }}
                >
                  Reassign
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
