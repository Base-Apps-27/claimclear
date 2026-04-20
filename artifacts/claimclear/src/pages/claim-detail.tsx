import { useState, useEffect } from "react";
import { useParams, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetClaim, getGetClaimQueryKey,
  useUpdateClaim, useUpdateClaimStatus, useUpdateClaimOutcome,
  useUpdateClaimEvidence, usePlaceClaimOnHold, useRemoveClaimHold,
  useUpdateClaimWorkflow, useGenerateClaimEmail,
  useListClaimNotes, getListClaimNotesQueryKey, useCreateClaimNote, useDeleteNote,
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
} from "@workspace/api-client-react";
import type { PortalSubmissionResponse, BotActivityLogResponse, ErrorTypeResponse, PortalResponseItem } from "@workspace/api-client-react";
import { StatusBadge } from "@/components/status-badge";
import { usePresence } from "@/hooks/use-presence";
import { useClaimEvents } from "@/hooks/use-claim-events";
import { HumanPresenceBanner, BotPresenceBanner, PresenceAvatars } from "@/components/presence-banners";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  StickyNote
} from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { InfoTooltip, WrapTooltip } from "@/components/info-tooltip";
import {
  humanizeAuditAction,
  ACTION_CATEGORY_LABELS,
  type ActionCategory,
} from "@/lib/audit-action-meta";
import { RefNumber } from "@/components/ref-number";
import { WorkflowPlayer } from "@/components/workflow-player";

function SubmissionCard({ submission: sub }: { submission: PortalSubmissionResponse }) {
  const [showDescription, setShowDescription] = useState(false);
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

  const { viewers, botActivity: botPresenceActivity } = usePresence(claimId);
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
  const deleteNote = useDeleteNote();
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
  const [auditFilter, setAuditFilter] = useState<ActionCategory | "all">("all");

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

  const handleOutcomeChange = async (outcome: string) => {
    const approvedAmount = outcome === "Approved" ? claim.claimAmount || "0" : outcome === "Partially Approved" ? "" : undefined;
    await updateOutcome.mutateAsync({ id: claimId, data: { outcome, approvedAmount } });
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
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h2 className="text-2xl font-bold tracking-tight font-mono">{claim.confNumber}</h2>
          <StatusBadge status={claim.status} />
          <Badge variant="outline">{claim.outcome}</Badge>
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
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

          <Card>
            <CardHeader><CardTitle>Actions</CardTitle></CardHeader>
            <CardContent>
              {hasActivePortalSubmission && (
                <div className="mb-3 p-2 bg-amber-50 border border-amber-200 rounded-md text-sm text-amber-800">
                  Portal submission in progress — status and outcome changes are locked until it completes or is cancelled.
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                {(validTransitions?.validStatuses?.length ?? 0) > 0 ? (
                  <Select onValueChange={handleStatusChange}>
                    <SelectTrigger className="w-[180px]"><SelectValue placeholder="Change Status" /></SelectTrigger>
                    <SelectContent>
                      {(validTransitions?.validStatuses || []).map((s: string) => (
                        <SelectItem key={s} value={s}>{s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <WrapTooltip content={hasActivePortalSubmission ? "Status changes are locked while a portal submission is active." : "No status transitions available from the current state."}>
                    <Select disabled>
                      <SelectTrigger className="w-[180px] cursor-not-allowed"><SelectValue placeholder="Change Status" /></SelectTrigger>
                      <SelectContent />
                    </Select>
                  </WrapTooltip>
                )}

                {(validTransitions?.validOutcomes?.length ?? 0) > 0 && (
                  <div className="flex gap-2">
                    {(validTransitions?.validOutcomes || []).map((o: string) => (
                      <Button key={o} variant={claim.outcome === o ? "default" : "outline"} size="sm" onClick={() => handleOutcomeChange(o)}>{o}</Button>
                    ))}
                  </div>
                )}

                <Separator orientation="vertical" className="h-8 mx-2" />

                <WrapTooltip content={validTransitions?.canQueueForPortal ? "Add this claim to the automated portal submission queue. The bot will fill out the MAS dispute form with claim details and evidence." : "Claims can only be queued for portal when in New, Needs Review, or Needs Evidence status and have no active submissions."}>
                  <Button variant="outline" size="sm" onClick={handleQueueForPortal} disabled={!validTransitions?.canQueueForPortal}>
                    <Send className="h-4 w-4 mr-1" />Queue for Portal
                  </Button>
                </WrapTooltip>

                {claim.status === "On Hold" ? (
                  <WrapTooltip content="Remove the hold and return this claim to active processing. The claim will go back to its previous workflow step.">
                    <Button variant="outline" size="sm" onClick={handleRemoveHold}>
                      <Play className="h-4 w-4 mr-1" />Remove Hold
                    </Button>
                  </WrapTooltip>
                ) : (
                  <Dialog open={showHoldDialog} onOpenChange={setShowHoldDialog}>
                    <DialogTrigger asChild>
                      <WrapTooltip content="Pause processing of this claim. Use when waiting for additional information, documents, or a response from another party.">
                        <Button variant="outline" size="sm"><PauseCircle className="h-4 w-4 mr-1" />Place on Hold</Button>
                      </WrapTooltip>
                    </DialogTrigger>
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
                )}
              </div>

              {claim.holdReason && (
                <div className="mt-4 p-3 bg-purple-50 dark:bg-purple-950/30 rounded-md border border-purple-200 dark:border-purple-800">
                  <p className="text-sm font-medium text-purple-800 dark:text-purple-300">On Hold: {claim.holdReason}</p>
                  {claim.holdPendingFrom && <p className="text-xs text-purple-600 dark:text-purple-400 mt-1">Pending from: {claim.holdPendingFrom}</p>}
                  {claim.holdPlacedAt && <p className="text-xs text-muted-foreground mt-1">Since {formatDate(claim.holdPlacedAt)}</p>}
                  <p className="text-xs text-purple-600 dark:text-purple-400 mt-2">Workflow progress is saved — removing the hold will resume from where you left off in the Work Queue.</p>
                </div>
              )}

              {claim.approvedAmount && (
                <div className="mt-4 p-3 bg-green-50 dark:bg-green-950/30 rounded-md border border-green-200 dark:border-green-800">
                  <p className="text-sm">Approved Amount: <span className="font-semibold">{formatCurrency(claim.approvedAmount)}</span></p>
                  {claim.invoiceNumbers && <p className="text-xs text-muted-foreground mt-1">Invoice: {claim.invoiceNumbers}</p>}
                </div>
              )}
            </CardContent>
          </Card>

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

                      {resp.content && (
                        <p className="text-sm opacity-80">{resp.content}</p>
                      )}

                      <div className="flex items-center gap-3 text-xs opacity-60">
                        {resp.senderEmail && (
                          <span>From: {resp.senderName || resp.senderEmail}</span>
                        )}
                        {resp.matchedVia && (
                          <span>Matched: {resp.matchedVia}</span>
                        )}
                        {resp.matchConfidence && (
                          <Badge variant="outline" className="text-[10px]">
                            {resp.matchConfidence} confidence
                          </Badge>
                        )}
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

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-1">
                Notes
                <InfoTooltip content="Internal notes visible only to staff. Use notes to record observations, next steps, or communication details about this claim." />
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2">
                <Textarea
                  placeholder="Add a note..."
                  value={noteContent}
                  onChange={e => setNoteContent(e.target.value)}
                  className="flex-1"
                  rows={2}
                />
                <Button size="sm" onClick={handleAddNote} disabled={!noteContent.trim()}>Add</Button>
              </div>
              <div className="space-y-2 max-h-[400px] overflow-y-auto">
                {(notes || []).length === 0 && (
                  <EmptyState
                    icon={StickyNote}
                    title="No notes yet"
                    description="Add a note above to capture observations or next steps for this claim."
                    className="py-6"
                  />
                )}
                {(notes || []).map(note => (
                  <div key={note.id} className="p-3 border rounded-md text-sm">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium">{note.author || "System"}</span>
                      <div className="flex items-center gap-1">
                        <Badge variant="outline" className="text-xs">{note.type}</Badge>
                        <Button
                          variant="ghost" size="icon" className="h-5 w-5"
                          onClick={async () => { await deleteNote.mutateAsync({ id: note.id }); invalidate(); }}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                    <p className="text-muted-foreground">{note.content}</p>
                    <p className="text-xs text-muted-foreground/70 mt-1">{formatDateTime(note.createdAt)}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="flex items-center gap-1">
                Audit Trail
                <InfoTooltip content="A chronological record of every status change, edit, and action taken on this claim. Entries are system-generated and cannot be modified." />
              </CardTitle>
              <Select value={auditFilter} onValueChange={(v) => setAuditFilter(v as ActionCategory | "all")}>
                <SelectTrigger className="h-8 w-[170px] text-xs" data-testid="select-audit-filter">
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
                const annotated = (auditLogs || []).map((log) => ({
                  log,
                  meta: humanizeAuditAction(log.action, "claim"),
                }));
                const filtered = auditFilter === "all"
                  ? annotated
                  : annotated.filter((entry) => entry.meta.category === auditFilter);
                const visible = filtered.slice(0, 20);
                if (visible.length === 0) {
                  return (
                    <p className="text-sm text-muted-foreground" data-testid="text-empty-audit">
                      {auditFilter === "all" ? "No audit entries yet." : "No matching audit entries."}
                    </p>
                  );
                }
                return (
                  <div className="space-y-2 max-h-[300px] overflow-y-auto" data-testid="list-audit-trail">
                    {visible.map(({ log, meta }) => {
                      const Icon = meta.icon;
                      return (
                        <div key={log.id} className="text-sm border-l-2 border-muted pl-3 py-1 flex gap-2">
                          <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${meta.iconClass}`} />
                          <div className="flex-1 min-w-0">
                            <p className="font-medium">{meta.label}</p>
                            {log.details && (
                              <p className="text-muted-foreground text-xs break-words">{log.details}</p>
                            )}
                            <p className="text-muted-foreground/70 text-xs">
                              {log.userName || log.userEmail || "System"} — {formatDateTime(log.timestamp)}
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
    </div>
  );
}
