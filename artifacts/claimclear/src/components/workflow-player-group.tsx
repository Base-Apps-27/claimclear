import { useState, useRef } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useUpdateInvoiceGroupStatus,
  useUpdateInvoiceGroupWorkflow,
  useHoldInvoiceGroup,
  useRemoveInvoiceGroupHold,
  useAddInvoiceGroupEvidence,
  getListInvoiceGroupsQueryKey,
  getGetInvoiceGroupQueryKey,
  useGetErrorType,
} from "@workspace/api-client-react";
import type { InvoiceGroupResponse } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatCurrency } from "@/lib/format";
import {
  ChevronRight, CheckCircle, AlertTriangle, Send, Loader2,
  PauseCircle, ArrowRight, Eye, TreeDeciduous, Hash, FileText,
} from "lucide-react";
import { WrapTooltip } from "@/components/info-tooltip";
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
}

export function WorkflowPlayerGroup({
  group,
  onComplete,
  showGroupContext = false,
  showDetailsLink = true,
}: WorkflowPlayerGroupProps) {
  const queryClient = useQueryClient();
  const updateStatus = useUpdateInvoiceGroupStatus();
  const updateWorkflow = useUpdateInvoiceGroupWorkflow();
  const placeHold = useHoldInvoiceGroup();
  const removeHold = useRemoveInvoiceGroupHold();
  const addEvidence = useAddInvoiceGroupEvidence();

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
  const [queueing, setQueueing] = useState(false);

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

  const handleQueueForPortal = async () => {
    setQueueing(true);
    try {
      await updateStatus.mutateAsync({
        id: group.id,
        data: { status: "Portal Queued", reason: treeOutcomeLabel || undefined },
      });
      invalidate();
      onComplete();
    } finally {
      setQueueing(false);
    }
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
  }) => {
    try {
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
    } catch {}
  };

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
              <Button size="sm" onClick={handleResumeFromHold}>
                <ArrowRight className="h-4 w-4 mr-1" />Resume Workflow
              </Button>
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
                    <Button size="sm" variant="outline" onClick={() => setShowHoldDialog(true)}>
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
                      <Button size="sm" variant="outline" onClick={() => setShowHoldDialog(true)}>
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
                    claimId={group.id}
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
                      This invoice group is in "{group.status}" status and has been queued for portal submission.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {currentStep === "submit" && !isAlreadyQueued && (
            <Card>
              <CardHeader><CardTitle className="text-base">Queue for Portal Submission</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="bg-blue-50 text-blue-800 p-3 rounded-md text-sm">
                  <p className="font-medium">Ready to Queue</p>
                  <p className="mt-1 text-xs">
                    Queueing this invoice group will transition it to "Portal Queued" status for the bot to pick up.
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
                  <Button size="sm" onClick={handleQueueForPortal} disabled={queueing}>
                    {queueing ? (
                      <><Loader2 className="h-4 w-4 mr-1 animate-spin" />Queueing...</>
                    ) : (
                      <><Send className="h-4 w-4 mr-1" />Queue for Portal</>
                    )}
                  </Button>
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
              <Button onClick={handlePlaceHold} disabled={!holdReason.trim()}>Place on Hold</Button>
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
              <Button onClick={handleConclude} disabled={!concludeNotes.trim()}>Save & Conclude</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
