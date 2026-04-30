import { useState, useEffect } from "react";
import { useParams, useLocation, Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import DOMPurify from "dompurify";
import {
  useGetClaim, getGetClaimQueryKey,
  useUpdateClaim, useUpdateClaimStatus, useUpdateClaimOutcome,
  useUpdateClaimEvidence, usePlaceClaimOnHold, useRemoveClaimHold,
  useUpdateClaimWorkflow, useGenerateClaimEmail,
  useListClaimNotes, getListClaimNotesQueryKey, useCreateClaimNote,
  useListClaimAuditLogs, getListClaimAuditLogsQueryKey,
  useCreatePortalSubmission,
  useListPortalSubmissions, getListPortalSubmissionsQueryKey,
  useListBotActivity, getListBotActivityQueryKey,
  useListClaimEvidence, getListClaimEvidenceQueryKey,
  useDeleteClaimEvidence,
  useListErrorTypes, getListErrorTypesQueryKey, useCreateErrorType,
  useListResponses, getListResponsesQueryKey, useProcessResponse,
  useGetClaimValidTransitions, getGetClaimValidTransitionsQueryKey,
  usePostResponseAction,
  useReassignResponse,
  useGetClaimEmailThread, getGetClaimEmailThreadQueryKey,
  useListClaims,
  useGetInvoiceGroup, getGetInvoiceGroupQueryKey,
} from "@workspace/api-client-react";
import type { PortalSubmissionResponse, BotActivityLogResponse, ErrorTypeResponse, PortalResponseItem, EmailThreadMessage, UpdateClaimOutcomeBodyClosureReason } from "@workspace/api-client-react";
import { StatusBadge } from "@/components/status-badge";
import { usePresence } from "@/hooks/use-presence";
import { useClaimEvents } from "@/hooks/use-claim-events";
import { HumanPresenceBanner, BotPresenceBanner, PresenceAvatars } from "@/components/presence-banners";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/format";
import {
  Edit2, Save, X, Trash2, Send, PauseCircle, Play,
  Bot, CheckCircle, AlertTriangle, Clock, Image, FileText,
  ChevronRight, ArrowRight, Eye, Tag, Plus, Loader2, TreeDeciduous, Mail, Inbox,
  ArrowRightLeft, MailQuestion, MessagesSquare, Search
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { InfoTooltip, WrapTooltip } from "@/components/info-tooltip";
import { type ActionCategory } from "@/lib/audit-action-meta";
import { ActivityFeed } from "@/components/activity-feed";
import { RefNumber } from "@/components/ref-number";
import { closureReasonLabel } from "@/lib/closure-reasons";
import { WorkflowPlayer } from "@/components/workflow-player";
import { PortalSubmissionDrawer } from "@/components/portal-submission-drawer";
import { StageStepper, type Stage } from "@/components/stage-stepper";
import { ActionsRail, ActionsRailRecommended, ActionGroup, ActionRow } from "@/components/actions-rail";
import { ClosureIntakeDialog } from "@/components/closure/closure-intake-dialog";
import type { ClosureReasonKey } from "@/components/closure/closure-options";
import { XCircle, FileX } from "lucide-react";

const CLAIM_STAGES: Stage[] = [
  { key: "triage", label: "Classify", desc: "Identify the error" },
  { key: "build", label: "Build Case", desc: "Gather evidence" },
  { key: "submit", label: "Submit", desc: "Send to payer" },
  { key: "await", label: "Await Response", desc: "Track payer reply" },
  { key: "resolve", label: "Resolve", desc: "Close the loop" },
];

function getClaimStageKey(status: string): string {
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

function SubmissionCard({ submission: sub }: { submission: PortalSubmissionResponse }) {
  const [showDescription, setShowDescription] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const canPreview = sub.status === "draft" || sub.status === "pending";
  const { data: botActivity } = useListBotActivity(sub.id, {
    query: { queryKey: getListBotActivityQueryKey(sub.id), enabled: !!sub.id }
  });

  const statusVariant = sub.status === "submitted" ? "default" :
    sub.status === "failed" ? "destructive" :
    sub.status === "draft" ? "outline" :
    sub.status === "dry_run" ? "outline" :
    "secondary";

  const statusClass = sub.status === "dry_run" ? "border-amber-500 text-amber-700 bg-amber-50" :
    sub.status === "draft" ? "border-blue-400 text-blue-700 bg-blue-50" : undefined;

  return (
    <div className="border rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Submission #{sub.id}</span>
          <Badge variant={statusVariant} className={statusClass}>
            {sub.status === "submitted" && <CheckCircle className="h-3 w-3 mr-1" />}
            {sub.status === "failed" && <AlertTriangle className="h-3 w-3 mr-1" />}
            {sub.status === "pending" && <Clock className="h-3 w-3 mr-1" />}
            {sub.status === "draft" && <Edit2 className="h-3 w-3 mr-1" />}
            {sub.status === "dry_run" && <Eye className="h-3 w-3 mr-1" />}
            {sub.status === "dry_run" ? "Dry Run" : sub.status === "draft" ? "Draft" : sub.status}
          </Badge>
        </div>
        <span className="text-xs text-muted-foreground">
          {sub.createdAt ? formatDateTime(sub.createdAt) : ""}
        </span>
      </div>

      {sub.portalTicketId && (
        <div className="bg-green-50 text-green-800 p-2 rounded text-sm">
          Portal Ticket: <span className="font-mono font-semibold">{sub.portalTicketId}</span>
        </div>
      )}

      {sub.errorMessage && (
        <div className="bg-red-50 text-red-800 p-2 rounded text-sm">
          Error: {sub.errorMessage}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
        {sub.issueType && <div>Issue Type: {sub.issueType}</div>}
        {sub.subject && <div className="col-span-2">Subject: {sub.subject}</div>}
        <div>Attempts: {sub.attempts}</div>
        {sub.submittedAt && <div>Submitted: {formatDateTime(sub.submittedAt)}</div>}
      </div>

      {canPreview && (
        <div>
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => setPreviewOpen(true)}>
            <Eye className="h-3.5 w-3.5" /> Preview submission
          </Button>
        </div>
      )}

      <PortalSubmissionDrawer
        submissionId={sub.id}
        initialSubmission={sub}
        open={previewOpen}
        onOpenChange={setPreviewOpen}
      />

      {sub.descriptionHtml && (
        <div>
          <button
            onClick={() => setShowDescription(!showDescription)}
            className="text-xs text-primary hover:underline flex items-center gap-1"
          >
            <Eye className="h-3 w-3" />
            {showDescription ? "Hide" : "Show"} Dispute Text
          </button>
          {showDescription && (
            <div className="mt-2 bg-muted/50 p-3 rounded-md text-sm whitespace-pre-wrap border">
              {sub.descriptionHtml}
            </div>
          )}
        </div>
      )}

      {botActivity && botActivity.length > 0 && (
        <div className="mt-3 border-t pt-3">
          <Label className="text-xs font-medium text-muted-foreground mb-2 block">Bot Activity Timeline</Label>
          <div className="space-y-2">
            {botActivity.map((log: BotActivityLogResponse) => (
              <div
                key={log.id}
                className={`flex items-start gap-2 text-xs border-l-2 pl-2 py-1 ${
                  log.success ? "border-green-400" : "border-red-400"
                }`}
              >
                <div className="shrink-0 mt-0.5">
                  {log.success ? (
                    <CheckCircle className="h-3.5 w-3.5 text-green-600" />
                  ) : (
                    <AlertTriangle className="h-3.5 w-3.5 text-red-600" />
                  )}
                </div>
                <div className="flex-1">
                  <span className="font-medium">{log.action}</span>
                  {log.message && (
                    <p className="text-muted-foreground mt-0.5">{log.message}</p>
                  )}
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-muted-foreground/70">
                      {log.createdAt ? formatDateTime(log.createdAt) : ""}
                    </span>
                    {log.screenshotPath && (
                      <Badge variant="outline" className="text-[10px] py-0">
                        <Image className="h-2.5 w-2.5 mr-0.5" />Screenshot
                      </Badge>
                    )}
                    {log.pageHtmlPath && (
                      <Badge variant="outline" className="text-[10px] py-0">
                        <FileText className="h-2.5 w-2.5 mr-0.5" />HTML
                      </Badge>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function ClaimDetail() {
  const params = useParams<{ id: string }>();
  const claimId = parseInt(params.id || "0", 10);
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();

  const { data: claim, isLoading } = useGetClaim(claimId, { query: { queryKey: getGetClaimQueryKey(claimId), enabled: !!claimId } });
  const { data: notes } = useListClaimNotes(claimId, { query: { queryKey: getListClaimNotesQueryKey(claimId), enabled: !!claimId } });
  const { data: auditLogs } = useListClaimAuditLogs(claimId, { query: { queryKey: getListClaimAuditLogsQueryKey(claimId), enabled: !!claimId } });

  // Pull the parent invoice group so we can render the persistent context strip
  // (invoice #, ride count, total, link back). Disabled until the claim itself
  // has loaded and we know whether it actually has a parent group.
  const parentGroupId = claim?.invoiceGroupId ?? null;
  const { data: parentGroup } = useGetInvoiceGroup(parentGroupId ?? 0, {
    query: {
      queryKey: getGetInvoiceGroupQueryKey(parentGroupId ?? 0),
      enabled: parentGroupId !== null && parentGroupId > 0,
    },
  });

  const { viewers, botActivity: botPresenceActivity } = usePresence("claim", claimId);
  useClaimEvents(claimId);

  const { data: collectedEvidence } = useListClaimEvidence(claimId, {
    query: { queryKey: getListClaimEvidenceQueryKey(claimId), enabled: !!claimId },
  });
  const deleteEvidence = useDeleteClaimEvidence();

  const updateClaim = useUpdateClaim();
  const updateStatus = useUpdateClaimStatus();
  const updateOutcome = useUpdateClaimOutcome();
  const updateEvidence = useUpdateClaimEvidence();
  const placeHold = usePlaceClaimOnHold();
  const removeHold = useRemoveClaimHold();
  const createNote = useCreateClaimNote();
  const generateEmail = useGenerateClaimEmail();
  const createSubmission = useCreatePortalSubmission();

  const { data: errorTypesData } = useListErrorTypes();
  const errorTypes: ErrorTypeResponse[] = errorTypesData ?? [];
  const createErrorType = useCreateErrorType();

  const [showErrorTypeSelector, setShowErrorTypeSelector] = useState(false);
  const [showCreateErrorType, setShowCreateErrorType] = useState(false);
  const [newErrorType, setNewErrorType] = useState({ name: "", category: "", description: "" });
  const [errorTypeAssigning, setErrorTypeAssigning] = useState(false);
  const [errorTypeError, setErrorTypeError] = useState("");
  const { data: portalSubmissions } = useListPortalSubmissions(
    undefined,
    { query: { queryKey: getListPortalSubmissionsQueryKey(), enabled: !!claimId } }
  );

  const claimSubmissions = (portalSubmissions || []).filter(
    (s: PortalSubmissionResponse) => s.claimId === claimId
  );

  const hasActivePortalSubmission = claimSubmissions.some(
    (s: PortalSubmissionResponse) => s.status === "pending" || s.status === "in_progress"
  );

  const { data: validTransitions } = useGetClaimValidTransitions(claimId, {
    query: { queryKey: getGetClaimValidTransitionsQueryKey(claimId), enabled: !!claimId },
  });

  const { data: responsesData } = useListResponses({ claimId }, {
    query: { queryKey: getListResponsesQueryKey({ claimId }), enabled: !!claimId }
  });
  const claimResponses: PortalResponseItem[] = responsesData?.responses || [];
  const processResponseMutation = useProcessResponse();
  const postResponseActionMutation = usePostResponseAction();
  const reassignResponseMutation = useReassignResponse();

  const { data: emailThreadData } = useGetClaimEmailThread(claimId, {
    query: { queryKey: getGetClaimEmailThreadQueryKey(claimId), enabled: !!claimId },
  });
  const emailThread: EmailThreadMessage[] = emailThreadData?.messages || [];

  const [reassignTarget, setReassignTarget] = useState<PortalResponseItem | null>(null);
  const [reassignSearch, setReassignSearch] = useState("");
  const [reassignSelectedClaimId, setReassignSelectedClaimId] = useState<number | null>(null);
  const [expandedResponseIds, setExpandedResponseIds] = useState<Set<number>>(new Set());
  const toggleResponseExpanded = (id: number) => {
    setExpandedResponseIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const reassignListParams = { search: reassignSearch || undefined, limit: 10 };
  const { data: reassignClaimsData } = useListClaims(
    reassignListParams,
    { query: { queryKey: ["reassignClaimSearch", reassignSearch], enabled: !!reassignTarget && reassignSearch.length >= 2 } }
  );

  interface ClaimEditData {
    confNumber: string;
    date: string;
    refNumber: string;
    clientNumber: string;
    carNumber: string;
    errorDetails: string;
    claimAmount: string;
    payorEmail: string;
    [key: string]: string;
  }

  const [editing, setEditing] = useState(false);
  const [editData, setEditData] = useState<ClaimEditData>({
    confNumber: "", date: "", refNumber: "", clientNumber: "",
    carNumber: "", errorDetails: "", claimAmount: "", payorEmail: "",
  });
  const [noteContent, setNoteContent] = useState("");
  const [holdReason, setHoldReason] = useState("");
  const [holdPending, setHoldPending] = useState("");
  const [showHoldDialog, setShowHoldDialog] = useState(false);
  const [postResponseNotes, setPostResponseNotes] = useState("");
  const [activityFilter, setActivityFilter] = useState<ActionCategory | "all">("all");
  const [closureDialog, setClosureDialog] = useState<{ reason: ClosureReasonKey } | null>(null);

  useEffect(() => {
    if (claim) {
      setEditData({
        confNumber: claim.confNumber,
        date: claim.date || "",
        refNumber: claim.refNumber || "",
        clientNumber: claim.clientNumber || "",
        carNumber: claim.carNumber || "",
        errorDetails: claim.errorDetails || "",
        claimAmount: claim.claimAmount || "",
        payorEmail: claim.payorEmail || "",
      });
    }
  }, [claim]);

  if (isLoading) return <div className="flex items-center justify-center p-12">Loading...</div>;
  if (!claim) return <div className="p-12 text-center text-muted-foreground">Claim not found</div>;

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getGetClaimQueryKey(claimId) });
    queryClient.invalidateQueries({ queryKey: getListClaimNotesQueryKey(claimId) });
    queryClient.invalidateQueries({ queryKey: getListClaimAuditLogsQueryKey(claimId) });
    queryClient.invalidateQueries({ queryKey: getGetClaimValidTransitionsQueryKey(claimId) });
  };

  const handleAssignErrorType = async (errorType: ErrorTypeResponse) => {
    setErrorTypeAssigning(true);
    setErrorTypeError("");
    try {
      await updateClaim.mutateAsync({
        id: claimId,
        data: { errorTypeId: String(errorType.id), errorTypeName: errorType.name },
      });
      invalidate();
      setShowErrorTypeSelector(false);
    } catch {
      setErrorTypeError("Failed to assign error type. Please try again.");
    } finally {
      setErrorTypeAssigning(false);
    }
  };

  const handleCreateAndAssignErrorType = async () => {
    if (!newErrorType.name.trim()) return;
    setErrorTypeAssigning(true);
    setErrorTypeError("");
    try {
      const created = await createErrorType.mutateAsync({ data: newErrorType });
      queryClient.invalidateQueries({ queryKey: getListErrorTypesQueryKey() });
      await updateClaim.mutateAsync({
        id: claimId,
        data: { errorTypeId: String(created.id), errorTypeName: created.name },
      });
      invalidate();
      setShowCreateErrorType(false);
      setShowErrorTypeSelector(false);
      setNewErrorType({ name: "", category: "", description: "" });
    } catch {
      setErrorTypeError("Failed to create or assign error type. Please try again.");
    } finally {
      setErrorTypeAssigning(false);
    }
  };

  const handleSave = async () => {
    await updateClaim.mutateAsync({ id: claimId, data: editData });
    setEditing(false);
    invalidate();
  };

  const handleStatusChange = async (status: string) => {
    await updateStatus.mutateAsync({ id: claimId, data: { status } });
    invalidate();
  };

  const handleOutcomeChange = async (
    outcome: string,
    closureReason?: UpdateClaimOutcomeBodyClosureReason,
  ) => {
    const approvedAmount = outcome === "Approved" ? claim.claimAmount || "0" : outcome === "Partially Approved" ? "" : undefined;
    await updateOutcome.mutateAsync({ id: claimId, data: { outcome, approvedAmount, closureReason } });
    invalidate();
  };

  const handleAddNote = async () => {
    if (!noteContent.trim()) return;
    await createNote.mutateAsync({ id: claimId, data: { content: noteContent } });
    setNoteContent("");
    invalidate();
  };

  const handlePlaceHold = async () => {
    await placeHold.mutateAsync({ id: claimId, data: { holdReason, holdPendingFrom: holdPending } });
    setShowHoldDialog(false);
    setHoldReason("");
    setHoldPending("");
    invalidate();
  };

  const handleRemoveHold = async () => {
    await removeHold.mutateAsync({ id: claimId });
    invalidate();
  };

  const handleQueueForPortal = async () => {
    await createSubmission.mutateAsync({ data: { claimId } });
    invalidate();
  };

  return (
    <div className="space-y-6">
      <HumanPresenceBanner viewers={viewers} />
      <BotPresenceBanner botActivity={botPresenceActivity} />

      {parentGroup && (
        <div
          className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border border-border bg-muted/40 px-4 py-2 text-sm"
          data-testid="invoice-context-strip"
        >
          <Link
            href={`/invoice-groups/${parentGroup.id}`}
            className="flex items-center gap-1.5 font-medium text-primary hover:underline"
            data-testid="link-parent-invoice"
          >
            <FileText className="h-4 w-4" />
            <span className="font-mono">Invoice #{parentGroup.invoiceNumber}</span>
            <ChevronRight className="h-3.5 w-3.5 opacity-70" />
          </Link>
          <span className="text-muted-foreground">
            {parentGroup.rideCount} ride{parentGroup.rideCount === 1 ? "" : "s"}
          </span>
          <span className="text-muted-foreground">
            Total {formatCurrency(parentGroup.totalAmount)}
          </span>
          <Link
            href={`/invoice-groups/${parentGroup.id}`}
            className="ml-auto text-xs text-primary hover:underline"
            data-testid="link-back-to-group"
          >
            View invoice group →
          </Link>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h2 className="text-2xl font-bold tracking-tight font-mono">{claim.confNumber}</h2>
          <StatusBadge status={claim.status} />
          <Badge variant="outline">{claim.outcome}</Badge>
          {claim.closureReason && (
            <Badge variant="secondary" data-testid="badge-closure-reason">
              {closureReasonLabel(claim.closureReason)}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <PresenceAvatars viewers={viewers} />
          {!editing ? (
            <WrapTooltip content="Edit this claim's details such as confirmation number, date, amount, and error details.">
              <Button variant="outline" size="sm" onClick={() => setEditing(true)}><Edit2 className="h-4 w-4 mr-1" />Edit</Button>
            </WrapTooltip>
          ) : (
            <div className="flex gap-2">
              <Button size="sm" onClick={handleSave}><Save className="h-4 w-4 mr-1" />Save</Button>
              <Button variant="ghost" size="sm" onClick={() => setEditing(false)}><X className="h-4 w-4" /></Button>
            </div>
          )}
        </div>
      </div>

      <StageStepper stages={CLAIM_STAGES} currentKey={getClaimStageKey(claim.status)} />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-8 space-y-6">
          <Card>
            <CardHeader><CardTitle>Claim Details</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4">
                {[
                  { label: "Conf #", key: "confNumber" },
                  { label: "Date", key: "date" },
                  { label: "Client #", key: "clientNumber" },
                  { label: "Car #", key: "carNumber" },
                  { label: "Amount", key: "claimAmount" },
                  { label: "Payor Email", key: "payorEmail" },
                ].map(field => (
                  <div key={field.key}>
                    <Label className="text-xs text-muted-foreground">{field.label}</Label>
                    {editing ? (
                      <Input
                        value={editData[field.key] || ""}
                        onChange={e => setEditData({ ...editData, [field.key]: e.target.value })}
                        className="mt-1"
                      />
                    ) : (
                      <p className="text-sm font-medium mt-1">
                        {field.key === "claimAmount" ? formatCurrency(claim[field.key as keyof typeof claim] as string) : (claim[field.key as keyof typeof claim] as string) || "-"}
                      </p>
                    )}
                  </div>
                ))}
                <div className="col-span-2">
                  <Label className="text-xs text-muted-foreground">Ref #</Label>
                  {editing ? (
                    <Input
                      value={editData.refNumber || ""}
                      onChange={e => setEditData({ ...editData, refNumber: e.target.value })}
                      className="mt-1"
                    />
                  ) : (
                    <div className="mt-1">
                      <RefNumber value={claim.refNumber} className="text-sm" />
                    </div>
                  )}
                </div>
                <div className="col-span-2">
                  <Label className="text-xs text-muted-foreground">Error Details</Label>
                  {editing ? (
                    <Textarea
                      value={editData.errorDetails || ""}
                      onChange={e => setEditData({ ...editData, errorDetails: e.target.value })}
                      className="mt-1"
                    />
                  ) : claim.errorDetails && claim.errorDetails.includes(";") ? (
                    <div className="mt-1">
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <Badge variant="outline" className="text-xs bg-blue-50 text-blue-700 border-blue-200">
                          Multiple errors detected
                        </Badge>
                      </div>
                      <ul className="space-y-1 ml-1">
                        {claim.errorDetails.split(";").map((part: string, i: number) => (
                          <li key={i} className="flex items-start gap-2 text-sm">
                            <span className="text-blue-400 mt-0.5 text-xs flex-shrink-0">{i + 1}.</span>
                            <span>{part.trim()}</span>
                          </li>
                        ))}
                      </ul>
                      {!claim.errorTypeName && (
                        <p className="text-xs text-muted-foreground mt-2 italic">
                          Review the errors above and assign the most relevant error type.
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="text-sm mt-1">{claim.errorDetails || "-"}</p>
                  )}
                </div>
                <div className="col-span-2">
                  <Label className="text-xs text-muted-foreground">Error Type</Label>
                  <div className="mt-1">
                    {claim.errorTypeName ? (
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="flex items-center gap-1">
                          <Tag className="h-3 w-3" />
                          {claim.errorTypeName}
                        </Badge>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2 text-xs text-muted-foreground"
                          onClick={() => setShowErrorTypeSelector(true)}
                        >
                          Change
                        </Button>
                      </div>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-amber-700 border-amber-300 bg-amber-50 hover:bg-amber-100"
                        onClick={() => setShowErrorTypeSelector(true)}
                      >
                        <AlertTriangle className="h-3 w-3 mr-1" />
                        Assign Error Type
                      </Button>
                    )}

                    <Dialog open={showErrorTypeSelector} onOpenChange={(open) => {
                      setShowErrorTypeSelector(open);
                      if (!open) {
                        setShowCreateErrorType(false);
                        setNewErrorType({ name: "", category: "", description: "" });
                        setErrorTypeError("");
                      }
                    }}>
                      <DialogContent className="max-w-md">
                        <DialogHeader>
                          <DialogTitle>{claim.errorTypeName ? "Change Error Type" : "Assign Error Type"}</DialogTitle>
                        </DialogHeader>
                        {errorTypeError && (
                          <div className="bg-red-50 text-red-800 text-sm p-2 rounded border border-red-200">
                            {errorTypeError}
                          </div>
                        )}
                        {!showCreateErrorType ? (
                          <div className="space-y-3">
                            <div className="max-h-[300px] overflow-y-auto space-y-1">
                              {errorTypes.map((et) => (
                                <button
                                  key={et.id}
                                  className={`w-full text-left px-3 py-2 rounded-md text-sm hover:bg-muted transition-colors flex items-center justify-between ${
                                    String(claim.errorTypeId) === String(et.id) ? "bg-primary/10 border border-primary/30" : "border border-transparent"
                                  }`}
                                  onClick={() => handleAssignErrorType(et)}
                                  disabled={errorTypeAssigning}
                                >
                                  <div>
                                    <p className="font-medium">{et.name}</p>
                                    {et.category && <p className="text-xs text-muted-foreground">{et.category}</p>}
                                  </div>
                                  {String(claim.errorTypeId) === String(et.id) && (
                                    <CheckCircle className="h-4 w-4 text-primary" />
                                  )}
                                </button>
                              ))}
                              {errorTypes.length === 0 && (
                                <p className="text-sm text-muted-foreground text-center py-4">No error types defined yet.</p>
                              )}
                            </div>
                            <Separator />
                            <Button
                              variant="outline"
                              size="sm"
                              className="w-full"
                              onClick={() => setShowCreateErrorType(true)}
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
                                value={newErrorType.name}
                                onChange={e => setNewErrorType({ ...newErrorType, name: e.target.value })}
                                placeholder="e.g. Duplicate Charge"
                                className="mt-1"
                              />
                            </div>
                            <div>
                              <Label>Category</Label>
                              <Input
                                value={newErrorType.category}
                                onChange={e => setNewErrorType({ ...newErrorType, category: e.target.value })}
                                placeholder="e.g. Billing"
                                className="mt-1"
                              />
                            </div>
                            <div>
                              <Label>Description</Label>
                              <Textarea
                                value={newErrorType.description}
                                onChange={e => setNewErrorType({ ...newErrorType, description: e.target.value })}
                                placeholder="Describe this error type..."
                                className="mt-1"
                                rows={3}
                              />
                            </div>
                            <div className="flex gap-2">
                              <Button
                                onClick={handleCreateAndAssignErrorType}
                                disabled={!newErrorType.name.trim() || errorTypeAssigning}
                                className="flex-1"
                              >
                                {errorTypeAssigning ? (
                                  <><Loader2 className="h-4 w-4 mr-1 animate-spin" />Creating...</>
                                ) : (
                                  "Create & Assign"
                                )}
                              </Button>
                              <Button variant="ghost" onClick={() => setShowCreateErrorType(false)}>
                                Back
                              </Button>
                            </div>
                          </div>
                        )}
                      </DialogContent>
                    </Dialog>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TreeDeciduous className="h-5 w-5" />
                Dispute Workflow
              </CardTitle>
            </CardHeader>
            <CardContent>
              <WorkflowPlayer
                claim={claim}
                showClaimContext={false}
                showDetailsLink={false}
                onComplete={() => invalidate()}
              />
            </CardContent>
          </Card>

          {claim.holdReason && (
            <div className="p-3 bg-purple-50 dark:bg-purple-950/30 rounded-md border border-purple-200 dark:border-purple-800">
              <p className="text-sm font-medium text-purple-800 dark:text-purple-300">On Hold: {claim.holdReason}</p>
              {claim.holdPendingFrom && <p className="text-xs text-purple-600 dark:text-purple-400 mt-1">Pending from: {claim.holdPendingFrom}</p>}
              {claim.holdPlacedAt && <p className="text-xs text-muted-foreground mt-1">Since {formatDate(claim.holdPlacedAt)}</p>}
              <p className="text-xs text-purple-600 dark:text-purple-400 mt-2">Workflow progress is saved — removing the hold will resume from where you left off in the Work Queue.</p>
            </div>
          )}

          {claim.approvedAmount && (
            <div className="p-3 bg-green-50 dark:bg-green-950/30 rounded-md border border-green-200 dark:border-green-800">
              <p className="text-sm">Approved Amount: <span className="font-semibold">{formatCurrency(claim.approvedAmount)}</span></p>
              {claim.invoiceNumbers && <p className="text-xs text-muted-foreground mt-1">Invoice: {claim.invoiceNumbers}</p>}
            </div>
          )}

          <Card>
            <CardHeader><CardTitle>Evidence</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {(() => {
                const evidenceItems = Array.isArray(collectedEvidence?.evidence) ? collectedEvidence.evidence : [];
                if (evidenceItems.length > 0) {
                  return (
                    <div className="space-y-3">
                      <Label className="text-xs text-muted-foreground">Collected Evidence ({evidenceItems.length} items)</Label>
                      <div className="grid gap-3">
                        {evidenceItems.map((ev) => (
                          <div key={ev.id as number} className="border rounded-lg p-3 space-y-2 bg-muted/30">
                            <div className="flex items-start justify-between">
                              <div>
                                <p className="text-sm font-medium">{ev.evidenceTypeName as string}</p>
                                {ev.treeNodeId && (
                                  <p className="text-[10px] text-muted-foreground">
                                    Tree node: {ev.treeNodeId as string}
                                  </p>
                                )}
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-[10px] text-muted-foreground">
                                  {ev.collectedBy && `by ${ev.collectedBy as string} · `}
                                  {formatDateTime(ev.collectedAt as string)}
                                </span>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6 text-destructive"
                                  onClick={() => {
                                    deleteEvidence.mutateAsync({ claimId, evidenceId: ev.id as number }).then(() => {
                                      queryClient.invalidateQueries({ queryKey: getListClaimEvidenceQueryKey(claimId) });
                                    });
                                  }}
                                >
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                              </div>
                            </div>
                            {ev.imageUrl && (
                              <a
                                href={(ev.imageUrl as string).startsWith("/objects/")
                                  ? `/api/storage${ev.imageUrl as string}`
                                  : ev.imageUrl as string}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="block"
                              >
                                <img
                                  src={(ev.imageUrl as string).startsWith("/objects/")
                                    ? `/api/storage${ev.imageUrl as string}`
                                    : ev.imageUrl as string}
                                  alt={ev.evidenceTypeName as string}
                                  className="rounded border max-h-40 w-auto hover:opacity-90 transition-opacity"
                                />
                              </a>
                            )}
                            {ev.notes && (
                              <p className="text-xs bg-white dark:bg-background rounded p-2 border">{ev.notes as string}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                }
                return null;
              })()}

              <div>
                <Label className="text-xs text-muted-foreground">Evidence Notes</Label>
                <p className="text-sm mt-1">{claim.evidenceNotes || "No evidence notes yet."}</p>
              </div>
              {claim.evidenceChecklist && typeof claim.evidenceChecklist === "object" && (
                <div>
                  <Label className="text-xs text-muted-foreground">Evidence Checklist</Label>
                  <div className="space-y-1 mt-1">
                    {Object.entries(claim.evidenceChecklist as Record<string, boolean>).map(([item, checked]) => (
                      <div key={item} className="flex items-center gap-2 text-sm">
                        {checked ? (
                          <CheckCircle className="h-4 w-4 text-green-600" />
                        ) : (
                          <Clock className="h-4 w-4 text-muted-foreground" />
                        )}
                        <span className={checked ? "" : "text-muted-foreground"}>{item}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {claim.evidenceFiles && Array.isArray(claim.evidenceFiles) && (claim.evidenceFiles as unknown[]).length > 0 && (
                <div>
                  <Label className="text-xs text-muted-foreground">Files</Label>
                  <div className="flex flex-wrap gap-2 mt-1">
                    {(claim.evidenceFiles as unknown[]).map((f, i: number) => {
                      const file = f as Record<string, string>;
                      return <Badge key={i} variant="outline">{file.label || file.url || `File ${i + 1}`}</Badge>;
                    })}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {claimSubmissions.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Bot className="h-5 w-5" />
                  Portal Submissions
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {claimSubmissions.map((sub: PortalSubmissionResponse) => (
                  <SubmissionCard key={sub.id} submission={sub} />
                ))}
              </CardContent>
            </Card>
          )}

          {claimResponses.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Inbox className="h-5 w-5" />
                  Responses Received
                  <Badge variant="secondary">{claimResponses.length}</Badge>
                </CardTitle>
                {claim.closureReason && (
                  <CardDescription
                    data-testid="responses-closure-reason"
                    className="pt-1"
                  >
                    Closure reason: <span className="font-medium">{closureReasonLabel(claim.closureReason)}</span>
                  </CardDescription>
                )}
              </CardHeader>
              <CardContent className="space-y-3">
                {claimResponses.map((resp: PortalResponseItem) => {
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
                  const isAck = resp.responseType === "acknowledgment";
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
                          {isAck && (
                            <Badge variant="outline" className="text-[10px] bg-slate-100 text-slate-600 border-slate-300">
                              Receipt only — no action
                            </Badge>
                          )}
                          {resp.classifierSource === "ai" && (
                            <Badge variant="outline" className="text-[10px] bg-violet-50 text-violet-700 border-violet-200">
                              AI summarized
                            </Badge>
                          )}
                          {!resp.processed && !isAck && (
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

                      {resp.aiSummary && (
                        <div className="text-sm bg-white/70 border border-current/10 rounded-md p-3">
                          <div className="text-[11px] uppercase tracking-wide opacity-60 mb-1">Summary</div>
                          <div className="leading-snug">{resp.aiSummary}</div>
                          {(resp.requestedAction || resp.extractedAmount || resp.extractedDeadline) && (
                            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs opacity-80">
                              {resp.requestedAction && (
                                <span><strong>They want:</strong> {resp.requestedAction}</span>
                              )}
                              {resp.extractedAmount && (
                                <span><strong>Amount:</strong> {resp.extractedAmount}</span>
                              )}
                              {resp.extractedDeadline && (
                                <span><strong>Deadline:</strong> {resp.extractedDeadline}</span>
                              )}
                            </div>
                          )}
                        </div>
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

                      <div className="flex items-center gap-3 text-xs opacity-60">
                        {resp.senderEmail && (
                          <span>From: {resp.senderName || resp.senderEmail}</span>
                        )}
                        {resp.matchedVia && (
                          <span>Matched: {resp.matchedVia}</span>
                        )}
                        {resp.matchConfidence && (() => {
                          const conf = String(resp.matchConfidence).toLowerCase();
                          const confColors: Record<string, string> = {
                            high: "bg-green-100 text-green-800 border-green-300",
                            medium: "bg-amber-100 text-amber-800 border-amber-300",
                            low: "bg-red-100 text-red-800 border-red-300",
                          };
                          const confTips: Record<string, string> = {
                            high: "Strong match — sender, claim ref, and amount aligned.",
                            medium: "Likely match — partial signals matched. Please verify.",
                            low: "Weak match — auto-linked on minimal signals. Review carefully.",
                          };
                          return (
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Badge variant="outline" className={`text-[10px] capitalize cursor-help ${confColors[conf] || ""}`}>
                                    {conf} confidence
                                  </Badge>
                                </TooltipTrigger>
                                <TooltipContent className="max-w-xs">
                                  {confTips[conf] || `Match confidence: ${conf}`}
                                  {resp.matchedVia ? ` (matched via ${resp.matchedVia})` : ""}
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          );
                        })()}
                        <Button
                          size="sm" variant="ghost"
                          className="text-xs h-6 px-2 ml-auto opacity-70 hover:opacity-100"
                          onClick={() => {
                            setReassignTarget(resp);
                            setReassignSearch("");
                            setReassignSelectedClaimId(null);
                          }}
                        >
                          <ArrowRightLeft className="h-3 w-3 mr-1" /> Not the right claim?
                        </Button>
                      </div>

                      {!resp.processed && (
                        <div className="flex gap-2 pt-1">
                          <Button
                            size="sm" variant="outline"
                            className="text-xs h-7 bg-green-100 hover:bg-green-200 text-green-800 border-green-300"
                            onClick={async () => {
                              await processResponseMutation.mutateAsync({ id: resp.id, data: { responseType: "approval" } });
                              queryClient.invalidateQueries({ queryKey: getListResponsesQueryKey({ claimId }) });
                              queryClient.invalidateQueries({ queryKey: getGetClaimQueryKey(claimId) });
                            }}
                          >
                            <CheckCircle className="h-3 w-3 mr-1" /> Approve
                          </Button>
                          <Button
                            size="sm" variant="outline"
                            className="text-xs h-7 bg-red-100 hover:bg-red-200 text-red-800 border-red-300"
                            onClick={async () => {
                              await processResponseMutation.mutateAsync({ id: resp.id, data: { responseType: "denial" } });
                              queryClient.invalidateQueries({ queryKey: getListResponsesQueryKey({ claimId }) });
                              queryClient.invalidateQueries({ queryKey: getGetClaimQueryKey(claimId) });
                            }}
                          >
                            <X className="h-3 w-3 mr-1" /> Deny
                          </Button>
                          <Button
                            size="sm" variant="outline"
                            className="text-xs h-7"
                            onClick={async () => {
                              await processResponseMutation.mutateAsync({ id: resp.id, data: { responseType: resp.responseType as any } });
                              queryClient.invalidateQueries({ queryKey: getListResponsesQueryKey({ claimId }) });
                            }}
                          >
                            <Eye className="h-3 w-3 mr-1" /> Mark Reviewed
                          </Button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}

          {emailThread.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <MessagesSquare className="h-5 w-5" />
                  Email Thread
                  <Badge variant="secondary">{emailThread.length}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {emailThread.map((msg) => {
                  const isOutbound = msg.direction === "outbound";
                  return (
                    <div
                      key={msg.id}
                      className={`border rounded-lg p-3 ${isOutbound ? "bg-blue-50/40 border-blue-200 ml-6" : "bg-slate-50 border-slate-200 mr-6"}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 text-sm">
                          {isOutbound ? <Send className="h-4 w-4 text-blue-700" /> : <Inbox className="h-4 w-4 text-slate-700" />}
                          <span className="font-medium">{isOutbound ? "Sent" : "Received"}</span>
                          <span className="opacity-70">{msg.sender}{msg.senderEmail && msg.senderEmail !== msg.sender ? ` <${msg.senderEmail}>` : ""}</span>
                        </div>
                        <span className="text-xs opacity-60">{formatDateTime(msg.timestamp)}</span>
                      </div>
                      {msg.subject && <p className="text-sm font-medium mt-1">{msg.subject}</p>}
                      {msg.bodyPreview && <p className="text-sm opacity-80 mt-1 whitespace-pre-wrap">{msg.bodyPreview}</p>}
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}

          {validTransitions?.postResponseActions && validTransitions.postResponseActions.length > 0 && (
            <Card className="border-2 border-blue-300 bg-blue-50/30">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-blue-900">
                  <ArrowRight className="h-5 w-5" />
                  Next Steps — Response Received
                </CardTitle>
                <p className="text-sm text-blue-700 mt-1">
                  {validTransitions.latestResponseType === "approval" || validTransitions.latestResponseType === "partial_approval"
                    ? "A positive response was received. Choose how to proceed:"
                    : validTransitions.latestResponseType === "denial"
                    ? "The dispute was denied. Choose how to proceed:"
                    : "A response was received. Choose how to proceed:"}
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {validTransitions.postResponseActions.includes("resolve_reattest") && (
                    <Button
                      variant="outline"
                      className="h-auto py-3 px-4 flex flex-col items-start gap-1 bg-green-50 hover:bg-green-100 border-green-300 text-green-900"
                      disabled={postResponseActionMutation.isPending}
                      onClick={async () => {
                        await postResponseActionMutation.mutateAsync({
                          id: claimId,
                          data: { action: "resolve_reattest", notes: postResponseNotes || undefined },
                        });
                        setPostResponseNotes("");
                        queryClient.invalidateQueries({ queryKey: getGetClaimQueryKey(claimId) });
                        queryClient.invalidateQueries({ queryKey: getGetClaimValidTransitionsQueryKey(claimId) });
                      }}
                    >
                      <span className="flex items-center gap-2 font-semibold">
                        <CheckCircle className="h-4 w-4" /> Resolve — Reattest
                      </span>
                      <span className="text-xs font-normal text-green-700">
                        Team will reattest on external system
                      </span>
                    </Button>
                  )}
                  {validTransitions.postResponseActions.includes("resolve_new_invoice") && (
                    <Button
                      variant="outline"
                      className="h-auto py-3 px-4 flex flex-col items-start gap-1 bg-green-50 hover:bg-green-100 border-green-300 text-green-900"
                      disabled={postResponseActionMutation.isPending}
                      onClick={async () => {
                        await postResponseActionMutation.mutateAsync({
                          id: claimId,
                          data: { action: "resolve_new_invoice", notes: postResponseNotes || undefined },
                        });
                        setPostResponseNotes("");
                        queryClient.invalidateQueries({ queryKey: getGetClaimQueryKey(claimId) });
                        queryClient.invalidateQueries({ queryKey: getGetClaimValidTransitionsQueryKey(claimId) });
                      }}
                    >
                      <span className="flex items-center gap-2 font-semibold">
                        <CheckCircle className="h-4 w-4" /> Resolve — New Invoice #
                      </span>
                      <span className="text-xs font-normal text-green-700">
                        Submit under new invoice number provided in response
                      </span>
                    </Button>
                  )}
                  {validTransitions.postResponseActions.includes("accept_loss") && (
                    <Button
                      variant="outline"
                      className="h-auto py-3 px-4 flex flex-col items-start gap-1 bg-red-50 hover:bg-red-100 border-red-300 text-red-900"
                      disabled={postResponseActionMutation.isPending}
                      onClick={async () => {
                        await postResponseActionMutation.mutateAsync({
                          id: claimId,
                          data: { action: "accept_loss", notes: postResponseNotes || undefined },
                        });
                        setPostResponseNotes("");
                        queryClient.invalidateQueries({ queryKey: getGetClaimQueryKey(claimId) });
                        queryClient.invalidateQueries({ queryKey: getGetClaimValidTransitionsQueryKey(claimId) });
                      }}
                    >
                      <span className="flex items-center gap-2 font-semibold">
                        <X className="h-4 w-4" /> Accept as Loss
                      </span>
                      <span className="text-xs font-normal text-red-700">
                        Close claim — denial accepted, no further action
                      </span>
                    </Button>
                  )}
                  {validTransitions.postResponseActions.includes("re_dispute") && (
                    <Button
                      variant="outline"
                      className="h-auto py-3 px-4 flex flex-col items-start gap-1 bg-amber-50 hover:bg-amber-100 border-amber-300 text-amber-900"
                      disabled={postResponseActionMutation.isPending}
                      onClick={async () => {
                        await postResponseActionMutation.mutateAsync({
                          id: claimId,
                          data: { action: "re_dispute", notes: postResponseNotes || undefined },
                        });
                        setPostResponseNotes("");
                        queryClient.invalidateQueries({ queryKey: getGetClaimQueryKey(claimId) });
                        queryClient.invalidateQueries({ queryKey: getGetClaimValidTransitionsQueryKey(claimId) });
                      }}
                    >
                      <span className="flex items-center gap-2 font-semibold">
                        <Send className="h-4 w-4" /> Re-dispute
                      </span>
                      <span className="text-xs font-normal text-amber-700">
                        Gather additional evidence and resubmit through portal
                      </span>
                    </Button>
                  )}
                </div>
                <div>
                  <Label className="text-xs text-blue-700">Notes (optional)</Label>
                  <Textarea
                    value={postResponseNotes}
                    onChange={(e) => setPostResponseNotes(e.target.value)}
                    placeholder="Add context for this decision (e.g., new invoice number, reason for re-dispute)..."
                    className="mt-1 bg-white/80 text-sm"
                    rows={2}
                  />
                </div>
                {postResponseActionMutation.isPending && (
                  <div className="flex items-center gap-2 text-sm text-blue-600">
                    <Loader2 className="h-4 w-4 animate-spin" /> Processing...
                  </div>
                )}
              </CardContent>
            </Card>
          )}

        </div>

        <div className="lg:col-span-4 space-y-6">
          <div className="lg:sticky lg:top-4 space-y-4">
            <ActionsRail
              title="Take action"
              meta={`Step ${CLAIM_STAGES.findIndex((s) => s.key === getClaimStageKey(claim.status)) + 1} of ${CLAIM_STAGES.length}`}
            >
              {hasActivePortalSubmission && (
                <div className="px-4 py-2 bg-amber-50 dark:bg-amber-950/30 border-b border-border text-xs text-amber-800 dark:text-amber-300">
                  Portal submission in progress — status and outcome changes are locked until it completes or is cancelled.
                </div>
              )}

              {(() => {
                const status = claim.status;
                let recommended: { label: string; description: string } | null = null;
                if (status === "Needs Review" || status === "New") {
                  recommended = { label: "Classify this claim", description: "Confirm the dispute reason and prepare the case." };
                } else if (status === "Needs Evidence") {
                  recommended = { label: "Gather evidence", description: "Add supporting documents, then queue for portal." };
                } else if (status === "Ready to Review") {
                  recommended = { label: "Review payer response", description: "Process the response and choose an outcome below." };
                } else if (status === "On Hold") {
                  recommended = { label: "Resume when ready", description: "Remove the hold to continue processing this claim." };
                }
                return recommended ? (
                  <ActionsRailRecommended label="Recommended next" description={recommended.description}>
                    <div className="text-sm font-semibold">{recommended.label}</div>
                  </ActionsRailRecommended>
                ) : null;
              })()}

              <ActionGroup label="Workflow">
                <div className="px-2 py-1.5">
                  {(validTransitions?.validStatuses?.length ?? 0) > 0 ? (
                    <Select onValueChange={handleStatusChange}>
                      <SelectTrigger className="w-full"><SelectValue placeholder="Change status" /></SelectTrigger>
                      <SelectContent>
                        {(validTransitions?.validStatuses || []).map((s: string) => (
                          <SelectItem key={s} value={s}>{s}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <WrapTooltip content={hasActivePortalSubmission ? "Status changes are locked while a portal submission is active." : "No status transitions available from the current state."}>
                      <Select disabled>
                        <SelectTrigger className="w-full cursor-not-allowed"><SelectValue placeholder="Change status" /></SelectTrigger>
                        <SelectContent />
                      </Select>
                    </WrapTooltip>
                  )}
                </div>
                <ActionRow
                  icon={<Send className="h-4 w-4" />}
                  label="Queue for portal"
                  sub="Automated MAS dispute submission"
                  disabled={!validTransitions?.canQueueForPortal}
                  disabledReason={validTransitions?.canQueueForPortal ? undefined : "Claims can only be queued for portal when in New, Needs Review, or Needs Evidence status and have no active submissions."}
                  onClick={handleQueueForPortal}
                  testId="action-queue-for-portal"
                />
              </ActionGroup>

              {(getClaimStageKey(claim.status) === "build" || getClaimStageKey(claim.status) === "await") && (
                <ActionGroup label="Exit workflow">
                  <ActionRow
                    icon={<XCircle className="h-4 w-4" />}
                    label="Mark as Cannot Dispute"
                    sub={
                      getClaimStageKey(claim.status) === "build"
                        ? "Worked the case; the evidence we'd need doesn't exist"
                        : "Mid-flight: turns out we can't recover these dollars"
                    }
                    onClick={() => setClosureDialog({ reason: "not_contestable" })}
                    testId="action-stage-mark-not-contestable"
                  />
                  <ActionRow
                    icon={<FileX className="h-4 w-4" />}
                    label="Mark as Non-Issue"
                    sub={
                      getClaimStageKey(claim.status) === "build"
                        ? "Discovered this isn't a real billing error"
                        : "Mid-flight: this turned out to not be a real billing error"
                    }
                    onClick={() => setClosureDialog({ reason: "non_issue" })}
                    testId="action-stage-mark-non-issue"
                  />
                </ActionGroup>
              )}

              {(validTransitions?.validOutcomes?.length ?? 0) > 0 && (() => {
                const outcomes = (validTransitions?.validOutcomes || []) as string[];
                const closureOffered = outcomes.includes("Denied") || outcomes.includes("Withdrawn");
                const nonClosure = outcomes.filter((o) => o !== "Denied" && o !== "Withdrawn");
                const hasResponse = validTransitions?.hasResponse ?? !!validTransitions?.latestResponseType;
                return (
                  <ActionGroup label="Resolve">
                    {nonClosure.map((o) => (
                      <ActionRow
                        key={o}
                        label={o}
                        selected={claim.outcome === o}
                        onClick={() => handleOutcomeChange(o)}
                        testId={`action-outcome-${o.toLowerCase().replace(/\s+/g, "-")}`}
                      />
                    ))}
                    {closureOffered && (
                      <>
                        <ActionRow
                          label="Payer Denied"
                          selected={claim.outcome === "Denied"}
                          disabled={!hasResponse}
                          disabledReason={hasResponse ? undefined : "Disabled because no portal or email response has been recorded yet."}
                          onClick={() => handleOutcomeChange("Denied")}
                          testId="action-outcome-payer-denied"
                        />
                        <ActionRow
                          label="Withdraw — Not Contestable"
                          sub="No clear path to recover the dollars"
                          selected={claim.outcome === "Withdrawn" && claim.closureReason === "not_contestable"}
                          disabledReason="Close this claim because we decided not to dispute it (no clear path to recover the dollars)."
                          onClick={() => handleOutcomeChange("Withdrawn", "not_contestable")}
                          testId="action-outcome-not-contestable"
                        />
                        <ActionRow
                          label="Withdraw — Accepted Loss"
                          sub="Accept the loss after a denial"
                          selected={claim.outcome === "Withdrawn" && claim.closureReason === "accepted_loss"}
                          disabledReason="Close this claim after a denial because we accept the loss and won't re-dispute."
                          onClick={() => handleOutcomeChange("Withdrawn", "accepted_loss")}
                          testId="action-outcome-accepted-loss"
                        />
                      </>
                    )}
                  </ActionGroup>
                );
              })()}

              <ActionGroup label="Pause / Change">
                {claim.status === "On Hold" ? (
                  <ActionRow
                    icon={<Play className="h-4 w-4" />}
                    label="Remove hold"
                    sub="Resume from where you left off"
                    disabledReason="Remove the hold and return this claim to active processing."
                    onClick={handleRemoveHold}
                    testId="action-remove-hold"
                  />
                ) : (
                  <ActionRow
                    icon={<PauseCircle className="h-4 w-4" />}
                    label="Place on hold"
                    sub="Pause processing"
                    disabledReason="Pause processing of this claim. Use when waiting for additional information, documents, or a response from another party."
                    onClick={() => setShowHoldDialog(true)}
                    testId="action-place-hold"
                  />
                )}
              </ActionGroup>
            </ActionsRail>

            <Dialog open={showHoldDialog} onOpenChange={setShowHoldDialog}>
              <DialogContent>
                <DialogHeader><DialogTitle>Place Claim on Hold</DialogTitle></DialogHeader>
                <div className="space-y-4">
                  <div>
                    <Label>Reason</Label>
                    <Textarea value={holdReason} onChange={e => setHoldReason(e.target.value)} />
                  </div>
                  <div>
                    <Label>Pending From</Label>
                    <Input value={holdPending} onChange={e => setHoldPending(e.target.value)} placeholder="Person or dept" />
                  </div>
                  <Button onClick={handlePlaceHold} disabled={!holdReason}>Place on Hold</Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-1 text-sm">
                Add a note
                <InfoTooltip content="Internal notes visible only to staff. Notes appear in the activity feed below alongside status changes and other history." />
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Textarea
                placeholder="Capture an observation, next step, or context for the team..."
                value={noteContent}
                onChange={e => setNoteContent(e.target.value)}
                rows={2}
              />
              <div className="flex justify-end">
                <Button size="sm" onClick={handleAddNote} disabled={!noteContent.trim()}>
                  Add note
                </Button>
              </div>
            </CardContent>
          </Card>

          <ActivityFeed
            auditLogs={auditLogs || []}
            notes={notes || []}
            kind="claim"
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
              Move this response to a different claim, or unmatch it so it returns to the unmatched inbox.
            </p>
            <div className="space-y-2">
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
                  {reassignClaimsData.claims
                    .filter((c: any) => c.id !== claimId)
                    .map((c: any) => (
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
            </div>
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
                  queryClient.invalidateQueries({ queryKey: getListResponsesQueryKey({ claimId }) });
                  queryClient.invalidateQueries({ queryKey: getGetClaimQueryKey(claimId) });
                  queryClient.invalidateQueries({ queryKey: getGetClaimEmailThreadQueryKey(claimId) });
                  queryClient.invalidateQueries({ queryKey: getGetClaimValidTransitionsQueryKey(claimId) });
                  queryClient.invalidateQueries({ queryKey: getListClaimAuditLogsQueryKey(claimId) });
                  setReassignTarget(null);
                }}
              >
                <MailQuestion className="h-4 w-4 mr-1" /> Unmatch
              </Button>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => setReassignTarget(null)}>Cancel</Button>
                <Button
                  disabled={!reassignSelectedClaimId || reassignResponseMutation.isPending}
                  onClick={async () => {
                    if (!reassignTarget || !reassignSelectedClaimId) return;
                    await reassignResponseMutation.mutateAsync({
                      id: reassignTarget.id,
                      data: { targetClaimId: reassignSelectedClaimId },
                    });
                    queryClient.invalidateQueries({ queryKey: getListResponsesQueryKey({ claimId }) });
                    queryClient.invalidateQueries({ queryKey: getGetClaimQueryKey(claimId) });
                    queryClient.invalidateQueries({ queryKey: getGetClaimEmailThreadQueryKey(claimId) });
                    queryClient.invalidateQueries({ queryKey: getGetClaimValidTransitionsQueryKey(claimId) });
                    queryClient.invalidateQueries({ queryKey: getListClaimAuditLogsQueryKey(claimId) });
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
