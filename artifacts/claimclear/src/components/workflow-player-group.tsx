import { useState, useRef } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useUpdateInvoiceGroupStatus,
  useUpdateInvoiceGroupWorkflow,
  useHoldInvoiceGroup,
  useRemoveInvoiceGroupHold,
  useAddInvoiceGroupEvidence,
  useAddClaimEvidence,
  useGetInvoiceGroup,
  useGeneratePortalSubmissionPreview,
  useUpdatePortalSubmissionDraft,
  useConfirmPortalSubmission,
  useRegeneratePortalSubmissionText,
  useRevertPortalSubmissionDescription,
  getListInvoiceGroupsQueryKey,
  getGetInvoiceGroupQueryKey,
  useGetErrorType,
} from "@workspace/api-client-react";
import type { InvoiceGroupResponse } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/format";
import { EvidenceFileList } from "@/components/evidence-file-list";
import {
  ChevronRight, CheckCircle, AlertTriangle, Send, Loader2, Edit3,
  PauseCircle, ArrowRight, Eye, TreeDeciduous, Hash, FileText, Sparkles,
  History, Undo2,
} from "lucide-react";
import { WrapTooltip } from "@/components/info-tooltip";
import { toast } from "@/hooks/use-toast";
import { QualityCheckPanel } from "@/components/quality-check-panel";
import { PresenceLockWrapper } from "@/components/presence-lock";
import { LintGateDialog } from "@/components/lint-gate-dialog";
import type { LintResult } from "@workspace/api-client-react";
import { ApiError } from "@workspace/api-client-react";
import {
  TreePlayer,
  type TreePlayerHandle, type TreePlayerState,
  type DecisionTree, type LegacyTreeNode, type OutcomeType,
  legacyToTree,
} from "@/components/decision-tree";

interface WorkflowPlayerGroupProps {
  group: InvoiceGroupResponse;
  onComplete: () => void;
  showGroupContext?: boolean;
  showDetailsLink?: boolean;
  /**
   * When set, action buttons that mutate group state (Save Changes, Confirm
   * & Queue, Place on Hold, Resume, Generate Preview, Save & Conclude) are
   * disabled and the reason is shown as a tooltip. Used by the queue side
   * panel to lock the workflow when another viewer is on the group.
   */
  presenceLockReason?: string | null;
}

export function WorkflowPlayerGroup({
  group,
  onComplete,
  showGroupContext = false,
  showDetailsLink = true,
  presenceLockReason = null,
}: WorkflowPlayerGroupProps) {
  const presenceLocked = !!presenceLockReason;
  const queryClient = useQueryClient();
  const updateStatus = useUpdateInvoiceGroupStatus();
  const updateWorkflow = useUpdateInvoiceGroupWorkflow();
  const placeHold = useHoldInvoiceGroup();
  const removeHold = useRemoveInvoiceGroupHold();
  const addEvidence = useAddInvoiceGroupEvidence();
  const addClaimEvidence = useAddClaimEvidence();
  const { data: groupDetail } = useGetInvoiceGroup(group.id, {
    query: { queryKey: getGetInvoiceGroupQueryKey(group.id) },
  });
  const generatePreview = useGeneratePortalSubmissionPreview();
  const updateDraft = useUpdatePortalSubmissionDraft();
  const confirmSubmission = useConfirmPortalSubmission();
  const regenerateText = useRegeneratePortalSubmissionText();
  const revertDescription = useRevertPortalSubmissionDescription();
  const [portalSubmitted, setPortalSubmitted] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  const isOnHold = group.status === "On Hold";
  const PORTAL_STATUSES = ["Portal Queued", "Generating Email", "Ready to Review", "Awaiting Response"];
  const isAlreadyQueued = PORTAL_STATUSES.includes(group.status);

  const errorTypeId = group.errorTypeId ? parseInt(group.errorTypeId, 10) : 0;
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

  const workflowProgress = (group.workflowProgress as Record<string, unknown>) ?? {};
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
    descriptionHistory: Array<{ description: string; generatedAt: string; editorEmail?: string | null; editorName?: string | null }>;
    descriptionEditorEmail: string | null;
    descriptionEditorName: string | null;
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
    queryClient.invalidateQueries({ queryKey: getListInvoiceGroupsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetInvoiceGroupQueryKey(group.id) });
  };

  const steps = [
    { id: "review", label: "Review", icon: Eye, tooltip: "Review the invoice group details before following the workflow." },
    { id: "sop", label: "Follow Workflow", icon: TreeDeciduous, tooltip: "Follow the decision tree for this error type. Evidence is collected inline at each step." },
    { id: "submit", label: "Act", icon: Send, tooltip: "Execute the recommended action from the decision tree." },
  ];
  const currentStepIndex = steps.findIndex(s => s.id === currentStep);

  const advanceStep = async (nextStep: string) => {
    const { treeState: _discard, ...cleanProgress } = workflowProgress;
    await updateWorkflow.mutateAsync({
      id: group.id,
      data: { workflowProgress: { ...cleanProgress, currentStep: nextStep } },
    });
    invalidate();
  };

  const handleGeneratePreview = async () => {
    const result = await generatePreview.mutateAsync({
      data: { invoiceGroupId: group.id, disputeReason: treeOutcomeLabel || undefined },
    });
    const draft = result as unknown as Record<string, unknown>;
    const attachUrls = (Array.isArray(draft.attachmentUrls) ? draft.attachmentUrls : []) as string[];
    const history = (Array.isArray(draft.descriptionHistory) ? draft.descriptionHistory : []) as Array<{ description: string; generatedAt: string; editorEmail?: string | null; editorName?: string | null }>;
    setDraftSubmission({
      id: draft.id as number,
      subject: (draft.subject as string) || "",
      descriptionHtml: (draft.descriptionHtml as string) || "",
      descriptionHistory: history,
      descriptionEditorEmail: (draft.descriptionEditorEmail as string | null) ?? null,
      descriptionEditorName: (draft.descriptionEditorName as string | null) ?? null,
      issueType: (draft.issueType as string) || "",
      gpsBreadcrumbsAvailable: (draft.gpsBreadcrumbsAvailable as string) || "",
      requesterEmail: (draft.requesterEmail as string) || "",
      transportationProviderName: (draft.transportationProviderName as string) || "",
      phoneNumber: (draft.phoneNumber as string) || "",
      invoiceNumber: (draft.invoiceNumber as string) || "",
      attachmentUrls: attachUrls,
    });
    setDraftEditing(false);
    setHistoryOpen(false);
    setPreviewIndex(null);
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
    const result = await updateDraft.mutateAsync({
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
    const updated = result as unknown as { descriptionHistory?: Array<{ description: string; generatedAt: string; editorEmail?: string | null; editorName?: string | null }>; descriptionEditorEmail?: string | null; descriptionEditorName?: string | null };
    setDraftSubmission({
      ...draftSubmission,
      subject: editSubject,
      descriptionHtml: editDescription,
      descriptionHistory: Array.isArray(updated.descriptionHistory) ? updated.descriptionHistory : draftSubmission.descriptionHistory,
      descriptionEditorEmail: updated.descriptionEditorEmail ?? draftSubmission.descriptionEditorEmail,
      descriptionEditorName: updated.descriptionEditorName ?? draftSubmission.descriptionEditorName,
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

  const handleRegenerateText = async () => {
    if (!draftSubmission) return;
    try {
      const result = await regenerateText.mutateAsync({ id: draftSubmission.id });
      const updated = result as unknown as { descriptionHtml?: string; descriptionHistory?: Array<{ description: string; generatedAt: string; editorEmail?: string | null; editorName?: string | null }>; descriptionEditorEmail?: string | null; descriptionEditorName?: string | null };
      setDraftSubmission({
        ...draftSubmission,
        descriptionHtml: updated.descriptionHtml || "",
        descriptionHistory: Array.isArray(updated.descriptionHistory) ? updated.descriptionHistory : draftSubmission.descriptionHistory,
        descriptionEditorEmail: updated.descriptionEditorEmail ?? null,
        descriptionEditorName: updated.descriptionEditorName ?? null,
      });
      setPreviewIndex(null);
      toast({ title: "Dispute write-up regenerated", description: "The previous version was saved to history." });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Please try again.";
      toast({ title: "Could not regenerate write-up", description: message, variant: "destructive" });
    }
  };

  const handleRevertToVersion = async (index: number) => {
    if (!draftSubmission) return;
    try {
      const result = await revertDescription.mutateAsync({ id: draftSubmission.id, data: { index } });
      const updated = result as unknown as { descriptionHtml?: string; descriptionHistory?: Array<{ description: string; generatedAt: string; editorEmail?: string | null; editorName?: string | null }>; descriptionEditorEmail?: string | null; descriptionEditorName?: string | null };
      setDraftSubmission({
        ...draftSubmission,
        descriptionHtml: updated.descriptionHtml || "",
        descriptionHistory: Array.isArray(updated.descriptionHistory) ? updated.descriptionHistory : [],
        descriptionEditorEmail: updated.descriptionEditorEmail ?? null,
        descriptionEditorName: updated.descriptionEditorName ?? null,
      });
      setPreviewIndex(null);
      toast({ title: "Reverted to previous version", description: "The current version was moved into history." });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Please try again.";
      toast({ title: "Could not revert write-up", description: message, variant: "destructive" });
    }
  };

  const [lintResults, setLintResults] = useState<LintResult[]>([]);
  const [lintGate, setLintGate] = useState<{ open: boolean; mode: "fail" | "warn"; results: LintResult[] }>({ open: false, mode: "fail", results: [] });

  const submitConfirm = async (ack: boolean) => {
    if (!draftSubmission) return;
    try {
      await confirmSubmission.mutateAsync({ id: draftSubmission.id, data: ack ? { ack: true } : {} });
      setLintGate({ open: false, mode: "fail", results: [] });
      setPortalSubmitted(true);
      invalidate();
      setTimeout(() => {
        setDraftSubmission(null);
        onComplete();
      }, 2000);
    } catch (err) {
      if (err instanceof ApiError && err.status === 422) {
        const data = err.data as { failures?: LintResult[] } | null;
        const failures = data?.failures ?? [];
        const hasFail = failures.some(f => f.severity === "fail");
        setLintGate({ open: true, mode: hasFail ? "fail" : "warn", results: failures });
        return;
      }
      const message = err instanceof Error ? err.message : "Please try again.";
      toast({ title: "Could not queue submission", description: message, variant: "destructive" });
    }
  };

  const handleConfirmSubmit = async () => {
    const failures = lintResults.filter(r => r.severity === "fail");
    const warnings = lintResults.filter(r => r.severity === "warn");
    if (failures.length > 0) {
      setLintGate({ open: true, mode: "fail", results: lintResults });
      return;
    }
    if (warnings.length > 0) {
      setLintGate({ open: true, mode: "warn", results: warnings });
      return;
    }
    await submitConfirm(false);
  };

  const handlePlaceHold = async () => {
    const treeState = treePlayerRef.current?.getState();
    const holdStep = currentStep === "sop" && treeState ? "sop" : currentStep;
    await updateWorkflow.mutateAsync({
      id: group.id,
      data: { workflowProgress: { ...workflowProgress, currentStep: holdStep, treeState: treeState || undefined } },
    });
    await placeHold.mutateAsync({
      id: group.id,
      data: { reason: holdReason || undefined },
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
    await updateStatus.mutateAsync({
      id: group.id,
      data: { status: finalStatus, reason: `${treeOutcomeLabel ? `${treeOutcomeLabel}: ` : ""}${concludeNotes.trim()}` },
    });
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
    scope?: string;
  }) => {
    const scopedClaimId = evidence.scope && evidence.scope !== "group" ? Number(evidence.scope) : null;
    try {
      if (scopedClaimId && Number.isFinite(scopedClaimId)) {
        await addClaimEvidence.mutateAsync({
          claimId: scopedClaimId,
          data: {
            evidenceTypeId: evidence.evidenceTypeId,
            evidenceTypeName: evidence.evidenceTypeName,
            treeNodeId: evidence.treeNodeId,
            imageUrl: evidence.imageUrl,
            notes: evidence.notes,
          },
        });
      } else {
        await addEvidence.mutateAsync({
          id: group.id,
          data: {
            evidenceTypeId: evidence.evidenceTypeId,
            evidenceTypeName: evidence.evidenceTypeName,
            treeNodeId: evidence.treeNodeId,
            imageUrl: evidence.imageUrl,
            notes: evidence.notes,
          },
        });
      }
    } catch {}
  };

  const evidenceLegs = (() => {
    const detail = groupDetail as unknown as { rides?: Array<{ id: number; confNumber?: string | null; date?: string | null }> } | undefined;
    const rides = detail?.rides ?? [];
    if (rides.length < 2) return undefined;
    return rides.map((r, i) => ({
      id: r.id,
      label: `Leg ${i + 1}${r.confNumber ? ` — Conf ${r.confNumber}` : ""}`,
    }));
  })();

  const handleResumeFromHold = async () => {
    await removeHold.mutateAsync({ id: group.id });
    invalidate();
  };

  return (
    <div className="space-y-4">
      {showGroupContext && (
        <div className="bg-muted/50 border rounded-lg px-4 py-3">
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <div className="flex items-center gap-2">
              <Hash className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="text-muted-foreground">Invoice #:</span>
              <span className="font-mono font-semibold">{group.invoiceNumber}</span>
            </div>
            <div className="flex items-center gap-2">
              <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="text-muted-foreground">Rides:</span>
              <span>{group.rideCount}</span>
            </div>
            {group.totalAmount && (
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Amount:</span>
                <span className="font-semibold">{formatCurrency(group.totalAmount)}</span>
              </div>
            )}
            {group.errorTypeName && (
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Error Type:</span>
                <span>{group.errorTypeName}</span>
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
                <p className="text-sm font-semibold text-purple-800 dark:text-purple-300">This invoice group is on hold</p>
                <p className="text-sm text-purple-700 dark:text-purple-400">{group.holdReason}</p>
                {group.holdPendingFrom && (
                  <p className="text-xs text-purple-600 dark:text-purple-500">Pending from: {group.holdPendingFrom}</p>
                )}
                {savedTreeState && savedTreeState.steps.length > 0 && (
                  <p className="text-xs text-purple-600 dark:text-purple-500 mt-1">
                    {savedTreeState.steps.length} workflow step{savedTreeState.steps.length !== 1 ? "s" : ""} completed — progress will be restored on resume.
                  </p>
                )}
              </div>
            </div>
            <div className="flex gap-2 ml-8">
              <PresenceLockWrapper reason={presenceLockReason}>
                <Button size="sm" onClick={handleResumeFromHold} disabled={presenceLocked}>
                  <ArrowRight className="h-4 w-4 mr-1" />Resume Workflow
                </Button>
              </PresenceLockWrapper>
              {showDetailsLink && (
                <Link href={`/invoice-groups/${group.id}`}>
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
                      {isComplete ? <CheckCircle className="h-3.5 w-3.5" /> : <StepIcon className="h-3.5 w-3.5" />}
                      {step.label}
                    </div>
                  </WrapTooltip>
                </div>
              );
            })}
          </div>

          {currentStep === "review" && (
            <Card>
              <CardHeader><CardTitle className="text-base">Review Invoice Group</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <span className="text-muted-foreground">Invoice #:</span>{" "}
                    <span className="font-mono font-semibold">{group.invoiceNumber}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Rides:</span> {group.rideCount}
                  </div>
                  <div>
                    <span className="text-muted-foreground">Amount:</span>{" "}
                    <span className="font-semibold">{formatCurrency(group.totalAmount)}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Error Type:</span>{" "}
                    {group.errorTypeName || "Unclassified"}
                  </div>
                  {group.clientNumber && (
                    <div>
                      <span className="text-muted-foreground">Client #:</span>{" "}
                      <span className="font-mono">{group.clientNumber}</span>
                    </div>
                  )}
                </div>
                {group.errorDetails && (
                  <div className="text-sm">
                    <span className="text-muted-foreground">Error Details:</span>
                    <p className="mt-1 bg-muted/50 p-2 rounded text-xs">{group.errorDetails}</p>
                  </div>
                )}
                <Separator />
                {hasTree ? (
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => advanceStep("sop")}>
                      <TreeDeciduous className="h-4 w-4 mr-1" />
                      Follow Workflow <ArrowRight className="h-4 w-4 ml-1" />
                    </Button>
                    <PresenceLockWrapper reason={presenceLockReason}>
                      <Button size="sm" variant="outline" onClick={() => setShowHoldDialog(true)} disabled={presenceLocked}>
                        <PauseCircle className="h-4 w-4 mr-1" /> Place on Hold
                      </Button>
                    </PresenceLockWrapper>
                  </div>
                ) : (
                  <div className="bg-amber-50 border border-amber-200 text-amber-800 p-3 rounded-md text-sm space-y-2">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                      <div>
                        <p className="font-medium">Workflow Required</p>
                        <p className="text-xs mt-1">
                          {group.errorTypeName
                            ? `The error type "${group.errorTypeName}" does not have a workflow tree defined. An admin needs to add a decision tree workflow before this group can be processed.`
                            : "This invoice group does not have an error type assigned. Please assign an error type with a workflow tree before processing."
                          }
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-2 ml-6">
                      {showDetailsLink && (
                        <Link href={`/invoice-groups/${group.id}`}>
                          <Button size="sm" variant="outline">Go to Group Details</Button>
                        </Link>
                      )}
                      <PresenceLockWrapper reason={presenceLockReason}>
                        <Button size="sm" variant="outline" onClick={() => setShowHoldDialog(true)} disabled={presenceLocked}>
                          <PauseCircle className="h-4 w-4 mr-1" /> Place on Hold
                        </Button>
                      </PresenceLockWrapper>
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
                    claimId={group.id}
                    target={{ kind: "group", id: group.id }}
                    initialState={savedTreeState}
                    legs={evidenceLegs}
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
                    actionsDisabledReason={presenceLockReason}
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
                      This invoice group is in "{group.status}" status and has been queued for portal submission.
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
                    Generate a preview of the dispute submission for this invoice group. You'll be able to review and edit
                    the subject, dispute text, and portal fields — covering all {group.rideCount} ride{group.rideCount === 1 ? "" : "s"} on the invoice — before it's queued for the bot.
                  </p>
                </div>
                <div className="text-sm space-y-1">
                  <p><span className="text-muted-foreground">Invoice #:</span> {group.invoiceNumber}</p>
                  <p><span className="text-muted-foreground">Rides:</span> {group.rideCount}</p>
                  <p><span className="text-muted-foreground">Amount:</span> {formatCurrency(group.totalAmount)}</p>
                  {treeOutcomeLabel && (
                    <p><span className="text-muted-foreground">Dispute Reason:</span> <span className="font-medium">{treeOutcomeLabel}</span></p>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => advanceStep("sop")}>Back</Button>
                  <PresenceLockWrapper reason={presenceLockReason}>
                    <Button size="sm" onClick={handleGeneratePreview} disabled={generatePreview.isPending || presenceLocked}>
                      {generatePreview.isPending ? (
                        <><Loader2 className="h-4 w-4 mr-1 animate-spin" />Generating Preview...</>
                      ) : (
                        <><Eye className="h-4 w-4 mr-1" />Generate Submission Preview</>
                      )}
                    </Button>
                  </PresenceLockWrapper>
                </div>
              </CardContent>
            </Card>
          )}

          {currentStep === "submit" && !isAlreadyQueued && draftSubmission && !draftEditing && (() => {
            const missingFields: string[] = [];
            if (!draftSubmission.issueType) missingFields.push("Issue Type");
            if (!draftSubmission.subject) missingFields.push("Subject");
            if (!draftSubmission.requesterEmail) missingFields.push("Email");
            if (!draftSubmission.transportationProviderName) missingFields.push("Provider");
            if (!draftSubmission.phoneNumber) missingFields.push("Phone");
            if (!draftSubmission.descriptionHtml) missingFields.push("Dispute Text");
            const hasMissing = missingFields.length > 0;
            const fieldVal = (val: string | undefined) =>
              val ? <span>{val}</span> : <span className="text-red-500 font-medium">Not set</span>;
            return (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    Review Submission
                    <Badge variant="outline" className="text-amber-600 border-amber-300">Draft</Badge>
                    <Badge variant="outline" className="text-blue-600 border-blue-300">Group · {group.rideCount} ride{group.rideCount === 1 ? "" : "s"}</Badge>
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

                  <div className="flex items-center justify-between mt-4">
                    <div className="text-sm font-medium text-muted-foreground uppercase tracking-wider text-xs">Dispute Write-Up</div>
                    <div className="flex items-center gap-1">
                      {draftSubmission.descriptionHistory.length > 0 && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs gap-1"
                          onClick={() => setHistoryOpen(o => !o)}
                        >
                          <History className="h-3 w-3" />
                          {historyOpen ? "Hide History" : `History (${draftSubmission.descriptionHistory.length})`}
                        </Button>
                      )}
                      <PresenceLockWrapper reason={presenceLockReason ?? null}>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs gap-1"
                          onClick={handleRegenerateText}
                          disabled={regenerateText.isPending || revertDescription.isPending || !!presenceLockReason}
                        >
                          {regenerateText.isPending ? (
                            <><Loader2 className="h-3 w-3 animate-spin" />Regenerating...</>
                          ) : (
                            <><Sparkles className="h-3 w-3" />Regenerate Text</>
                          )}
                        </Button>
                      </PresenceLockWrapper>
                    </div>
                  </div>
                  <div className="bg-muted/50 p-3 rounded-md text-sm whitespace-pre-wrap border max-h-64 overflow-y-auto">
                    {regenerateText.isPending ? (
                      <span className="text-muted-foreground italic flex items-center gap-2">
                        <Loader2 className="h-3 w-3 animate-spin" />Generating a fresh write-up…
                      </span>
                    ) : (
                      draftSubmission.descriptionHtml || <span className="text-red-500 font-medium">No dispute text generated</span>
                    )}
                  </div>
                  {(draftSubmission.descriptionEditorName || draftSubmission.descriptionEditorEmail) && !regenerateText.isPending && (
                    <div className="text-xs text-muted-foreground">
                      Last updated by {draftSubmission.descriptionEditorName || draftSubmission.descriptionEditorEmail}
                    </div>
                  )}
                  {historyOpen && draftSubmission.descriptionHistory.length > 0 && (
                    <div className="border rounded-md divide-y">
                      <div className="px-3 py-2 bg-muted/30 text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                        <History className="h-3 w-3" />Previous versions
                      </div>
                      {draftSubmission.descriptionHistory.map((entry, idx) => {
                        const isExpanded = previewIndex === idx;
                        let when = entry.generatedAt;
                        try { when = new Date(entry.generatedAt).toLocaleString(); } catch { /* keep raw */ }
                        return (
                          <div key={`${entry.generatedAt}-${idx}`} className="px-3 py-2 space-y-2">
                            <div className="flex items-center justify-between gap-2">
                              <div className="text-xs">
                                <span className="font-medium">Version {draftSubmission.descriptionHistory.length - idx}</span>
                                <span className="text-muted-foreground"> · {when}</span>
                                {(entry.editorName || entry.editorEmail) && (
                                  <span className="text-muted-foreground"> · by {entry.editorName || entry.editorEmail}</span>
                                )}
                              </div>
                              <div className="flex items-center gap-1">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 text-xs gap-1"
                                  onClick={() => setPreviewIndex(isExpanded ? null : idx)}
                                >
                                  <Eye className="h-3 w-3" />{isExpanded ? "Hide" : "Preview"}
                                </Button>
                                <PresenceLockWrapper reason={presenceLockReason ?? null}>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 text-xs gap-1"
                                    onClick={() => handleRevertToVersion(idx)}
                                    disabled={revertDescription.isPending || regenerateText.isPending || !!presenceLockReason}
                                  >
                                    <Undo2 className="h-3 w-3" />Revert to this
                                  </Button>
                                </PresenceLockWrapper>
                              </div>
                            </div>
                            {isExpanded && (
                              <div className="bg-background p-2 rounded border text-xs whitespace-pre-wrap max-h-48 overflow-y-auto">
                                {entry.description}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <QualityCheckPanel
                    submissionId={draftSubmission.id}
                    refreshKey={draftSubmission.descriptionHtml}
                    onResults={setLintResults}
                  />

                  {portalSubmitted ? (
                    <div className="bg-green-50 text-green-800 p-3 rounded-md text-sm flex items-center gap-2 animate-in fade-in duration-300">
                      <CheckCircle className="h-4 w-4 flex-shrink-0" />
                      <span className="font-medium">Invoice group queued for portal submission successfully.</span>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => setDraftSubmission(null)}>Back</Button>
                      <Button size="sm" variant="outline" onClick={handleEditDraft}>
                        <Edit3 className="h-4 w-4 mr-1" />Edit
                      </Button>
                      <PresenceLockWrapper reason={presenceLockReason}>
                        <Button
                          size="sm"
                          onClick={handleConfirmSubmit}
                          disabled={confirmSubmission.isPending || hasMissing || presenceLocked}
                        >
                          <Send className="h-4 w-4 mr-1" />
                          {confirmSubmission.isPending ? "Queuing..." : "Confirm & Queue"}
                        </Button>
                      </PresenceLockWrapper>
                    </div>
                  )}

                  <LintGateDialog
                    open={lintGate.open}
                    mode={lintGate.mode}
                    results={lintGate.results}
                    pending={confirmSubmission.isPending}
                    onClose={() => setLintGate(s => ({ ...s, open: false }))}
                    onConfirmAnyway={() => submitConfirm(true)}
                  />
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
                  <PresenceLockWrapper reason={presenceLockReason}>
                    <Button size="sm" onClick={handleSaveDraft} disabled={updateDraft.isPending || presenceLocked}>
                      {updateDraft.isPending ? "Saving..." : "Save Changes"}
                    </Button>
                  </PresenceLockWrapper>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      <Dialog open={showHoldDialog} onOpenChange={setShowHoldDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Place Invoice Group on Hold</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="hold-reason">Reason</Label>
              <Textarea
                id="hold-reason"
                value={holdReason}
                onChange={(e) => setHoldReason(e.target.value)}
                placeholder="Why is this on hold?"
              />
            </div>
            <div>
              <Label htmlFor="hold-pending">Pending From (optional)</Label>
              <Select value={holdPending} onValueChange={setHoldPending}>
                <SelectTrigger id="hold-pending"><SelectValue placeholder="Select source" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="vendor">Vendor</SelectItem>
                  <SelectItem value="payor">Payor</SelectItem>
                  <SelectItem value="internal">Internal</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setShowHoldDialog(false)}>Cancel</Button>
              <PresenceLockWrapper reason={presenceLockReason}>
                <Button onClick={handlePlaceHold} disabled={!holdReason.trim() || presenceLocked}>Place on Hold</Button>
              </PresenceLockWrapper>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showConcludeDialog} onOpenChange={setShowConcludeDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Conclude Invoice Group</DialogTitle></DialogHeader>
          <div className="space-y-3">
            {treeOutcomeLabel && (
              <div className="text-sm">
                <span className="text-muted-foreground">Outcome:</span>{" "}
                <span className="font-medium">{treeOutcomeLabel}</span>
              </div>
            )}
            <div>
              <Label htmlFor="conclude-notes">Notes</Label>
              <Textarea
                id="conclude-notes"
                value={concludeNotes}
                onChange={(e) => setConcludeNotes(e.target.value)}
                placeholder="Document the conclusion..."
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setShowConcludeDialog(false)}>Cancel</Button>
              <PresenceLockWrapper reason={presenceLockReason}>
                <Button onClick={handleConclude} disabled={!concludeNotes.trim() || presenceLocked}>Save & Conclude</Button>
              </PresenceLockWrapper>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
