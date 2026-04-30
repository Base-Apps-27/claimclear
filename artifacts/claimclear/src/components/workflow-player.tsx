import { useState, useRef } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useUpdateClaimStatus,
  useUpdateClaimWorkflow,
  usePlaceClaimOnHold,
  useRemoveClaimHold,
  useGeneratePortalSubmissionPreview,
  usePortalUnderstandingPreflight,
  useUpdatePortalSubmissionDraft,
  useConfirmPortalSubmission,
  useRegeneratePortalSubmissionText,
  useRevertPortalSubmissionDescription,
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
  PauseCircle, ArrowRight, Eye, TreeDeciduous, Car, Calendar, Hash, Sparkles,
  History, Undo2, BrainCircuit, RefreshCw, X,
} from "lucide-react";
import { WrapTooltip } from "@/components/info-tooltip";
import { toast } from "@/hooks/use-toast";
import { QualityCheckPanel } from "@/components/quality-check-panel";
import { LintGateDialog } from "@/components/lint-gate-dialog";
import type { LintResult } from "@workspace/api-client-react";
import { ApiError } from "@workspace/api-client-react";
import { closureReasonLabel } from "@/lib/closure-reasons";
import { getLifecyclePhase } from "@/lib/lifecycle-phase";
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
  /**
   * Defense-in-depth: when the parent already knows how many portal
   * submissions exist for this claim, pass the count here so the player can
   * disable "Generate Submission Preview" if any history exists. Prevents a
   * second draft being spawned while a real submission is still on the books
   * (active or historical) — the server enforces this too, but failing fast
   * in the UI keeps the operator from paying for a wasted round-trip.
   */
  historicalSubmissionsCount?: number;
}

export function WorkflowPlayer({
  claim,
  onComplete,
  showClaimContext = false,
  showDetailsLink = true,
  historicalSubmissionsCount = 0,
}: WorkflowPlayerProps) {
  const queryClient = useQueryClient();
  const updateStatus = useUpdateClaimStatus();
  const updateWorkflow = useUpdateClaimWorkflow();
  const placeHold = usePlaceClaimOnHold();
  const removeHold = useRemoveClaimHold();
  const generatePreview = useGeneratePortalSubmissionPreview();
  const preflightUnderstanding = usePortalUnderstandingPreflight();
  const updateDraft = useUpdatePortalSubmissionDraft();
  const confirmSubmission = useConfirmPortalSubmission();
  const regenerateText = useRegeneratePortalSubmissionText();
  const revertDescription = useRevertPortalSubmissionDescription();
  const addEvidence = useAddClaimEvidence();
  const createNote = useCreateClaimNote();
  const phase = getLifecyclePhase(claim.status);
  const isOnHold = phase === "on-hold";
  const [portalSubmitted, setPortalSubmitted] = useState(false);

  // The pre-submit stepper's "Submit" step doubles as a "you're already
  // queued" confirmation when the dispute moved on without going through
  // this player. Now that lifecycle-phase short-circuits in-flight before
  // we get here, this branch only fires defensively if status drifted.
  const isAlreadyQueued = phase === "in-flight" || phase === "response-pending";

  // Defense-in-depth: even when phase=pre-submit, refuse to spawn a fresh
  // draft if the server already has a submission row for this claim. The
  // operator should resume the existing draft (visible on the detail page)
  // rather than create a parallel one.
  const canGenerateNewPreview = historicalSubmissionsCount === 0;

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
    specialCircumstances: string | null;
    understandingReadback: string | null;
  } | null>(null);
  // "Pre-generate" inputs on the Ready-to-Submit card. The operator types any
  // narrative-changing context, runs the AI readback check, and only after a
  // confirmed (still-unedited) readback can they generate the full draft.
  const [preflightContext, setPreflightContext] = useState("");
  const [preflightReadback, setPreflightReadback] = useState<string | null>(null);
  // Tracks the exact context string the readback was generated from. If the
  // textarea drifts from this, we treat the readback as stale and re-gate.
  const [preflightReadbackForContext, setPreflightReadbackForContext] = useState<string | null>(null);
  // Editable special-circumstances state for the Review card.
  const [reviewContextEditing, setReviewContextEditing] = useState(false);
  const [reviewContextDraft, setReviewContextDraft] = useState("");
  const [reviewReadback, setReviewReadback] = useState<string | null>(null);
  const [reviewReadbackForContext, setReviewReadbackForContext] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
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

  const trimmedPreflightContext = preflightContext.trim();
  const preflightReadbackIsFresh =
    preflightReadback !== null && preflightReadbackForContext === trimmedPreflightContext;
  // The full draft cannot be generated until the operator has confirmed a
  // fresh AI readback — even when no special circumstances were supplied.
  // This guarantees the operator sees how the AI is interpreting the dispute
  // before any text is written.
  const preflightGateBlocked = !preflightReadbackIsFresh;

  const handleCheckUnderstanding = async () => {
    const ctxText = preflightContext.trim();
    const result = await preflightUnderstanding.mutateAsync({
      data: {
        claimId: claim.id,
        disputeReason: treeOutcomeLabel || undefined,
        specialCircumstances: ctxText || undefined,
      },
    });
    setPreflightReadback(result.readback);
    setPreflightReadbackForContext(ctxText);
  };

  const handleGeneratePreview = async () => {
    const ctxText = preflightContext.trim();
    if (!preflightReadbackIsFresh) {
      toast({
        variant: "destructive",
        title: "Confirm AI understanding first",
        description: "Run \"Check understanding\" and review the AI's restatement before generating the draft.",
      });
      return;
    }
    const result = await generatePreview.mutateAsync({
      data: {
        claimId: claim.id,
        disputeReason: treeOutcomeLabel || undefined,
        specialCircumstances: ctxText || undefined,
        understandingReadback: preflightReadback || undefined,
      },
    });
    const draft = result as unknown as Record<string, unknown>;
    const attachUrls = (Array.isArray(draft.attachmentUrls) ? draft.attachmentUrls : []) as string[];
    const history = (Array.isArray(draft.descriptionHistory) ? draft.descriptionHistory : []) as Array<{ description: string; generatedAt: string; editorEmail?: string | null; editorName?: string | null }>;
    const savedSpecial = (draft.specialCircumstances as string | null) ?? null;
    const savedReadback = (draft.understandingReadback as string | null) ?? null;
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
      specialCircumstances: savedSpecial,
      understandingReadback: savedReadback,
    });
    setReviewReadback(savedReadback);
    setReviewReadbackForContext((savedSpecial || "").trim());
    setReviewContextEditing(false);
    setReviewContextDraft("");
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

  const reviewSavedContext = (draftSubmission?.specialCircumstances || "").trim();
  const reviewSavedReadback = (draftSubmission?.understandingReadback || "").trim();
  const reviewReadbackIsFresh =
    reviewReadback !== null && reviewReadbackForContext === reviewSavedContext;
  // Universal regenerate gate: block whenever the submission has lost its
  // saved readback (e.g., context was cleared post-generation) OR the
  // operator has unsaved context edits without a fresh re-check. This
  // mirrors the API guard so the button is never the only thing standing
  // between an operator and an unconfirmed regeneration.
  const reviewRegenerateBlocked =
    reviewSavedReadback.length === 0 ||
    (reviewSavedContext.length > 0 && !reviewReadbackIsFresh);

  const handleCheckReviewUnderstanding = async () => {
    if (!draftSubmission) return;
    const ctxText = (reviewContextEditing ? reviewContextDraft : reviewSavedContext).trim();
    const result = await preflightUnderstanding.mutateAsync({
      data: {
        claimId: claim.id,
        disputeReason: treeOutcomeLabel || draftSubmission.subject || undefined,
        specialCircumstances: ctxText || undefined,
      },
    });
    setReviewReadback(result.readback);
    setReviewReadbackForContext(ctxText);
  };

  const handleSaveReviewContext = async () => {
    if (!draftSubmission) return;
    const ctxText = reviewContextDraft.trim();
    // Universal: a fresh readback that matches the current context (empty or
    // not) is required before persisting any change to the dispute context.
    if (reviewReadback === null || reviewReadbackForContext !== ctxText) {
      toast({
        variant: "destructive",
        title: "Confirm AI understanding first",
        description: "Run the understanding check on the current context before saving.",
      });
      return;
    }
    try {
      const result = await updateDraft.mutateAsync({
        id: draftSubmission.id,
        data: {
          specialCircumstances: ctxText,
          understandingReadback: reviewReadback,
        },
      });
      const updated = result as unknown as Record<string, unknown>;
      const newSpecial = (updated.specialCircumstances as string | null) ?? null;
      const newReadback = (updated.understandingReadback as string | null) ?? null;
      setDraftSubmission({
        ...draftSubmission,
        specialCircumstances: newSpecial,
        understandingReadback: newReadback,
      });
      setReviewReadback(newReadback);
      setReviewReadbackForContext((newSpecial || "").trim());
      setReviewContextEditing(false);
      setReviewContextDraft("");
      toast({ title: "Context updated", description: "Regenerate the write-up to apply the new context." });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Please try again.";
      toast({ title: "Could not update context", description: message, variant: "destructive" });
    }
  };

  const handleRegenerateText = async () => {
    if (!draftSubmission) return;
    if (reviewRegenerateBlocked) {
      toast({
        variant: "destructive",
        title: "Re-check AI understanding",
        description: "Special circumstances were edited. Confirm the AI readback (and Save) before regenerating.",
      });
      return;
    }
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
    scope?: string;
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

  // Lifecycle-phase override: once the claim has crossed into the portal /
  // response / closed phases the pre-submit stepper is misleading (the
  // operator can't go back to "Build Case"). Render a compact summary panel
  // for those phases instead, keeping the on-hold and pre-submit flows
  // untouched.
  if (phase === "in-flight") {
    return (
      <div className="space-y-4" data-testid="player-phase-in-flight">
        {showClaimContext && (
          <div className="bg-muted/50 border rounded-lg px-4 py-3 text-sm">
            <span className="text-muted-foreground">Conf #:</span>{" "}
            <span className="font-mono font-semibold">{claim.confNumber}</span>
          </div>
        )}
        <Card className="border-blue-200 bg-blue-50/40">
          <CardContent className="py-4 space-y-3">
            <div className="flex items-start gap-3">
              <Send className="h-5 w-5 text-blue-600 mt-0.5 shrink-0" />
              <div className="flex-1 space-y-1">
                <p className="text-sm font-semibold text-blue-900">In flight — submission is with the payer</p>
                <p className="text-sm text-blue-800">
                  This claim is currently in <span className="font-semibold">{claim.status}</span>. No
                  manual action is required while we wait for the payer to respond.
                </p>
                <p className="text-xs text-blue-700">
                  When a response lands, the workflow will reopen for review automatically.
                </p>
              </div>
            </div>
            {showDetailsLink && (
              <div className="flex gap-2 ml-8">
                <Link href={`/claims/${claim.id}`}>
                  <Button size="sm" variant="outline">Full Details</Button>
                </Link>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (phase === "response-pending") {
    return (
      <div className="space-y-4" data-testid="player-phase-response-pending">
        {showClaimContext && (
          <div className="bg-muted/50 border rounded-lg px-4 py-3 text-sm">
            <span className="text-muted-foreground">Conf #:</span>{" "}
            <span className="font-mono font-semibold">{claim.confNumber}</span>
          </div>
        )}
        <Card className="border-amber-200 bg-amber-50/40">
          <CardContent className="py-4 space-y-3">
            <div className="flex items-start gap-3">
              <ArrowRight className="h-5 w-5 text-amber-700 mt-0.5 shrink-0" />
              <div className="flex-1 space-y-1">
                <p className="text-sm font-semibold text-amber-900">Response received — pick a verdict</p>
                <p className="text-sm text-amber-800">
                  A payer response is waiting on this claim. Open the full detail page to read the
                  message and choose Resolve, Re-dispute, or Mark as Denied.
                </p>
              </div>
            </div>
            {showDetailsLink && (
              <div className="flex gap-2 ml-8">
                <Link href={`/claims/${claim.id}`}>
                  <Button size="sm">Open Full Details<ArrowRight className="h-4 w-4 ml-1" /></Button>
                </Link>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (phase === "closed") {
    const isResolved = claim.status === "Resolved";
    return (
      <div className="space-y-4" data-testid="player-phase-closed">
        {showClaimContext && (
          <div className="bg-muted/50 border rounded-lg px-4 py-3 text-sm">
            <span className="text-muted-foreground">Conf #:</span>{" "}
            <span className="font-mono font-semibold">{claim.confNumber}</span>
          </div>
        )}
        <Card className={isResolved
          ? "border-green-200 bg-green-50/40"
          : "border-zinc-200 bg-zinc-50/40"}>
          <CardContent className="py-4 space-y-3">
            <div className="flex items-start gap-3">
              <CheckCircle className={`h-5 w-5 mt-0.5 shrink-0 ${isResolved ? "text-green-600" : "text-zinc-500"}`} />
              <div className="flex-1 space-y-1">
                <p className={`text-sm font-semibold ${isResolved ? "text-green-900" : "text-zinc-800"}`}>
                  Closed — {claim.status}
                </p>
                {claim.outcome && claim.outcome !== "Pending" && (
                  <p className="text-sm">
                    <span className="text-muted-foreground">Outcome:</span>{" "}
                    <span className="font-medium">{claim.outcome}</span>
                  </p>
                )}
                {claim.closureReason && (
                  <p className="text-sm">
                    <span className="text-muted-foreground">Reason:</span>{" "}
                    <span className="font-medium">{closureReasonLabel(claim.closureReason)}</span>
                  </p>
                )}
                {claim.approvedAmount && (
                  <p className="text-sm">
                    <span className="text-muted-foreground">Approved amount:</span>{" "}
                    <span className="font-semibold">{formatCurrency(claim.approvedAmount)}</span>
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  Nothing further to do — open the full details if you need to review the audit trail.
                </p>
              </div>
            </div>
            {showDetailsLink && (
              <div className="flex gap-2 ml-8">
                <Link href={`/claims/${claim.id}`}>
                  <Button size="sm" variant="outline">Full Details</Button>
                </Link>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

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
                target={{ kind: "claim", id: claim.id }}
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

            <div className="space-y-2 rounded-md border border-violet-200 bg-violet-50/40 p-3">
              <div className="flex items-start gap-2">
                <BrainCircuit className="h-4 w-4 mt-0.5 text-violet-600 shrink-0" />
                <div className="flex-1">
                  <Label htmlFor="preflight-context" className="text-sm font-medium text-violet-900">
                    Special circumstances or context for the AI
                    <span className="ml-1 text-xs font-normal text-violet-700">(optional)</span>
                  </Label>
                  <p className="mt-0.5 text-xs text-violet-800/80">
                    Anything the AI wouldn't know from the error type alone — e.g. "MAS pushed an
                    address update mid-trip", "client called for a same-day cancel". Strong context
                    here changes how the dispute is framed.
                  </p>
                </div>
              </div>
              <Textarea
                id="preflight-context"
                value={preflightContext}
                onChange={(e) => setPreflightContext(e.target.value)}
                placeholder="Add any narrative-changing context for the AI…"
                className="min-h-[64px] bg-white"
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={handleCheckUnderstanding}
                  disabled={preflightUnderstanding.isPending}
                  className="border-violet-300 text-violet-800 hover:bg-violet-100"
                >
                  {preflightUnderstanding.isPending ? (
                    <><Loader2 className="h-4 w-4 mr-1 animate-spin" />Checking…</>
                  ) : preflightReadback ? (
                    <><RefreshCw className="h-4 w-4 mr-1" />Re-check understanding</>
                  ) : (
                    <><BrainCircuit className="h-4 w-4 mr-1" />Check understanding</>
                  )}
                </Button>
                {preflightGateBlocked && preflightReadback && (
                  <span className="text-xs text-amber-700">Context changed — re-check before generating.</span>
                )}
                {!preflightReadback && (
                  <span className="text-xs text-violet-700">
                    Required before generating: confirm the AI's restatement.
                  </span>
                )}
              </div>
              {preflightReadback && (
                <div className={`rounded-md border p-3 text-sm ${preflightReadbackIsFresh ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
                  <div className="flex items-center gap-1.5 mb-1 text-xs font-semibold uppercase tracking-wide">
                    <BrainCircuit className="h-3.5 w-3.5" />
                    {preflightReadbackIsFresh ? "AI's understanding (confirmed)" : "AI's understanding (stale)"}
                  </div>
                  <p className="whitespace-pre-wrap leading-snug">{preflightReadback}</p>
                  {preflightReadbackIsFresh && (
                    <p className="mt-2 text-xs opacity-80">
                      If this matches what you mean, hit Generate. If not, sharpen your context above and re-check.
                    </p>
                  )}
                </div>
              )}
            </div>

            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => advanceStep("sop")}>Back</Button>
              <WrapTooltip
                content={
                  !canGenerateNewPreview
                    ? "A portal submission already exists for this claim — open the full details to resume the existing draft instead of creating a duplicate."
                    : preflightGateBlocked
                    ? "Re-check the AI's understanding of your context first."
                    : "Build a fresh draft of the portal submission for this claim."
                }
              >
                <span tabIndex={0} className="inline-block">
                  <Button
                    size="sm"
                    onClick={handleGeneratePreview}
                    disabled={generatePreview.isPending || preflightGateBlocked || !canGenerateNewPreview}
                    data-testid="button-generate-submission-preview"
                  >
                    {generatePreview.isPending ? (
                      <><Loader2 className="h-4 w-4 mr-1 animate-spin" />Generating Preview...</>
                    ) : preflightReadbackIsFresh && canGenerateNewPreview ? (
                      <><CheckCircle className="h-4 w-4 mr-1" />Looks right — Generate Submission Preview</>
                    ) : (
                      <><Eye className="h-4 w-4 mr-1" />Generate Submission Preview</>
                    )}
                  </Button>
                </span>
              </WrapTooltip>
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

            <div className="rounded-md border border-violet-200 bg-violet-50/40 p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-violet-900">
                  <BrainCircuit className="h-3.5 w-3.5" />
                  Special circumstances
                </div>
                {!reviewContextEditing && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs gap-1 text-violet-800 hover:bg-violet-100"
                    onClick={() => {
                      setReviewContextDraft(reviewSavedContext);
                      setReviewContextEditing(true);
                    }}
                  >
                    <Edit3 className="h-3 w-3" />Edit
                  </Button>
                )}
              </div>
              {!reviewContextEditing && (
                <>
                  {reviewSavedContext ? (
                    <p className="text-sm text-violet-900 whitespace-pre-wrap">{reviewSavedContext}</p>
                  ) : (
                    <p className="text-xs italic text-muted-foreground">No special circumstances were attached. Add some if the surface error type is misleading.</p>
                  )}
                  {draftSubmission.understandingReadback && reviewReadbackIsFresh && (
                    <div className="rounded-md border border-emerald-200 bg-emerald-50 p-2.5 text-xs text-emerald-900">
                      <div className="font-semibold uppercase tracking-wide mb-1">AI understanding (confirmed)</div>
                      <p className="whitespace-pre-wrap leading-snug">{draftSubmission.understandingReadback}</p>
                    </div>
                  )}
                  {reviewRegenerateBlocked && (
                    <div className="rounded-md border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900 flex items-start gap-2">
                      <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                      <div>
                        <p className="font-medium">AI understanding not confirmed for this context.</p>
                        <p className="mt-0.5">Click Edit, run "Check understanding", and Save before regenerating.</p>
                      </div>
                    </div>
                  )}
                </>
              )}
              {reviewContextEditing && (
                <>
                  <Textarea
                    value={reviewContextDraft}
                    onChange={(e) => setReviewContextDraft(e.target.value)}
                    placeholder="Add or edit narrative-changing context for the AI…"
                    className="min-h-[64px] bg-white"
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    {reviewContextDraft.trim().length > 0 && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={handleCheckReviewUnderstanding}
                        disabled={preflightUnderstanding.isPending}
                        className="border-violet-300 text-violet-800 hover:bg-violet-100"
                      >
                        {preflightUnderstanding.isPending ? (
                          <><Loader2 className="h-3 w-3 mr-1 animate-spin" />Checking…</>
                        ) : reviewReadback && reviewReadbackForContext === reviewContextDraft.trim() ? (
                          <><RefreshCw className="h-3 w-3 mr-1" />Re-check</>
                        ) : (
                          <><BrainCircuit className="h-3 w-3 mr-1" />Check understanding</>
                        )}
                      </Button>
                    )}
                    <Button
                      type="button"
                      size="sm"
                      onClick={handleSaveReviewContext}
                      disabled={updateDraft.isPending}
                    >
                      {updateDraft.isPending ? (
                        <><Loader2 className="h-3 w-3 mr-1 animate-spin" />Saving…</>
                      ) : (
                        <>Save context</>
                      )}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setReviewContextEditing(false);
                        setReviewContextDraft("");
                      }}
                    >
                      <X className="h-3 w-3 mr-1" />Cancel
                    </Button>
                  </div>
                  {reviewReadback && (
                    <div className={`rounded-md border p-2.5 text-xs ${reviewReadbackForContext === reviewContextDraft.trim() ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
                      <div className="font-semibold uppercase tracking-wide mb-1 flex items-center gap-1">
                        <BrainCircuit className="h-3 w-3" />
                        AI understanding {reviewReadbackForContext === reviewContextDraft.trim() ? "(confirmed for this context)" : "(stale — re-check)"}
                      </div>
                      <p className="whitespace-pre-wrap leading-snug">{reviewReadback}</p>
                    </div>
                  )}
                </>
              )}
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
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs gap-1"
                  onClick={handleRegenerateText}
                  disabled={regenerateText.isPending || revertDescription.isPending || reviewRegenerateBlocked}
                  title={reviewRegenerateBlocked ? "Re-confirm AI understanding for the updated context first." : undefined}
                >
                  {regenerateText.isPending ? (
                    <><Loader2 className="h-3 w-3 animate-spin" />Regenerating...</>
                  ) : (
                    <><Sparkles className="h-3 w-3" />Regenerate Text</>
                  )}
                </Button>
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
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs gap-1"
                            onClick={() => handleRevertToVersion(idx)}
                            disabled={revertDescription.isPending || regenerateText.isPending}
                          >
                            <Undo2 className="h-3 w-3" />Revert to this
                          </Button>
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
