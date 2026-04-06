import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useClaimsListEvents } from "@/hooks/use-claim-events";
import {
  useListClaims,
  useUpdateClaimStatus,
  useUpdateClaimEvidence,
  useUpdateClaimWorkflow,
  usePlaceClaimOnHold,
  useCreatePortalSubmission,
  getListClaimsQueryKey,
  useGetErrorType,
} from "@workspace/api-client-react";
import type { ClaimResponse } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { StatusBadge } from "@/components/status-badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { formatCurrency, formatDate } from "@/lib/format";
import {
  ChevronRight, CheckCircle, AlertTriangle, Send,
  PauseCircle, FileText, ArrowRight, Eye, Clipboard
} from "lucide-react";
import {
  TreePlayer,
  type DecisionTree, type LegacyTreeNode, type OutcomeType,
  legacyToTree,
} from "@/components/decision-tree";

function WorkflowPlayer({
  claim,
  onComplete,
}: {
  claim: ClaimResponse;
  onComplete: () => void;
}) {
  const queryClient = useQueryClient();
  const updateStatus = useUpdateClaimStatus();
  const updateEvidence = useUpdateClaimEvidence();
  const updateWorkflow = useUpdateClaimWorkflow();
  const placeHold = usePlaceClaimOnHold();
  const createSubmission = useCreatePortalSubmission();

  const errorTypeId = claim.errorTypeId ? parseInt(claim.errorTypeId, 10) : 0;
  const { data: errorType } = useGetErrorType(errorTypeId, {
    query: { queryKey: [`/api/error-types/${errorTypeId}`], enabled: !!errorTypeId },
  });

  const workflowProgress = (claim.workflowProgress as Record<string, unknown>) ?? {};
  const currentStep = (workflowProgress.currentStep as string) ?? "review";
  const checklist = (claim.evidenceChecklist as Record<string, boolean>) ?? {};
  const [evidenceNotes, setEvidenceNotes] = useState(claim.evidenceNotes || "");
  const [holdReason, setHoldReason] = useState("");
  const [showHoldDialog, setShowHoldDialog] = useState(false);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListClaimsQueryKey() });

  const steps = [
    { id: "review", label: "Review Claim", icon: Eye },
    { id: "evidence", label: "Gather Evidence", icon: FileText },
    { id: "decide", label: "Decision", icon: Clipboard },
    { id: "submit", label: "Submit to Portal", icon: Send },
  ];

  const currentStepIndex = steps.findIndex(s => s.id === currentStep);

  const advanceStep = async (nextStep: string) => {
    await updateWorkflow.mutateAsync({
      id: claim.id,
      data: { workflowProgress: { ...workflowProgress, currentStep: nextStep } },
    });
    invalidate();
  };

  const handleStatusUpdate = async (status: string) => {
    await updateStatus.mutateAsync({ id: claim.id, data: { status } });
    invalidate();
  };

  const handleSaveEvidence = async () => {
    await updateEvidence.mutateAsync({
      id: claim.id,
      data: { evidenceNotes, evidenceChecklist: checklist },
    });
    invalidate();
  };

  const handlePortalSubmit = async () => {
    await createSubmission.mutateAsync({
      data: { claimId: claim.id },
    });
    await handleStatusUpdate("Portal Queued");
    onComplete();
  };

  const handlePlaceHold = async () => {
    await placeHold.mutateAsync({
      id: claim.id,
      data: { holdReason },
    });
    setShowHoldDialog(false);
    setHoldReason("");
    invalidate();
    onComplete();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-4">
        {steps.map((step, i) => {
          const StepIcon = step.icon;
          const isActive = step.id === currentStep;
          const isComplete = i < currentStepIndex;
          return (
            <div key={step.id} className="flex items-center">
              {i > 0 && <ChevronRight className="h-4 w-4 text-muted-foreground mx-1" />}
              <div
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
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
            </div>
            {claim.errorDetails && (
              <div className="text-sm">
                <span className="text-muted-foreground">Error Details:</span>
                <p className="mt-1 bg-muted/50 p-2 rounded text-xs">{claim.errorDetails}</p>
              </div>
            )}
            <Separator />
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => {
                  handleStatusUpdate("Needs Evidence");
                  advanceStep("evidence");
                }}
              >
                Proceed to Evidence <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowHoldDialog(true)}
              >
                <PauseCircle className="h-4 w-4 mr-1" /> Place on Hold
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {currentStep === "evidence" && (
        <Card>
          <CardHeader><CardTitle className="text-base">Gather Evidence</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <Label className="text-sm font-medium">Evidence Checklist</Label>
              <div className="space-y-1.5">
                {(errorType?.evidenceRequirements && typeof errorType.evidenceRequirements === "object"
                  ? Object.values(errorType.evidenceRequirements as Record<string, Record<string, unknown>>)
                      .map((r) => (r.label as string) || "")
                      .filter(Boolean)
                  : ["GPS breadcrumbs reviewed", "Trip logs verified", "Driver statement obtained", "Photos/documentation attached"]
                ).map(
                  (item) => (
                    <label key={item} className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={!!checklist[item]}
                        onChange={(e) => {
                          const updated = { ...checklist, [item]: e.target.checked };
                          updateEvidence.mutateAsync({
                            id: claim.id,
                            data: { evidenceChecklist: updated },
                          }).then(invalidate);
                        }}
                        className="rounded border-gray-300"
                      />
                      {item}
                    </label>
                  ),
                )}
              </div>
            </div>
            <div>
              <Label className="text-sm font-medium">Evidence Notes</Label>
              <Textarea
                value={evidenceNotes}
                onChange={(e) => setEvidenceNotes(e.target.value)}
                rows={3}
                placeholder="Describe the evidence gathered..."
                className="mt-1"
              />
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={handleSaveEvidence}>
                Save Progress
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  handleSaveEvidence();
                  advanceStep("decide");
                }}
              >
                Proceed to Decision <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {currentStep === "decide" && (
        <Card>
          <CardHeader><CardTitle className="text-base">Decision</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {errorType?.guidance && (
              <div className="bg-blue-50 text-blue-800 p-3 rounded-md text-sm mb-3">
                <p className="font-medium text-xs mb-1">SOP Guidance</p>
                <p className="text-xs whitespace-pre-line">{errorType.guidance}</p>
              </div>
            )}

            {errorType?.decisionTree ? (() => {
              const rawTree = errorType.decisionTree as Record<string, unknown>;
              let tree: DecisionTree | null = null;
              if ("nodes" in rawTree && "rootId" in rawTree) {
                tree = rawTree as unknown as DecisionTree;
              } else if ("question" in rawTree) {
                tree = legacyToTree(rawTree as unknown as LegacyTreeNode);
              }
              if (!tree) return null;
              return (
                <div>
                  <p className="text-sm text-muted-foreground mb-2">
                    Follow the decision tree for <span className="font-medium">{errorType.name}</span>:
                  </p>
                  <TreePlayer
                    tree={tree}
                    onOutcome={(outcomeType: OutcomeType, outcomeLabel: string) => {
                      if (outcomeType === "portal_dispute") {
                        advanceStep("submit");
                      } else if (outcomeType === "hold") {
                        setShowHoldDialog(true);
                      } else if (outcomeType === "dispute") {
                        advanceStep("submit");
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
              );
            })() : (
              <>
                <p className="text-sm text-muted-foreground">
                  Choose how to resolve this claim based on the evidence gathered.
                </p>
                <div className="grid grid-cols-1 gap-2">
                  <Button
                    className="justify-start"
                    onClick={() => advanceStep("submit")}
                  >
                    <Send className="h-4 w-4 mr-2" />
                    Submit Dispute to MAS Portal
                    <span className="ml-auto text-xs opacity-70">Automated submission</span>
                  </Button>
                  <Button
                    variant="outline"
                    className="justify-start"
                    onClick={() => setShowHoldDialog(true)}
                  >
                    <PauseCircle className="h-4 w-4 mr-2" />
                    Place on Hold
                    <span className="ml-auto text-xs opacity-70">Pending additional info</span>
                  </Button>
                  <Button
                    variant="outline"
                    className="justify-start text-green-700"
                    onClick={async () => {
                      await updateStatus.mutateAsync({
                        id: claim.id,
                        data: { status: "Resolved" },
                      });
                      invalidate();
                      onComplete();
                    }}
                  >
                    <CheckCircle className="h-4 w-4 mr-2" />
                    Mark as Resolved
                    <span className="ml-auto text-xs opacity-70">No dispute needed</span>
                  </Button>
                  <Button
                    variant="outline"
                    className="justify-start text-red-700"
                    onClick={async () => {
                      await updateStatus.mutateAsync({
                        id: claim.id,
                        data: { status: "Denied" },
                      });
                      invalidate();
                      onComplete();
                    }}
                  >
                    <AlertTriangle className="h-4 w-4 mr-2" />
                    Mark as Denied
                    <span className="ml-auto text-xs opacity-70">Cannot dispute</span>
                  </Button>
                </div>
              </>
            )}
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
                The bot will fill out the dispute form with claim details and evidence.
              </p>
            </div>
            <div className="text-sm space-y-1">
              <p><span className="text-muted-foreground">Conf #:</span> {claim.confNumber}</p>
              <p><span className="text-muted-foreground">Amount:</span> {formatCurrency(claim.claimAmount)}</p>
              {claim.evidenceNotes && (
                <p><span className="text-muted-foreground">Evidence:</span> {claim.evidenceNotes}</p>
              )}
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => advanceStep("decide")}
              >
                Back to Decision
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

      <Dialog open={showHoldDialog} onOpenChange={setShowHoldDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Place Claim on Hold</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Reason for Hold</Label>
              <Input
                value={holdReason}
                onChange={(e) => setHoldReason(e.target.value)}
                placeholder="e.g., Waiting for driver statement"
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

export default function Queue() {
  useClaimsListEvents();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const [selectedClaim, setSelectedClaim] = useState<ClaimResponse | null>(null);

  const newQuery = useListClaims({ status: "New" });
  const needsEvidenceQuery = useListClaims({ status: "Needs Evidence" });
  const portalQueuedQuery = useListClaims({ status: "Portal Queued" });
  const awaitingQuery = useListClaims({ status: "Awaiting Response" });
  const onHoldQuery = useListClaims({ status: "On Hold" });

  const newClaims = newQuery.data?.claims || [];
  const needsClaims = needsEvidenceQuery.data?.claims || [];
  const portalQueuedClaims = portalQueuedQuery.data?.claims || [];
  const awaitingClaims = awaitingQuery.data?.claims || [];
  const onHoldClaims = onHoldQuery.data?.claims || [];

  const actionableClaims = [...newClaims, ...needsClaims];

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListClaimsQueryKey() });

  const renderClaimRow = (claim: ClaimResponse, showWorkflow = false) => (
    <Card
      key={claim.id}
      className={`cursor-pointer transition-colors ${
        selectedClaim?.id === claim.id ? "ring-2 ring-primary" : "hover:bg-accent/50"
      }`}
      onClick={() => showWorkflow ? setSelectedClaim(claim) : navigate(`/claims/${claim.id}`)}
    >
      <CardContent className="py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div>
            <span className="font-mono font-semibold">{claim.confNumber}</span>
            <span className="text-muted-foreground ml-3 text-sm">{formatDate(claim.date)}</span>
          </div>
          <StatusBadge status={claim.status} />
        </div>
        <div className="flex items-center gap-4 text-sm">
          {claim.errorTypeName && <span className="text-muted-foreground">{claim.errorTypeName}</span>}
          <span className="font-medium">{formatCurrency(claim.claimAmount)}</span>
          {showWorkflow && <ChevronRight className="h-4 w-4 text-muted-foreground" />}
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Work Queue</h2>
        <p className="text-muted-foreground">Claims requiring attention — select a claim to process</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-4">
          <Tabs defaultValue="actionable">
            <TabsList>
              <TabsTrigger value="actionable">
                Action Required
                {actionableClaims.length > 0 && (
                  <Badge variant="secondary" className="ml-2">{actionableClaims.length}</Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="portal-queued">
                Portal Queued
                {portalQueuedClaims.length > 0 && (
                  <Badge variant="secondary" className="ml-2">{portalQueuedClaims.length}</Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="awaiting">
                Awaiting
                {awaitingClaims.length > 0 && (
                  <Badge variant="secondary" className="ml-2">{awaitingClaims.length}</Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="on-hold">
                On Hold
                {onHoldClaims.length > 0 && (
                  <Badge variant="secondary" className="ml-2">{onHoldClaims.length}</Badge>
                )}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="actionable" className="mt-4">
              {actionableClaims.length === 0 ? (
                <Card><CardContent className="py-12 text-center text-muted-foreground">No claims need action right now.</CardContent></Card>
              ) : (
                <div className="space-y-2">
                  {actionableClaims.map((c) => renderClaimRow(c, true))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="portal-queued" className="mt-4">
              {portalQueuedClaims.length === 0 ? (
                <Card><CardContent className="py-12 text-center text-muted-foreground">No claims queued for portal submission.</CardContent></Card>
              ) : (
                <div className="space-y-2">
                  {portalQueuedClaims.map((c) => renderClaimRow(c))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="awaiting" className="mt-4">
              {awaitingClaims.length === 0 ? (
                <Card><CardContent className="py-12 text-center text-muted-foreground">No claims awaiting response.</CardContent></Card>
              ) : (
                <div className="space-y-2">
                  {awaitingClaims.map((c) => renderClaimRow(c))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="on-hold" className="mt-4">
              {onHoldClaims.length === 0 ? (
                <Card><CardContent className="py-12 text-center text-muted-foreground">No claims on hold.</CardContent></Card>
              ) : (
                <div className="space-y-2">
                  {onHoldClaims.map((c) => renderClaimRow(c))}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>

        <div>
          {selectedClaim ? (
            <div className="sticky top-4">
              <Card>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg">
                      Process Claim {selectedClaim.confNumber}
                    </CardTitle>
                    <Link href={`/claims/${selectedClaim.id}`}>
                      <Button variant="ghost" size="sm">
                        Full Details <ChevronRight className="h-4 w-4 ml-1" />
                      </Button>
                    </Link>
                  </div>
                </CardHeader>
                <CardContent>
                  <WorkflowPlayer
                    claim={selectedClaim}
                    onComplete={() => {
                      setSelectedClaim(null);
                      invalidate();
                    }}
                  />
                </CardContent>
              </Card>
            </div>
          ) : (
            <Card>
              <CardContent className="py-16 text-center text-muted-foreground">
                <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p className="font-medium">Select a claim to process</p>
                <p className="text-sm mt-1">
                  Click on a claim from the Action Required tab to start the dispute workflow
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
