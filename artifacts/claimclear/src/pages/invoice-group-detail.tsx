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
  usePlaceLegOnHold,
  useRemoveLegHold,
  useListErrorTypes,
  useCreateErrorType,
  getListErrorTypesQueryKey,
} from "@workspace/api-client-react";
import { closureReasonLabel } from "@/lib/closure-reasons";
import { isPerInvoiceTransitionEnabled } from "@/lib/feature-flags";
import { InvoiceGroupDetailV2 } from "@/components/invoice-group-detail-v2";
import { getGroupLifecyclePhase } from "@/lib/lifecycle-phase";
import { ClosureActions } from "@/components/closure/closure-actions";
import { usePresence } from "@/hooks/use-presence";
import { useInvoiceGroupEvents } from "@/hooks/use-claim-events";
import { HumanPresenceBanner } from "@/components/presence-banners";
import { PresenceLockWrapper, formatViewerNames } from "@/components/presence-lock";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { ClaimResponse, InvoiceGroupResponse, PortalResponseItem, ProcessResponseBodyResponseType, UpdateInvoiceGroupOutcomeBodyClosureReason, ErrorTypeResponse } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { Fragment, useState, type ReactNode } from "react";
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
  Mail,
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
  Send,
  SplitSquareHorizontal,
  Tag,
  Plus,
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { WrapTooltip } from "@/components/info-tooltip";
import { type ActionCategory } from "@/lib/audit-action-meta";
import { ActivityFeed } from "@/components/activity-feed";
import { StageStepper, type Stage } from "@/components/stage-stepper";
import { ActionsRail, ActionsRailRecommended, ActionGroup, ActionRow } from "@/components/actions-rail";

const GROUP_STAGE_KEYS = ["triage", "build", "submit", "await", "resolve"] as const;
type GroupStageKey = (typeof GROUP_STAGE_KEYS)[number];

function getRideStageKey(status: string): GroupStageKey {
  switch (status) {
    case "New":
    case "Needs Review":
      return "triage";
    case "Needs Evidence":
      return "build";
    case "Portal Queued":
    case "Generating Email":
      return "submit";
    case "Awaiting Response":
    case "Ready to Review":
      return "await";
    case "Resolved":
    case "Denied":
      return "resolve";
    case "On Hold":
      return "build";
    default:
      return "triage";
  }
}

// A leg is "disputed" iff it has an error_type_id assigned. Clean legs sit on
// the same invoice but were never part of any dispute — they must not drag the
// group's stage backwards. Per the rule "if any leg has an issue, the entire
// invoice cannot be submitted", the invoice's progress IS the slowest disputed
// leg's progress; clean legs are trivially done.
type RideForRollup = { status: string; errorTypeId?: string | null };

function getDisputedRides<T extends RideForRollup>(rides: T[]): T[] {
  return rides.filter((r) => r.errorTypeId != null);
}

function buildGroupStages(rides: RideForRollup[]): Stage[] {
  // Fall back to all rides only when nothing has been classified yet, so the
  // pre-classification view (everything at "triage") still renders sensibly
  // instead of dividing by zero.
  const disputed = getDisputedRides(rides);
  const consider = disputed.length > 0 ? disputed : rides;
  const total = consider.length;
  const stageIndex = (key: GroupStageKey) => GROUP_STAGE_KEYS.indexOf(key);
  const counts = GROUP_STAGE_KEYS.map((key) => {
    const idx = stageIndex(key);
    return consider.filter((r) => stageIndex(getRideStageKey(r.status)) >= idx).length;
  });
  const labels: Record<GroupStageKey, string> = {
    triage: "Classify",
    build: "Build Case",
    submit: "Submit",
    await: "Await Response",
    resolve: "Resolve",
  };
  return GROUP_STAGE_KEYS.map((key, i) => ({
    key,
    label: labels[key],
    done: counts[i],
    total,
  }));
}

function getGroupCurrentStageKey(groupStatus: string, rides: RideForRollup[]): GroupStageKey {
  if (groupStatus === "Resolved" || groupStatus === "Denied") return "resolve";
  const disputed = getDisputedRides(rides);
  // No disputed legs yet → the group's own status is the source of truth (it's
  // sitting in triage / needs review until classification happens).
  if (disputed.length === 0) return getRideStageKey(groupStatus);
  // The slowest disputed leg defines the invoice's stage — one stuck leg
  // blocks the whole submission, by design.
  let earliest: GroupStageKey = "resolve";
  for (const r of disputed) {
    const k = getRideStageKey(r.status);
    if (GROUP_STAGE_KEYS.indexOf(k) < GROUP_STAGE_KEYS.indexOf(earliest)) earliest = k;
  }
  return earliest;
}

export default function InvoiceGroupDetail() {
  const params = useParams<{ id: string }>();
  const id = parseInt(params.id || "0", 10);

  // PER_INVOICE_TRANSITION_ENABLED: when on, render the v2 group
  // orchestration surface (Aggregate Context · Legs Queue · Generate
  // Submission Preview). Otherwise fall through to the legacy page below.
  if (isPerInvoiceTransitionEnabled()) {
    return <InvoiceGroupDetailV2 groupId={id} />;
  }
  return <InvoiceGroupDetailLegacy groupId={id} />;
}

function InvoiceGroupDetailLegacy({ groupId: id }: { groupId: number }) {
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
  const createErrorType = useCreateErrorType();
  const { data: errorTypesData } = useListErrorTypes();
  const errorTypes: ErrorTypeResponse[] = errorTypesData ?? [];
  const { toast } = useToast();
  const holdGroup = useHoldInvoiceGroup();
  const removeHold = useRemoveInvoiceGroupHold();
  const placeLegHold = usePlaceLegOnHold();
  const removeLegHold = useRemoveLegHold();
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

  const { viewers, otherViewers, othersPresent } = usePresence("invoice_group", id > 0 ? id : undefined);
  useInvoiceGroupEvents(id > 0 ? id : undefined);
  const lockReason = othersPresent
    ? `Disabled — ${formatViewerNames(otherViewers)} ${otherViewers.length === 1 ? "is" : "are"} currently working on this group. Wait for them to leave or coordinate directly.`
    : null;

  const [showGroupErrorTypeSelector, setShowGroupErrorTypeSelector] = useState(false);
  const [showCreateGroupErrorType, setShowCreateGroupErrorType] = useState(false);
  const [newGroupErrorType, setNewGroupErrorType] = useState({ name: "", category: "", description: "" });
  const [groupErrorTypeAssigning, setGroupErrorTypeAssigning] = useState(false);
  const [groupErrorTypeError, setGroupErrorTypeError] = useState("");

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

  const handleAssignGroupErrorType = async (errorType: ErrorTypeResponse) => {
    setGroupErrorTypeAssigning(true);
    setGroupErrorTypeError("");
    try {
      await triageGroup.mutateAsync({
        id,
        data: {
          triageOutcome: "issue_found",
          errorTypeId: String(errorType.id),
          errorTypeName: errorType.name,
        },
      });
      invalidate();
      queryClient.invalidateQueries({ queryKey: getGetInvoiceGroupValidTransitionsQueryKey(id) });
      if (group && (group.status === "Needs Review" || group.status === "New")) {
        try {
          await updateStatus.mutateAsync({ id, data: { status: "Needs Evidence" } });
          invalidate();
        } catch {
          toast({
            title: "Couldn't move to Build Case",
            description: "Error type was saved, but the status update failed. Please try again.",
            variant: "destructive",
          });
        }
      }
      setShowGroupErrorTypeSelector(false);
      toast({ title: "Classified — moved to Build Case" });
    } catch {
      setGroupErrorTypeError("Failed to assign error type. Please try again.");
    } finally {
      setGroupErrorTypeAssigning(false);
    }
  };

  const handleCreateAndAssignGroupErrorType = async () => {
    if (!newGroupErrorType.name.trim()) return;
    setGroupErrorTypeAssigning(true);
    setGroupErrorTypeError("");
    try {
      const created = await createErrorType.mutateAsync({ data: newGroupErrorType });
      queryClient.invalidateQueries({ queryKey: getListErrorTypesQueryKey() });
      await handleAssignGroupErrorType(created);
      setShowCreateGroupErrorType(false);
      setNewGroupErrorType({ name: "", category: "", description: "" });
    } catch {
      setGroupErrorTypeError("Failed to create or assign error type. Please try again.");
    } finally {
      setGroupErrorTypeAssigning(false);
    }
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

  const handleStatusChange = async (newStatus: string) => {
    await updateStatus.mutateAsync({
      id,
      data: { status: newStatus },
    });
    invalidate();
    queryClient.invalidateQueries({ queryKey: getGetInvoiceGroupValidTransitionsQueryKey(id) });
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
      <HumanPresenceBanner viewers={viewers} resourceLabel="group" />
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

      <StageStepper
        stages={buildGroupStages(rides)}
        currentKey={getGroupCurrentStageKey(group.status, rides)}
        variant="group"
      />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-8 space-y-6">
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
                    <div className="grid gap-3 max-h-[28rem] overflow-y-auto pr-1" data-testid="evidence-list">
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
                              <PresenceLockWrapper reason={lockReason}>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6 text-destructive"
                                  onClick={() => handleDeleteEvidence(ev.id)}
                                  disabled={deleteEvidence.isPending || othersPresent}
                                  title="Delete evidence"
                                >
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                              </PresenceLockWrapper>
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
              <div className="overflow-x-auto overflow-y-auto max-h-[32rem]" data-testid="rides-table">
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
                                <PresenceLockWrapper reason={lockReason}>
                                  {isHeld ? (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => handleRemoveLegHold(ride.id)}
                                      disabled={removeLegHold.isPending || othersPresent}
                                      data-testid={`btn-remove-leg-hold-${ride.id}`}
                                    >
                                      <Play className="h-3.5 w-3.5 mr-1" />Remove Hold
                                    </Button>
                                  ) : (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => openLegHoldDialog(ride.id)}
                                      disabled={othersPresent}
                                      data-testid={`btn-hold-leg-${ride.id}`}
                                    >
                                      <PauseCircle className="h-3.5 w-3.5 mr-1" />Hold
                                    </Button>
                                  )}
                                </PresenceLockWrapper>
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
                  <PresenceLockWrapper reason={lockReason}>
                    <Button
                      onClick={handlePlaceLegHold}
                      disabled={!legHoldReason.trim() || placeLegHold.isPending || othersPresent}
                      data-testid="btn-confirm-leg-hold"
                    >
                      {placeLegHold.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <PauseCircle className="h-4 w-4 mr-1" />}
                      Place on Hold
                    </Button>
                  </PresenceLockWrapper>
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
              <CardContent className="space-y-3 max-h-[40rem] overflow-y-auto pr-1" data-testid="responses-list">
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
                          <PresenceLockWrapper reason={lockReason}>
                            <div className="flex flex-col gap-1.5">
                              <div className="text-xs text-muted-foreground">
                                Tag this response so a human can review it. The verdict still happens via the actions below — these buttons don&apos;t resolve or deny the group.
                              </div>
                              <div className="flex items-center gap-2 flex-wrap">
                                <Button
                                  size="sm" variant="outline"
                                  className="text-xs h-7 bg-green-100 hover:bg-green-200 text-green-800 border-green-300"
                                  disabled={processResponseMutation.isPending || othersPresent}
                                  title="Tag this response as an Approval hint and send it to human review. Does not resolve the group."
                                  onClick={async () => {
                                    await processResponseMutation.mutateAsync({ id: resp.id, data: { responseType: "approval" } });
                                    invalidateAfterResponseChange();
                                  }}
                                >
                                  <CheckCircle className="h-3 w-3 mr-1" /> Tag as Approval
                                </Button>
                                <Button
                                  size="sm" variant="outline"
                                  className="text-xs h-7 bg-red-100 hover:bg-red-200 text-red-800 border-red-300"
                                  disabled={processResponseMutation.isPending || othersPresent}
                                  title="Tag this response as a Denial hint and send it to human review. Does not deny the group."
                                  onClick={async () => {
                                    await processResponseMutation.mutateAsync({ id: resp.id, data: { responseType: "denial" } });
                                    invalidateAfterResponseChange();
                                  }}
                                >
                                  <X className="h-3 w-3 mr-1" /> Tag as Denial
                                </Button>
                                <Button
                                  size="sm" variant="outline"
                                  className="text-xs h-7"
                                  disabled={processResponseMutation.isPending || othersPresent}
                                  title="Keep the existing tag and mark the response reviewed. The group stays in Needs Review until you pick a verdict below."
                                  onClick={async () => {
                                    await processResponseMutation.mutateAsync({ id: resp.id, data: { responseType: resp.responseType as ProcessResponseBodyResponseType } });
                                    invalidateAfterResponseChange();
                                  }}
                                >
                                  <Eye className="h-3 w-3 mr-1" /> Mark Reviewed
                                </Button>
                              </div>
                            </div>
                          </PresenceLockWrapper>
                        )}
                        <PresenceLockWrapper reason={lockReason} className="ml-auto">
                          <Button
                            size="sm" variant="ghost"
                            className="text-xs h-7 px-2 opacity-70 hover:opacity-100"
                            disabled={othersPresent}
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
                        </PresenceLockWrapper>
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}
        </div>

        <div className="lg:col-span-4 space-y-6">
          <div className="lg:sticky lg:top-4 space-y-4">
            <ActionsRail
              variant="group"
              title="Take action"
              meta={`Step ${GROUP_STAGE_KEYS.indexOf(getGroupCurrentStageKey(group.status, rides)) + 1} of ${GROUP_STAGE_KEYS.length}`}
            >
              {(() => {
                // Phase, not status, drives the recommendation banner. The
                // group rolls up over disputed legs so a parked or stuck leg
                // surfaces here even when group.status looks fine.
                const phase = getGroupLifecyclePhase(group.status, rides);
                let recommended: { label: string; description: string } | null = null;
                if (phase === "pre-submit") {
                  recommended = group.status === "Needs Evidence"
                    ? { label: "Add evidence", description: "Gather supporting documents for this group." }
                    : { label: "Classify this claim", description: "Pick the Error Type that matches the rejection reason." };
                } else if (phase === "response-pending") {
                  recommended = { label: "Review payer response", description: "Tag the response with what you read, then pick a verdict below — the AI hint is just a suggestion, the human decides." };
                } else if (phase === "on-hold") {
                  recommended = { label: "Resume when ready", description: "Remove the hold to continue processing." };
                }
                return recommended ? (
                  <ActionsRailRecommended variant="group" label="Recommended next" description={recommended.description}>
                    <div className="text-sm font-semibold">{recommended.label}</div>
                  </ActionsRailRecommended>
                ) : null;
              })()}

              <ActionGroup label="Workflow">
                <div className="px-2 py-1.5">
                  {(groupValidTransitions?.validStatuses?.length ?? 0) > 0 ? (
                    <PresenceLockWrapper reason={lockReason} className="w-full">
                      <Select
                        onValueChange={handleStatusChange}
                        disabled={updateStatus.isPending || othersPresent}
                      >
                        <SelectTrigger className="w-full" data-testid="select-group-status">
                          <SelectValue placeholder="Change status" />
                        </SelectTrigger>
                        <SelectContent>
                          {(groupValidTransitions?.validStatuses || []).map((s: string) => (
                            <SelectItem key={s} value={s}>{s}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </PresenceLockWrapper>
                  ) : (
                    <WrapTooltip content={groupValidTransitions?.hasActiveSubmission ? "Status changes are locked while a portal submission is active." : "No status transitions available from the current state."}>
                      <span tabIndex={0} className="block w-full rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        <Select disabled>
                          <SelectTrigger className="w-full cursor-not-allowed"><SelectValue placeholder="Change status" /></SelectTrigger>
                          <SelectContent />
                        </Select>
                      </span>
                    </WrapTooltip>
                  )}
                </div>
              </ActionGroup>

              {group.status === "Needs Review" && (
                <ActionGroup label="Classify">
                  <PresenceLockWrapper reason={lockReason} className="w-full">
                    <ActionRow
                      icon={<Tag className="h-4 w-4" />}
                      label="Assign Error Type"
                      sub="Pick the Error Type — moves to Build Case automatically"
                      disabled={triageGroup.isPending || othersPresent}
                      onClick={() => setShowGroupErrorTypeSelector(true)}
                      testId="action-group-assign-error-type"
                    />
                  </PresenceLockWrapper>
                </ActionGroup>
              )}

              {(groupValidTransitions?.validOutcomes?.length ?? 0) > 0 && (() => {
                const outcomes = (groupValidTransitions?.validOutcomes || []) as string[];
                const closureOffered = outcomes.includes("Denied") || outcomes.includes("Withdrawn");
                const nonClosure = outcomes.filter((o) => o !== "Denied" && o !== "Withdrawn" && o !== "Pending");
                const hasResponse = groupValidTransitions?.hasResponse ?? !!groupValidTransitions?.latestResponseType;
                return (
                  <ActionGroup label="Resolve">
                    {nonClosure.map((o) => (
                      <PresenceLockWrapper key={o} reason={lockReason} className="w-full">
                        <ActionRow
                          label={o}
                          selected={group.outcome === o}
                          disabled={updateOutcome.isPending || othersPresent}
                          onClick={() => handleOutcome(o)}
                          testId={`action-group-outcome-${o.toLowerCase().replace(/\s+/g, "-")}`}
                        />
                      </PresenceLockWrapper>
                    ))}
                    {closureOffered && (
                      <>
                        <PresenceLockWrapper reason={lockReason} className="w-full">
                          <ActionRow
                            label="Denied by Payor"
                            selected={group.outcome === "Denied"}
                            disabled={!hasResponse || updateOutcome.isPending || othersPresent}
                            disabledReason={hasResponse ? undefined : "Disabled because no portal or email response has been recorded yet."}
                            onClick={() => handleOutcome("Denied")}
                            testId="action-group-outcome-denied-by-payor"
                          />
                        </PresenceLockWrapper>
                        <ClosureActions
                          target={{ kind: "invoice_group", id }}
                          outcome={group.outcome}
                          closureReason={group.closureReason}
                          triggers={[
                            {
                              reason: "denied_by_payor",
                              label: "Denied by Payor (with reason)",
                              sub: "Payor formally denied — recorded response required",
                              disabled: !hasResponse || updateOutcome.isPending || othersPresent,
                              disabledReason: hasResponse
                                ? "Close because the payor formally denied this group (no further dispute)."
                                : "Disabled because no portal or email response has been recorded yet.",
                              testId: "action-group-outcome-denied-by-payor-closure",
                              wrap: (node) => (
                                <PresenceLockWrapper reason={lockReason} className="w-full">
                                  {node}
                                </PresenceLockWrapper>
                              ),
                            },
                            // Cannot Dispute is only valid pre-submission; once
                            // any portal_submission exists for the group the
                            // server will reject it, so we hide the trigger.
                            ...(groupValidTransitions?.hasBeenSubmitted ? [] : [{
                              reason: "cannot_dispute" as const,
                              label: "Withdraw — Cannot Dispute",
                              sub: "No clear path to recover",
                              disabled: updateOutcome.isPending || othersPresent,
                              disabledReason:
                                "Close because we decided not to dispute (no clear path to recover).",
                              testId: "action-group-outcome-cannot-dispute",
                              wrap: (node: ReactNode) => (
                                <PresenceLockWrapper reason={lockReason} className="w-full">
                                  {node}
                                </PresenceLockWrapper>
                              ),
                            }]),
                          ]}
                        />
                      </>
                    )}
                  </ActionGroup>
                );
              })()}

              <ActionGroup label="Pause / Change">
                {group.status === "On Hold" ? (
                  <PresenceLockWrapper reason={lockReason} className="w-full">
                    <ActionRow
                      icon={<Play className="h-4 w-4" />}
                      label="Remove hold"
                      sub={group.holdReason || "Resume processing"}
                      disabled={removeHold.isPending || othersPresent}
                      onClick={handleRemoveHold}
                      testId="action-group-remove-hold"
                    />
                  </PresenceLockWrapper>
                ) : group.status !== "Resolved" && group.status !== "Denied" ? (
                  <div className="px-2 py-1.5 space-y-2">
                    <Textarea
                      placeholder="Reason for hold..."
                      value={holdReason}
                      onChange={(e) => setHoldReason(e.target.value)}
                      rows={2}
                      className="text-sm"
                    />
                    <PresenceLockWrapper reason={lockReason} className="w-full">
                      <ActionRow
                        icon={<PauseCircle className="h-4 w-4" />}
                        label="Place on hold"
                        sub="Pause processing for this group"
                        disabled={holdGroup.isPending || !holdReason.trim() || othersPresent}
                        onClick={handleHold}
                        testId="action-group-place-hold"
                      />
                    </PresenceLockWrapper>
                  </div>
                ) : (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">
                    No further actions — group is {group.status.toLowerCase()}.
                  </div>
                )}
              </ActionGroup>
            </ActionsRail>
          </div>

          <ActivityFeed
            auditLogs={auditLogs}
            notes={notes}
            kind="group"
            filter={activityFilter}
            onFilterChange={setActivityFilter}
          />
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
              <PresenceLockWrapper reason={lockReason}>
                <Button
                  variant="outline"
                  disabled={reassignResponseMutation.isPending || othersPresent}
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
              </PresenceLockWrapper>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => setReassignTarget(null)}>Cancel</Button>
                <PresenceLockWrapper reason={lockReason}>
                  <Button
                    disabled={
                      reassignResponseMutation.isPending ||
                      othersPresent ||
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
                </PresenceLockWrapper>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showGroupErrorTypeSelector} onOpenChange={(open) => {
        setShowGroupErrorTypeSelector(open);
        if (!open) {
          setShowCreateGroupErrorType(false);
          setNewGroupErrorType({ name: "", category: "", description: "" });
          setGroupErrorTypeError("");
        }
      }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Assign Error Type</DialogTitle>
            <p className="text-xs text-muted-foreground">
              Pick the Error Type that matches the rejection reason. The group moves to Build Case automatically.
            </p>
          </DialogHeader>
          {groupErrorTypeError && (
            <div className="bg-red-50 text-red-800 text-sm p-2 rounded border border-red-200">
              {groupErrorTypeError}
            </div>
          )}
          {!showCreateGroupErrorType ? (
            <div className="space-y-3">
              <div className="max-h-[300px] overflow-y-auto space-y-1">
                {errorTypes.map((et) => (
                  <button
                    key={et.id}
                    className={`w-full text-left px-3 py-2 rounded-md text-sm hover:bg-muted transition-colors flex items-center justify-between ${
                      String(group.errorTypeId) === String(et.id) ? "bg-primary/10 border border-primary/30" : "border border-transparent"
                    }`}
                    onClick={() => handleAssignGroupErrorType(et)}
                    disabled={groupErrorTypeAssigning}
                    data-testid={`button-group-pick-error-type-${et.id}`}
                  >
                    <div>
                      <p className="font-medium">{et.name}</p>
                      {et.category && <p className="text-xs text-muted-foreground">{et.category}</p>}
                    </div>
                    {String(group.errorTypeId) === String(et.id) && (
                      <CheckCircle className="h-4 w-4 text-primary" />
                    )}
                  </button>
                ))}
                {errorTypes.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-4">No error types defined yet.</p>
                )}
              </div>
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => setShowCreateGroupErrorType(true)}
              >
                <Plus className="h-4 w-4 mr-1" />
                Create New Error Type
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <Label>Name <span className="text-destructive">*</span></Label>
                <Input
                  value={newGroupErrorType.name}
                  onChange={e => setNewGroupErrorType({ ...newGroupErrorType, name: e.target.value })}
                  placeholder="e.g. Duplicate Charge"
                  className="mt-1"
                />
              </div>
              <div>
                <Label>Category</Label>
                <Input
                  value={newGroupErrorType.category}
                  onChange={e => setNewGroupErrorType({ ...newGroupErrorType, category: e.target.value })}
                  placeholder="e.g. Billing"
                  className="mt-1"
                />
              </div>
              <div>
                <Label>Description</Label>
                <Textarea
                  value={newGroupErrorType.description}
                  onChange={e => setNewGroupErrorType({ ...newGroupErrorType, description: e.target.value })}
                  placeholder="Describe this error type..."
                  className="mt-1"
                  rows={3}
                />
              </div>
              <div className="flex gap-2">
                <Button
                  onClick={handleCreateAndAssignGroupErrorType}
                  disabled={!newGroupErrorType.name.trim() || groupErrorTypeAssigning}
                  className="flex-1"
                >
                  {groupErrorTypeAssigning ? "Saving..." : "Create & Assign"}
                </Button>
                <Button variant="ghost" onClick={() => setShowCreateGroupErrorType(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

    </div>
  );
}
