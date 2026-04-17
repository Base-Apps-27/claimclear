import { useState, useRef } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useUpdateClaimStatus,
  useUpdateClaimWorkflow,
  usePlaceClaimOnHold,
  useRemoveClaimHold,
  useGeneratePortalSubmissionPreview,
  useUpdatePortalSubmissionDraft,
  useConfirmPortalSubmission,
  useAddClaimEvidence,
  useCreateClaimNote,
  getListClaimsQueryKey,
  getGetClaimQueryKey,
  useGetErrorType,
} from "@workspace/api-client-react";
import type { ClaimResponse } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { formatCurrency, formatDate } from "@/lib/format";
import { RefNumber } from "@/components/ref-number";
import { EvidenceFileList } from "@/components/evidence-file-list";
import {
  ChevronRight, CheckCircle, AlertTriangle, Send, Loader2, Edit3,
  PauseCircle, ArrowRight, Eye, TreeDeciduous, Car, Calendar, Hash
} from "lucide-react";
import { WrapTooltip } from "@/components/info-tooltip";
import {
  TreePlayer,
  type TreePlayerHandle, type TreePlayerState,
  type DecisionTree, type LegacyTreeNode, type OutcomeType,
  legacyToTree,
} from "@/components/decision-tree";

interface WorkflowPlayerProps {
  claim: ClaimResponse;
  onComplete: () => void;
  showClaimContext?: boolean;
  showDetailsLink?: boolean;
}

export function WorkflowPlayer({
  claim,
  onComplete,
  showClaimContext = false,
  showDetailsLink = true,
}: WorkflowPlayerProps) {
  const queryClient = useQueryClient();
  const updateStatus = useUpdateClaimStatus();
  const updateWorkflow = useUpdateClaimWorkflow();
  const placeHold = usePlaceClaimOnHold();
  const removeHold = useRemoveClaimHold();
  const generatePreview = useGeneratePortalSubmissionPreview();
  const updateDraft = useUpdatePortalSubmissionDraft();
  const confirmSubmission = useConfirmPortalSubmission();
  const addEvidence = useAddClaimEvidence();
  const createNote = useCreateClaimNote();
  const isOnHold = claim.status === "On Hold";
  const [portalSubmitted, setPortalSubmitted] = useState(false);

  const PORTAL_STATUSES = ["Portal Queued", "Generating Email", "Ready to Review", "Awaiting Response"];
  const isAlreadyQueued = PORTAL_STATUSES.includes(claim.status);

  const errorTypeId = claim.errorTypeId ? parseInt(claim.errorTypeId, 10) : 0;
  const { data: errorType } = useGetErrorType(errorTypeId, {
    query: { queryKey: [`/api/error-types/${errorTypeId}`], enabled: !!errorTypeId },
  });

  const rawTree = errorType?.decisionTree as Record<string, unknown> | undefined;
  let parsedTree: DecisionTree | null = null;
  if (rawTree) {
    if ("nodes" in rawTree && "rootId" in rawTree) {
      parsedTree = rawTree as unknown as DecisionTree;
    } else if ("question" in rawTree) {
      parsedTree = legacyToTree(rawTree as unknown as LegacyTreeNode);
    }
  }
  const hasTree = !!parsedTree;
  const treePlayerRef = useRef<TreePlayerHandle>(null);

  const workflowProgress = (claim.workflowProgress as Record<string, unknown>) ?? {};
  const currentStep = (workflowProgress.currentStep as string) ?? "review";
  const savedTreeState = workflowProgress.treeState as TreePlayerState | undefined;
  const [holdReason, setHoldReason] = useState("");
  const [holdPending, setHoldPending] = useState("");
  const [showHoldDialog, setShowHoldDialog] = useState(false);
  const [treeOutcomeLabel, setTreeOutcomeLabel] = useState("");
  const [showConcludeDialog, setShowConcludeDialog] = useState(false);
  const [concludeNotes, setConcludeNotes] = useState("");
  const [draftSubmission, setDraftSubmission] = useState<{
    id: number;
    subject: string;
    descriptionHtml: string;
    issueType: string;
    gpsBreadcrumbsAvailable: string;
    requesterEmail: string;
    transportationProviderName: string;
    phoneNumber: string;
    invoiceNumber: string;
    attachmentUrls: string[];
  } | null>(null);
  const [draftEditing, setDraftEditing] = useState(false);
  const [editSubject, setEditSubject] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editIssueType, setEditIssueType] = useState("");
  const [editGps, setEditGps] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editProvider, setEditProvider] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editInvoice, setEditInvoice] = useState("");

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getListClaimsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetClaimQueryKey(claim.id) });
  };

  const steps = [
    { id: "review", label: "Review", icon: Eye, tooltip: "Review the claim details before following the workflow." },
    { id: "sop", label: "Follow Workflow", icon: TreeDeciduous, tooltip: "Follow the decision tree for this error type. Evidence is collected inline at each step." },
    { id: "submit", label: "Act", icon: Send, tooltip: "Execute the recommended action from the decision tree." },
  ];
  const currentStepIndex = steps.findIndex(s => s.id === currentStep);

  const advanceStep = async (nextStep: string) => {
    const { treeState: _discard, ...cleanProgress } = workflowProgress;
    await updateWorkflow.mutateAsync({
      id: claim.id,
      data: { workflowProgress: { ...cleanProgress, currentStep: nextStep } },
    });
    invalidate();
  };

  const handleStatusUpdate = async (status: string) => {
    await updateStatus.mutateAsync({ id: claim.id, data: { status } });
    invalidate();
  };

  const handleGeneratePreview = async () => {
    const result = await generatePreview.mutateAsync({
      data: { claimId: claim.id, disputeReason: treeOutcomeLabel || undefined },
    });
    const draft = result as unknown as Record<string, unknown>;
    const attachUrls = (Array.isArray(draft.attachmentUrls) ? draft.attachmentUrls : []) as string[];
    setDraftSubmission({
      id: draft.id as number,
      subject: (draft.subject as string) || "",
      descriptionHtml: (draft.descriptionHtml as string) || "",
      issueType: (draft.issueType as string) || "",
      gpsBreadcrumbsAvailable: (draft.gpsBreadcrumbsAvailable as string) || "",
      requesterEmail: (draft.requesterEmail as string) || "",
      transportationProviderName: (draft.transportationProviderName as string) || "",
      phoneNumber: (draft.phoneNumber as string) || "",
      invoiceNumber: (draft.invoiceNumber as string) || "",
      attachmentUrls: attachUrls,
    });
    setDraftEditing(false);
  };

  const handleEditDraft = () => {
    if (!draftSubmission) return;
    setEditSubject(draftSubmission.subject);
    setEditDescription(draftSubmission.descriptionHtml);
    setEditIssueType(draftSubmission.issueType);
    setEditGps(draftSubmission.gpsBreadcrumbsAvailable);
    setEditEmail(draftSubmission.requesterEmail);
    setEditProvider(draftSubmission.transportationProviderName);
    setEditPhone(draftSubmission.phoneNumber);
    setEditInvoice(draftSubmission.invoiceNumber);
    setDraftEditing(true);
  };

  const handleSaveDraft = async () => {
    if (!draftSubmission) return;
    await updateDraft.mutateAsync({
      id: draftSubmission.id,
      data: {
        subject: editSubject,
        descriptionHtml: editDescription,
        issueType: editIssueType,
        gpsBreadcrumbsAvailable: editGps,
        requesterEmail: editEmail,
        transportationProviderName: editProvider,
        phoneNumber: editPhone,
        invoiceNumber: editInvoice,
      },
    });
    setDraftSubmission({
      ...draftSubmission,
      subject: editSubject,
      descriptionHtml: editDescription,
      issueType: editIssueType,
      gpsBreadcrumbsAvailable: editGps,
      requesterEmail: editEmail,
      transportationProviderName: editProvider,
      phoneNumber: editPhone,
      invoiceNumber: editInvoice,
      attachmentUrls: draftSubmission.attachmentUrls,
    });
    setDraftEditing(false);
  };

  const handleConfirmSubmit = async () => {
    if (!draftSubmission) return;
    await confirmSubmission.mutateAsync({ id: draftSubmission.id });
    setPortalSubmitted(true);
    invalidate();
    setTimeout(() => {
      setDraftSubmission(null);
      onComplete();
    }, 2000);
  };

  const handlePlaceHold = async () => {
    const treeState = treePlayerRef.current?.getState();
    const holdStep = currentStep === "sop" && treeState ? "sop" : currentStep;
    await updateWorkflow.mutateAsync({
      id: claim.id,
      data: { workflowProgress: { ...workflowProgress, currentStep: holdStep, treeState: treeState || undefined } },
    });
    await placeHold.mutateAsync({
      id: claim.id,
      data: { holdReason, holdPendingFrom: holdPending || undefined },
    });
    setShowHoldDialog(false);
    setHoldReason("");
    setHoldPending("");
    invalidate();
    onComplete();
  };

  const handleConclude = async () => {
    if (!concludeNotes.trim()) return;
    const lower = treeOutcomeLabel.toLowerCase();
    const isDeny = lower.includes("deny") || lower.includes("denied");
    const finalStatus = isDeny ? "Denied" : "Resolved";
    await createNote.mutateAsync({
      id: claim.id,
      data: { content: concludeNotes.trim(), type: "outcome_recorded" },
    });
    await updateStatus.mutateAsync({ id: claim.id, data: { status: finalStatus } });
    setShowConcludeDialog(false);
    setConcludeNotes("");
    invalidate();
    onComplete();
  };

  const handleEvidenceCollected = async (evidence: {
    evidenceTypeId?: number;
    evidenceTypeName: string;
    treeNodeId: string;
    imageUrl?: string;
    notes?: string;
  }) => {
    try {
      await addEvidence.mutateAsync({
        claimId: claim.id,
        data: {
          evidenceTypeId: evidence.evidenceTypeId,
          evidenceTypeName: evidence.evidenceTypeName,
          treeNodeId: evidence.treeNodeId,
          imageUrl: evidence.imageUrl,
          notes: evidence.notes,
        },
      });
    } catch {}
  };

  const handleResumeFromHold = async () => {
    await removeHold.mutateAsync({ id: claim.id });
    invalidate();
  };

  return (
    <div className="space-y-4">
      {showClaimContext && (
        <div className="bg-muted/50 border rounded-lg px-4 py-3">
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <div className="flex items-center gap-2">
              <Hash className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="text-muted-foreground">Conf #:</span>
              <span className="font-mono font-semibold">{claim.confNumber}</span>
            </div>
            <div className="flex items-center gap-2">
              <Calendar className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="text-muted-foreground">Date:</span>
              <span>{formatDate(claim.date)}</span>
            </div>
            <div className="flex items-center gap-2 col-span-2">
              <span className="text-muted-foreground text-xs">Ref #:</span>
              <RefNumber value={claim.refNumber} />
            </div>
            {claim.carNumber && (
              <div className="flex items-center gap-2">
                <Car className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="text-muted-foreground">Car #:</span>
                <span className="font-mono">{claim.carNumber}</span>
              </div>
            )}
            {claim.claimAmount && (
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Amount:</span>
                <span className="font-semibold">{formatCurrency(claim.claimAmount)}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {isOnHold ? (
        <Card className="border-purple-200 bg-purple-50/50 dark:bg-purple-950/20 dark:border-purple-800">
          <CardContent className="py-4 space-y-3">
            <div className="flex items-start gap-3">
              <PauseCircle className="h-5 w-5 text-purple-600 mt-0.5 shrink-0" />
              <div className="flex-1 space-y-1">
                <p className="text-sm font-semibold text-purple-800 dark:text-purple-300">This claim is on hold</p>
                <p className="text-sm text-purple-700 dark:text-purple-400">{claim.holdReason}</p>
                {claim.holdPendingFrom && (
                  <p className="text-xs text-purple-600 dark:text-purple-500">Pending from: {claim.holdPendingFrom}</p>
                )}
                {claim.holdPlacedAt && (
                  <p className="text-xs text-muted-foreground">
                    On hold since {formatDate(claim.holdPlacedAt)}
                  </p>
                )}
                {savedTreeState && savedTreeState.steps.length > 0 && (
                  <p className="text-xs text-purple-600 dark:text-purple-500 mt-1">
                    {savedTreeState.steps.length} workflow step{savedTreeState.steps.length !== 1 ? "s" : ""} completed — progress will be restored on resume.
                  </p>
                )}
              </div>
            </div>
            <div className="flex gap-2 ml-8">
              <Button size="sm" onClick={handleResumeFromHold}>
                <ArrowRight className="h-4 w-4 mr-1" />Resume Workflow
              </Button>
              {showDetailsLink && (
                <Link href={`/claims/${claim.id}`}>
                  <Button size="sm" variant="outline">Full Details</Button>
                </Link>
              )}
            </div>
          </CardContent>
        </Card>
      ) : (
      <>

      <div className="flex items-center gap-2 mb-4">
        {steps.map((step, i) => {
          const StepIcon = step.icon;
          const isActive = step.id === currentStep;
          const isComplete = i < currentStepIndex;
          return (
            <div key={step.id} className="flex items-center">
              {i > 0 && <ChevronRight className="h-4 w-4 text-muted-foreground mx-1" />}
              <WrapTooltip content={step.tooltip}>
                <div
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors cursor-help ${
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : isComplete
                        ? "bg-green-100 text-green-800"
                        : "bg-muted text-muted-foreground"
                  }`}
                >
                  {isComplete ? (
                    <CheckCircle className="h-3.5 w-3.5" />
                  ) : (
                    <StepIcon className="h-3.5 w-3.5" />
                  )}
                  {step.label}
                </div>
              </WrapTooltip>
            </div>
          );
        })}
      </div>

      {currentStep === "review" && (
        <Card>
          <CardHeader><CardTitle className="text-base">Review Claim Details</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <span className="text-muted-foreground">Conf #:</span>{" "}
                <span className="font-mono font-semibold">{claim.confNumber}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Date:</span> {formatDate(claim.date)}
              </div>
              <div>
                <span className="text-muted-foreground">Amount:</span>{" "}
                <span className="font-semibold">{formatCurrency(claim.claimAmount)}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Error Type:</span>{" "}
                {claim.errorTypeName || "Unclassified"}
              </div>
              {claim.refNumber && (
                <div className="col-span-2">
                  <span className="text-muted-foreground">Ref #:</span>{" "}
                  <RefNumber value={claim.refNumber} />
                </div>
              )}
              {claim.carNumber && (
                <div>
                  <span className="text-muted-foreground">Car #:</span>{" "}
                  <span className="font-mono">{claim.carNumber}</span>
                </div>
              )}
            </div>
            {claim.errorDetails && (
              <div className="text-sm">
                <span className="text-muted-foreground">Error Details:</span>
                <p className="mt-1 bg-muted/50 p-2 rounded text-xs">{claim.errorDetails}</p>
              </div>
            )}
            <Separator />
            {hasTree ? (
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={() => advanceStep("sop")}
                >
                  <TreeDeciduous className="h-4 w-4 mr-1" />
                  Follow Workflow <ArrowRight className="h-4 w-4 ml-1" />
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setShowHoldDialog(true)}
                >
                  <PauseCircle className="h-4 w-4 mr-1" /> Place on Hold
                </Button>
              </div>
            ) : (
              <div className="bg-amber-50 border border-amber-200 text-amber-800 p-3 rounded-md text-sm space-y-2">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                  <div>
                    <p className="font-medium">Workflow Required</p>
                    <p className="text-xs mt-1">
                      {claim.errorTypeName
                        ? `The error type "${claim.errorTypeName}" does not have a workflow tree defined. An admin needs to add a decision tree workflow to this error type before claims can be processed.`
                        : "This claim does not have an error type assigned. Please assign an error type with a workflow tree from the claim details page before processing."
                      }
                    </p>
                  </div>
                </div>
                <div className="flex gap-2 ml-6">
                  {showDetailsLink && (
                    <Link href={`/claims/${claim.id}`}>
                      <Button size="sm" variant="outline">
                        Go to Claim Details
                      </Button>
                    </Link>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setShowHoldDialog(true)}
                  >
                    <PauseCircle className="h-4 w-4 mr-1" /> Place on Hold
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {currentStep === "sop" && hasTree && parsedTree && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <TreeDeciduous className="h-4 w-4" />
              {errorType?.name || "Workflow"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="min-w-0 overflow-hidden">
              <TreePlayer
                ref={treePlayerRef}
                tree={parsedTree}
                claimId={claim.id}
                initialState={savedTreeState}
                onEvidenceCollected={handleEvidenceCollected}
                onOutcome={(outcomeType: OutcomeType, outcomeLabel: string) => {
                  setTreeOutcomeLabel(outcomeLabel);
                  if (outcomeType === "hold") {
                    setShowHoldDialog(true);
                  }
                }}
                onQueueForPortal={() => advanceStep("submit")}
                onConclude={() => setShowConcludeDialog(true)}
                onPlaceHold={() => setShowHoldDialog(true)}
              />
            </div>
          </CardContent>
        </Card>
      )}

      {currentStep === "submit" && isAlreadyQueued && (
        <Card>
          <CardHeader><CardTitle className="text-base">Submit to MAS Portal</CardTitle></CardHeader>
          <CardContent>
            <div className="bg-green-50 text-green-800 p-3 rounded-md text-sm flex items-start gap-2">
              <CheckCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-medium">Already Queued</p>
                <p className="mt-1 text-xs">
                  This claim is already in "{claim.status}" status and has been queued for portal submission.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {currentStep === "submit" && !isAlreadyQueued && !draftSubmission && (
        <Card>
          <CardHeader><CardTitle className="text-base">Submit to MAS Portal</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="bg-blue-50 text-blue-800 p-3 rounded-md text-sm">
              <p className="font-medium">Ready for Portal Submission</p>
              <p className="mt-1 text-xs">
                Generate a preview of the dispute submission. You'll be able to review and edit the subject,
                dispute text, and portal fields before it's queued for the bot.
              </p>
            </div>
            <div className="text-sm space-y-1">
              <p><span className="text-muted-foreground">Conf #:</span> {claim.confNumber}</p>
              <p><span className="text-muted-foreground">Amount:</span> {formatCurrency(claim.claimAmount)}</p>
              {treeOutcomeLabel && (
                <p><span className="text-muted-foreground">Dispute Reason:</span> <span className="font-medium">{treeOutcomeLabel}</span></p>
              )}
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => advanceStep("sop")}>Back</Button>
              <Button
                size="sm"
                onClick={handleGeneratePreview}
                disabled={generatePreview.isPending}
              >
                {generatePreview.isPending ? (
                  <><Loader2 className="h-4 w-4 mr-1 animate-spin" />Generating Preview...</>
                ) : (
                  <><Eye className="h-4 w-4 mr-1" />Generate Submission Preview</>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {currentStep === "submit" && !isAlreadyQueued && draftSubmission && !draftEditing && (() => {
        const missingFields = [];
        if (!draftSubmission.issueType) missingFields.push("Issue Type");
        if (!draftSubmission.subject) missingFields.push("Subject");
        if (!draftSubmission.requesterEmail) missingFields.push("Email");
        if (!draftSubmission.transportationProviderName) missingFields.push("Provider");
        if (!draftSubmission.phoneNumber) missingFields.push("Phone");
        if (!draftSubmission.descriptionHtml) missingFields.push("Dispute Text");
        const hasMissing = missingFields.length > 0;
        const fieldVal = (val: string | undefined, label?: string) =>
          val ? <span>{val}</span> : <span className="text-red-500 font-medium">Not set</span>;
        return (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              Review Submission
              <Badge variant="outline" className="text-amber-600 border-amber-300">Draft</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {hasMissing && (
              <div className="bg-red-50 border border-red-200 text-red-800 p-3 rounded-md text-sm flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium">Missing required fields</p>
                  <p className="text-xs mt-0.5">The following fields are empty: {missingFields.join(", ")}. Click Edit to fill them in before queuing.</p>
                </div>
              </div>
            )}
            <div className="text-sm font-medium text-muted-foreground uppercase tracking-wider text-xs">Portal Form Fields</div>
            <div className="border rounded-md divide-y text-sm">
              <div className="grid grid-cols-3 gap-2 px-3 py-2">
                <span className="text-muted-foreground">Issue Type</span>
                <span className="col-span-2">{fieldVal(draftSubmission.issueType)}</span>
              </div>
              <div className="grid grid-cols-3 gap-2 px-3 py-2">
                <span className="text-muted-foreground">Subject</span>
                <span className="col-span-2 font-medium break-words">{fieldVal(draftSubmission.subject)}</span>
              </div>
              <div className="grid grid-cols-3 gap-2 px-3 py-2">
                <span className="text-muted-foreground">Email</span>
                <span className="col-span-2">{fieldVal(draftSubmission.requesterEmail)}</span>
              </div>
              <div className="grid grid-cols-3 gap-2 px-3 py-2">
                <span className="text-muted-foreground">Provider Name</span>
                <span className="col-span-2">{fieldVal(draftSubmission.transportationProviderName)}</span>
              </div>
              <div className="grid grid-cols-3 gap-2 px-3 py-2">
                <span className="text-muted-foreground">Phone</span>
                <span className="col-span-2">{fieldVal(draftSubmission.phoneNumber)}</span>
              </div>
              <div className="grid grid-cols-3 gap-2 px-3 py-2">
                <span className="text-muted-foreground">Invoice #</span>
                <span className="col-span-2 font-mono">{draftSubmission.invoiceNumber || "—"}</span>
              </div>
              {draftSubmission.issueType === "GPS Control Deviation" && (
                <div className="grid grid-cols-3 gap-2 px-3 py-2">
                  <span className="text-muted-foreground">GPS Breadcrumbs</span>
                  <span className="col-span-2">{fieldVal(draftSubmission.gpsBreadcrumbsAvailable)}</span>
                </div>
              )}
              <div className="grid grid-cols-3 gap-2 px-3 py-2">
                <span className="text-muted-foreground">Evidence Files</span>
                <div className="col-span-2">
                  <EvidenceFileList urls={draftSubmission.attachmentUrls} />
                </div>
              </div>
            </div>

            <div className="text-sm font-medium text-muted-foreground uppercase tracking-wider text-xs mt-4">Dispute Write-Up</div>
            <div className="bg-muted/50 p-3 rounded-md text-sm whitespace-pre-wrap border max-h-64 overflow-y-auto">
              {draftSubmission.descriptionHtml || <span className="text-red-500 font-medium">No dispute text generated</span>}
            </div>

            {portalSubmitted ? (
              <div className="bg-green-50 text-green-800 p-3 rounded-md text-sm flex items-center gap-2 animate-in fade-in duration-300">
                <CheckCircle className="h-4 w-4 flex-shrink-0" />
                <span className="font-medium">Claim queued for portal submission successfully.</span>
              </div>
            ) : (
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setDraftSubmission(null)}>Back</Button>
                <Button size="sm" variant="outline" onClick={handleEditDraft}>
                  <Edit3 className="h-4 w-4 mr-1" />Edit
                </Button>
                <Button
                  size="sm"
                  onClick={handleConfirmSubmit}
                  disabled={confirmSubmission.isPending || hasMissing}
                >
                  <Send className="h-4 w-4 mr-1" />
                  {confirmSubmission.isPending ? "Queuing..." : "Confirm & Queue"}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
        );
      })()}

      {currentStep === "submit" && !isAlreadyQueued && draftSubmission && draftEditing && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              Edit Submission
              <Badge variant="outline" className="text-blue-600 border-blue-300">Editing</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-3">
              <div className="space-y-1">
                <Label className="text-xs">Issue Type</Label>
                <Select value={editIssueType} onValueChange={setEditIssueType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="GPS Control Deviation">GPS Control Deviation</SelectItem>
                    <SelectItem value="Custom Payment Request">Custom Payment Request</SelectItem>
                    <SelectItem value="MAS Trips App Issue">MAS Trips App Issue</SelectItem>
                    <SelectItem value="Vehicle, Driver, or TPP">Vehicle, Driver, or TPP</SelectItem>
                    <SelectItem value="Zip Code Block">Zip Code Block</SelectItem>
                    <SelectItem value="Other Issue or Question">Other Issue or Question</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Subject</Label>
                <Input value={editSubject} onChange={e => setEditSubject(e.target.value)} />
              </div>
              <Separator />
              <div className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Contact &amp; Account Info</div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Email</Label>
                  <Input value={editEmail} onChange={e => setEditEmail(e.target.value)} placeholder="e.g. accounting@company.com" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Phone</Label>
                  <Input value={editPhone} onChange={e => setEditPhone(e.target.value)} placeholder="e.g. 7185852222" />
                </div>
                <div className="space-y-1 col-span-2">
                  <Label className="text-xs">Provider Name</Label>
                  <Input value={editProvider} onChange={e => setEditProvider(e.target.value)} placeholder="e.g. Agape Luxury Corp" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Invoice #</Label>
                  <Input value={editInvoice} onChange={e => setEditInvoice(e.target.value)} placeholder="Optional" />
                </div>
                {editIssueType === "GPS Control Deviation" && (
                  <div className="space-y-1">
                    <Label className="text-xs">GPS Breadcrumbs Available</Label>
                    <Select value={editGps || "none"} onValueChange={v => setEditGps(v === "none" ? "" : v)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Not set</SelectItem>
                        <SelectItem value="Yes">Yes</SelectItem>
                        <SelectItem value="No">No</SelectItem>
                        <SelectItem value="Unknown">Unknown</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
              <Separator />
              <div className="space-y-1">
                <Label className="text-xs">Dispute Text</Label>
                <Textarea
                  value={editDescription}
                  onChange={e => setEditDescription(e.target.value)}
                  rows={10}
                  className="text-sm font-mono"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setDraftEditing(false)}>Cancel</Button>
              <Button
                size="sm"
                onClick={handleSaveDraft}
                disabled={updateDraft.isPending}
              >
                {updateDraft.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      </>
      )}

      <Dialog open={showHoldDialog} onOpenChange={setShowHoldDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Place Claim on Hold</DialogTitle>
            <p className="text-sm text-muted-foreground">Your progress in the workflow will be saved. When the hold is removed, you'll pick up right where you left off.</p>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Reason for Hold</Label>
              <Input
                value={holdReason}
                onChange={(e) => setHoldReason(e.target.value)}
                placeholder="e.g., Waiting for driver statement"
              />
            </div>
            <div>
              <Label>Pending From</Label>
              <Input
                value={holdPending}
                onChange={(e) => setHoldPending(e.target.value)}
                placeholder="Person or department, e.g., Operations"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowHoldDialog(false)}>
                Cancel
              </Button>
              <Button onClick={handlePlaceHold} disabled={!holdReason}>
                Place on Hold
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showConcludeDialog} onOpenChange={setShowConcludeDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Conclude Claim</DialogTitle>
            <p className="text-sm text-muted-foreground">
              Outcome: <span className="font-medium">{treeOutcomeLabel}</span>. Describe the action taken or next steps so there is a record of the real-life resolution.
            </p>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Resolution Notes</Label>
              <Textarea
                value={concludeNotes}
                onChange={(e) => setConcludeNotes(e.target.value)}
                placeholder="e.g., Ride canceled — driver will not be paid. Notified operations team."
                rows={4}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowConcludeDialog(false)}>
                Cancel
              </Button>
              <Button onClick={handleConclude} disabled={!concludeNotes.trim() || createNote.isPending || updateStatus.isPending}>
                {createNote.isPending || updateStatus.isPending ? "Concluding…" : "Conclude"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
