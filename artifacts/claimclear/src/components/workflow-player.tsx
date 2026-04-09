import { useState, useRef } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useUpdateClaimStatus,
  useUpdateClaimWorkflow,
  usePlaceClaimOnHold,
  useRemoveClaimHold,
  useCreatePortalSubmission,
  useAddClaimEvidence,
  getListClaimsQueryKey,
  getGetClaimQueryKey,
  useGetErrorType,
} from "@workspace/api-client-react";
import type { ClaimResponse } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatCurrency, formatDate } from "@/lib/format";
import { RefNumber } from "@/components/ref-number";
import {
  ChevronRight, CheckCircle, AlertTriangle, Send,
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
  const createSubmission = useCreatePortalSubmission();
  const addEvidence = useAddClaimEvidence();
  const isOnHold = claim.status === "On Hold";

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

  const handlePortalSubmit = async () => {
    await createSubmission.mutateAsync({
      data: { claimId: claim.id, disputeReason: treeOutcomeLabel || undefined },
    });
    await handleStatusUpdate("Portal Queued");
    onComplete();
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
                  if (outcomeType === "portal_dispute" || outcomeType === "dispute") {
                    advanceStep("submit");
                  } else if (outcomeType === "hold") {
                    setShowHoldDialog(true);
                  } else if (outcomeType === "internal") {
                    const lower = outcomeLabel.toLowerCase();
                    const isDeny = lower.includes("deny") || lower.includes("denied");
                    const finalStatus = isDeny ? "Denied" : "Resolved";
                    updateStatus.mutateAsync({ id: claim.id, data: { status: finalStatus } }).then(() => {
                      invalidate();
                      onComplete();
                    });
                  } else {
                    advanceStep("submit");
                  }
                }}
              />
            </div>
          </CardContent>
        </Card>
      )}

      {currentStep === "submit" && (
        <Card>
          <CardHeader><CardTitle className="text-base">Submit to MAS Portal</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="bg-blue-50 text-blue-800 p-3 rounded-md text-sm">
              <p className="font-medium">Ready for Portal Submission</p>
              <p className="mt-1 text-xs">
                This will queue the claim for automated submission to the MAS Transportation Provider Support Portal.
                The AI will generate a unique dispute note based on the claim details, evidence, and error type guidelines.
              </p>
            </div>
            <div className="text-sm space-y-1">
              <p><span className="text-muted-foreground">Conf #:</span> {claim.confNumber}</p>
              <p><span className="text-muted-foreground">Amount:</span> {formatCurrency(claim.claimAmount)}</p>
              {treeOutcomeLabel && (
                <p><span className="text-muted-foreground">Dispute Reason:</span> <span className="font-medium">{treeOutcomeLabel}</span></p>
              )}
              {claim.evidenceNotes && (
                <p><span className="text-muted-foreground">Evidence:</span> {claim.evidenceNotes}</p>
              )}
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => advanceStep("sop")}
              >
                Back
              </Button>
              <Button
                size="sm"
                onClick={handlePortalSubmit}
                disabled={createSubmission.isPending}
              >
                <Send className="h-4 w-4 mr-1" />
                {createSubmission.isPending ? "Queuing..." : "Queue for Portal Submission"}
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
    </div>
  );
}
