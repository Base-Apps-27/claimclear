import { useState, useCallback, useRef, useEffect, useImperativeHandle, forwardRef } from "react";
import {
  type DecisionTree,
  type TreeNode,
  type OutcomeType,
  type EvidenceReq,
  OUTCOME_LABELS,
  OUTCOME_COLORS,
  getMaxDepth,
} from "./types";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PresenceLockWrapper } from "@/components/presence-lock";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import {
  ChevronRight, Undo2, HelpCircle, CheckCircle2,
  Send, Ban, PauseCircle, Mail, FileText, ClipboardPaste,
  Upload, X, Info, Loader2, ExternalLink, AlertTriangle, Plus,
  XCircle, FileX,
} from "lucide-react";
import { useClosureLauncher } from "@/components/closure/closure-launcher";
import type { ClosureReasonKey } from "@/components/closure/closure-options";

const OUTCOME_ICONS: Record<OutcomeType, typeof Send> = {
  portal_dispute: Send,
  internal: Ban,
  hold: PauseCircle,
  dispute: Mail,
  cannot_dispute: XCircle,
  non_issue: FileX,
};

interface Step {
  nodeId: string;
  question: string;
  answer: string;
  optionIndex: number;
}

export interface EvidenceItem {
  id: string;
  imageUrl?: string;
  imagePreview?: string;
  uploading?: boolean;
  scope?: string; // "group" or claim id as string
}

export interface NodeEvidenceEntry {
  acknowledged?: boolean;
  notes?: string;
  notesScope?: string;
  items: EvidenceItem[];
}

export interface TreePlayerState {
  steps: Step[];
  currentNodeId: string;
  nodeEvidence: Record<string, Record<string, NodeEvidenceEntry>>;
  outcome?: { type: OutcomeType; label: string } | null;
}

export interface TreePlayerHandle {
  getState: () => TreePlayerState;
}

export interface EvidenceLeg {
  id: number;
  label: string;
}

interface PlayerProps {
  tree: DecisionTree;
  onOutcome: (outcomeType: OutcomeType, outcomeLabel: string) => void;
  isTestMode?: boolean;
  claimId?: number;
  /** Target for closure-style outcomes (cannot_dispute / non_issue). When omitted,
   * falls back to `{ kind: "claim", id: claimId }` if claimId is provided. */
  target?: { kind: "claim" | "group"; id: number };
  initialState?: TreePlayerState;
  legs?: EvidenceLeg[]; // when present, shows per-thumbnail "Applies to" chip selector
  onEvidenceCollected?: (evidence: {
    evidenceTypeId?: number;
    evidenceTypeName: string;
    treeNodeId: string;
    imageUrl?: string;
    notes?: string;
    scope?: string; // "group" or claim id string; undefined => default behavior
  }) => void;
  onConclude?: () => void;
  onQueueForPortal?: () => void;
  onPlaceHold?: () => void;
  /** When set, action triggers (Continue to Portal, Conclude, Place on Hold) are
   * disabled and the supplied reason is shown as a tooltip. Tree navigation is
   * NOT disabled — only state-changing handoffs to the parent. */
  actionsDisabledReason?: string | null;
}

let __evIdCounter = 0;
const newId = () => `ev_${Date.now().toString(36)}_${(++__evIdCounter).toString(36)}`;

function normalizeNodeEvidence(saved: unknown): Record<string, Record<string, NodeEvidenceEntry>> {
  if (!saved || typeof saved !== "object") return {};
  const out: Record<string, Record<string, NodeEvidenceEntry>> = {};
  for (const [nid, recs] of Object.entries(saved as Record<string, unknown>)) {
    if (!recs || typeof recs !== "object") continue;
    out[nid] = {};
    for (const [k, v] of Object.entries(recs as Record<string, unknown>)) {
      if (!v) continue;
      // New shape: { acknowledged?, notes?, notesScope?, items: [...] }
      if (typeof v === "object" && "items" in (v as object) && Array.isArray((v as NodeEvidenceEntry).items)) {
        const entry = v as NodeEvidenceEntry;
        out[nid][k] = {
          acknowledged: !!entry.acknowledged,
          notes: entry.notes,
          notesScope: entry.notesScope,
          items: entry.items.map((it, i) => ({ ...it, id: it.id || `${k}-${i}-${newId()}` })),
        };
        continue;
      }
      // Legacy shape: { key, checked, imageUrl?, imagePreview?, notes? }
      const single = v as { checked?: boolean; imageUrl?: string; imagePreview?: string; notes?: string };
      const items: EvidenceItem[] = [];
      if (single.imageUrl || single.imagePreview) {
        items.push({
          id: newId(),
          imageUrl: single.imageUrl,
          imagePreview: single.imagePreview,
          scope: "group",
        });
      }
      out[nid][k] = {
        acknowledged: !!single.checked,
        notes: single.notes,
        notesScope: "group",
        items,
      };
    }
  }
  return out;
}

export const TreePlayer = forwardRef<TreePlayerHandle, PlayerProps>(function TreePlayer(
  { tree, onOutcome, isTestMode, claimId, target, initialState, legs, onEvidenceCollected, onConclude, onQueueForPortal, onPlaceHold, actionsDisabledReason },
  ref
) {
  const closureTarget = target ?? (claimId ? { kind: "claim" as const, id: claimId } : null);
  const actionsDisabled = !!actionsDisabledReason;
  const restoredNodeExists = initialState?.currentNodeId
    ? tree.nodes.some(n => n.id === initialState.currentNodeId)
    : false;
  const canRestore = restoredNodeExists && !!initialState;
  const [steps, setSteps] = useState<Step[]>(canRestore ? initialState.steps : []);
  const [currentNodeId, setCurrentNodeId] = useState(canRestore ? initialState.currentNodeId : tree.rootId);
  const [outcome, setOutcome] = useState<{ type: OutcomeType; label: string } | null>(canRestore && initialState.outcome ? initialState.outcome : null);
  const [nodeEvidence, setNodeEvidence] = useState<Record<string, Record<string, NodeEvidenceEntry>>>(
    canRestore ? normalizeNodeEvidence(initialState.nodeEvidence) : {}
  );
  const [showRestoreNotice, setShowRestoreNotice] = useState(!!initialState && !canRestore);

  // Shared, headless dialog wiring. The player's "trigger" is the act of
  // choosing a closure-leaf option in the guided flow rather than a button
  // press, but every other behaviour (entity / valid-transitions /
  // Withdrawals invalidation, prefill, banner) is identical to the inline
  // <ClosureActions> path — so both go through the same launcher.
  const { open: openClosure, dialog: closureDialogEl } = useClosureLauncher();

  useImperativeHandle(ref, () => ({
    getState: () => ({ steps, currentNodeId, nodeEvidence, outcome }),
  }), [steps, currentNodeId, nodeEvidence, outcome]);

  useEffect(() => {
    if (canRestore && initialState?.outcome && !isTestMode && initialState.outcome.type !== "hold") {
      onOutcome(initialState.outcome.type, initialState.outcome.label);
    }
  }, []);

  const currentNode = tree.nodes.find(n => n.id === currentNodeId);
  const maxDepth = getMaxDepth(tree);
  const progress = maxDepth > 0 ? Math.round((steps.length / maxDepth) * 100) : 0;

  const getEntry = (nodeId: string, key: string): NodeEvidenceEntry =>
    nodeEvidence[nodeId]?.[key] ?? { acknowledged: false, items: [] };

  const updateEntry = (nodeId: string, key: string, updater: (e: NodeEvidenceEntry) => NodeEvidenceEntry) => {
    setNodeEvidence(prev => {
      const cur = prev[nodeId]?.[key] ?? { acknowledged: false, items: [] };
      return {
        ...prev,
        [nodeId]: { ...prev[nodeId], [key]: updater(cur) },
      };
    });
  };

  const handleChoice = useCallback((optionIndex: number) => {
    if (!currentNode) return;
    const opt = currentNode.options[optionIndex];
    if (!opt) return;

    if (currentNode.evidenceRequirements?.length && onEvidenceCollected && claimId) {
      const recs = nodeEvidence[currentNode.id] || {};
      for (const req of currentNode.evidenceRequirements) {
        const entry = recs[req.key];
        if (!entry) continue;
        for (const item of entry.items) {
          if (!item.imageUrl) continue;
          onEvidenceCollected({
            evidenceTypeId: req.evidenceTypeId,
            evidenceTypeName: req.label,
            treeNodeId: currentNode.id,
            imageUrl: item.imageUrl,
            scope: item.scope,
          });
        }
        const trimmedNotes = entry.notes?.trim();
        if (trimmedNotes) {
          onEvidenceCollected({
            evidenceTypeId: req.evidenceTypeId,
            evidenceTypeName: req.label,
            treeNodeId: currentNode.id,
            notes: trimmedNotes,
            scope: entry.notesScope,
          });
        }
      }
    }

    const step: Step = {
      nodeId: currentNode.id,
      question: currentNode.question,
      answer: opt.label,
      optionIndex,
    };

    // Closure-style outcomes: open the closure intake dialog before recording
    // the outcome so the user must confirm a category + root cause for the
    // claim/group. Skip the dialog in test mode (no real target to close).
    // Also respect the presence/lock guard — closure mutates the claim/group
    // exactly like the queue/conclude/hold actions do, so it must be blocked
    // when actionsDisabledReason is set (e.g. another user holds the lock).
    const isClosureLeaf =
      opt.outcomeType === "cannot_dispute" || opt.outcomeType === "non_issue";
    if (isClosureLeaf && actionsDisabled) {
      return;
    }
    if (isClosureLeaf && !isTestMode && closureTarget) {
      const reason: ClosureReasonKey =
        opt.outcomeType === "cannot_dispute" ? "cannot_dispute" : "non_issue";
      const result = {
        type: opt.outcomeType!,
        label: opt.outcomeLabel || OUTCOME_LABELS[opt.outcomeType!],
      };
      // Defer recording the step / outcome until the structured intake is
      // confirmed. The launcher's onSuccess only fires on a successful
      // submit (not on cancel), so a cancelled dialog leaves the player
      // exactly where it was.
      openClosure({
        target: closureTarget,
        reason,
        prefill:
          opt.closureCategory || opt.closureRootCause
            ? { category: opt.closureCategory, rootCause: opt.closureRootCause }
            : undefined,
        onSuccess: () => {
          setSteps((prev) => [...prev, step]);
          setOutcome(result);
          if (!isTestMode) {
            onOutcome(result.type, result.label);
          }
        },
      });
      return;
    }

    const newSteps = [...steps, step];
    setSteps(newSteps);

    if (opt.childId) {
      setCurrentNodeId(opt.childId);
    } else if (opt.outcomeType) {
      const result = { type: opt.outcomeType, label: opt.outcomeLabel || OUTCOME_LABELS[opt.outcomeType] };
      setOutcome(result);
      if (!isTestMode) {
        onOutcome(result.type, result.label);
      }
    }
  }, [currentNode, steps, isTestMode, onOutcome, nodeEvidence, claimId, onEvidenceCollected, closureTarget, actionsDisabled, openClosure]);

  const handleUndo = useCallback(() => {
    if (steps.length === 0) return;
    if (outcome) {
      setOutcome(null);
    }
    const newSteps = steps.slice(0, -1);
    setSteps(newSteps);
    if (newSteps.length > 0) {
      const lastStep = newSteps[newSteps.length - 1];
      const prevNode = tree.nodes.find(n => n.id === lastStep.nodeId);
      const chosenOpt = prevNode?.options[lastStep.optionIndex];
      if (chosenOpt?.childId) {
        setCurrentNodeId(chosenOpt.childId);
      } else {
        setCurrentNodeId(lastStep.nodeId);
      }
    } else {
      setCurrentNodeId(tree.rootId);
    }
  }, [steps, outcome, tree]);

  const handleRestart = () => {
    setSteps([]);
    setCurrentNodeId(tree.rootId);
    setOutcome(null);
    setNodeEvidence({});
  };

  const isReqSatisfied = (req: EvidenceReq, entry: NodeEvidenceEntry): boolean => {
    if (!req.required) return true;
    if (entry.acknowledged) return true;
    const acceptsImage = req.acceptsImage !== false;
    const acceptsText = req.acceptsText === true;
    if (acceptsImage && entry.items.some(i => i.imageUrl)) return true;
    if (acceptsText && entry.notes?.trim().length) return true;
    return false;
  };

  const nodeEvidenceComplete = (node: TreeNode): boolean => {
    if (!node.evidenceRequirements?.length) return true;
    const recs = nodeEvidence[node.id] || {};
    return node.evidenceRequirements.every(r => isReqSatisfied(r, recs[r.key] ?? { acknowledged: false, items: [] }));
  };

  if (outcome) {
    const colors = OUTCOME_COLORS[outcome.type];
    const Icon = OUTCOME_ICONS[outcome.type];
    return (
      <>
      {closureDialogEl}
      <div className="space-y-3 min-w-0 overflow-hidden">
        {isTestMode && (
          <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-300">Test Mode</Badge>
        )}
        <StepsBreadcrumb steps={steps} />
        <Card className={`${colors.bg} border ${colors.border} min-w-0`}>
          <CardContent className="p-4 text-center space-y-3">
            <Icon className={`h-10 w-10 mx-auto ${colors.text}`} />
            <div>
              <p className={`text-lg font-semibold ${colors.text}`}>{outcome.label}</p>
              <p className="text-xs text-muted-foreground mt-1">
                Completed in {steps.length} step{steps.length !== 1 ? "s" : ""}
              </p>
            </div>
            <div className="flex gap-2 justify-center flex-wrap">
              <Button variant="outline" size="sm" onClick={handleUndo} className="gap-1">
                <Undo2 className="h-3 w-3" />Go Back
              </Button>
              {isTestMode ? (
                <Button variant="outline" size="sm" onClick={handleRestart} className="gap-1">
                  Restart
                </Button>
              ) : (
                <>
                  {(outcome.type === "portal_dispute" || outcome.type === "dispute") && onQueueForPortal && (
                    <PresenceLockWrapper reason={actionsDisabledReason ?? null}>
                      <Button size="sm" onClick={onQueueForPortal} disabled={actionsDisabled} className="gap-1">
                        <Send className="h-3 w-3" />Continue to Portal Submission
                      </Button>
                    </PresenceLockWrapper>
                  )}
                  {outcome.type === "internal" && onConclude && (
                    <PresenceLockWrapper reason={actionsDisabledReason ?? null}>
                      <Button size="sm" onClick={onConclude} disabled={actionsDisabled} className="gap-1">
                        <CheckCircle2 className="h-3 w-3" />Conclude
                      </Button>
                    </PresenceLockWrapper>
                  )}
                  {onPlaceHold && (
                    <PresenceLockWrapper reason={actionsDisabledReason ?? null}>
                      <Button variant="outline" size="sm" onClick={onPlaceHold} disabled={actionsDisabled} className="gap-1">
                        <PauseCircle className="h-3 w-3" />Place on Hold
                      </Button>
                    </PresenceLockWrapper>
                  )}
                </>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
      </>
    );
  }

  if (!currentNode) return <p className="text-sm text-muted-foreground">Tree configuration error.</p>;

  const hasEvidence = !!currentNode.evidenceRequirements?.length;
  const evidenceReady = nodeEvidenceComplete(currentNode);

  const uploadFile = async (nodeId: string, key: string, file: File) => {
    const tempId = newId();
    const previewUrl = URL.createObjectURL(file);
    updateEntry(nodeId, key, (e) => ({
      ...e,
      items: [...e.items, { id: tempId, uploading: true, imagePreview: previewUrl, scope: "group" }],
    }));
    try {
      const res = await fetch("/api/storage/uploads/request-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type }),
      });
      const { uploadURL, objectPath } = await res.json();
      await fetch(uploadURL, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
      updateEntry(nodeId, key, (e) => ({
        ...e,
        items: e.items.map(it => it.id === tempId ? { ...it, imageUrl: objectPath, uploading: false } : it),
      }));
    } catch {
      updateEntry(nodeId, key, (e) => ({
        ...e,
        items: e.items.filter(it => it.id !== tempId),
      }));
      toast({ title: "Upload failed", description: "Please try again.", variant: "destructive" });
    }
  };

  const removeItem = (nodeId: string, key: string, itemId: string) => {
    updateEntry(nodeId, key, (e) => ({ ...e, items: e.items.filter(it => it.id !== itemId) }));
  };

  const setItemScope = (nodeId: string, key: string, itemId: string, scope: string) => {
    updateEntry(nodeId, key, (e) => ({
      ...e,
      items: e.items.map(it => it.id === itemId ? { ...it, scope } : it),
    }));
  };

  return (
    <>
    {closureDialogEl}
    <div className="space-y-3 min-w-0 overflow-hidden">
      {isTestMode && (
        <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-300">Test Mode - no changes will be saved</Badge>
      )}

      {showRestoreNotice && (
        <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-md p-2.5 text-amber-800">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <div className="text-xs">
            <p className="font-medium">Workflow was updated since this claim was paused</p>
            <p className="mt-0.5">Starting from the beginning with the latest workflow version.</p>
            <Button variant="ghost" size="sm" className="h-5 px-1 text-[10px] mt-1" onClick={() => setShowRestoreNotice(false)}>Dismiss</Button>
          </div>
        </div>
      )}

      {canRestore && steps.length > 0 && (
        <div className="flex items-start gap-2 bg-purple-50 border border-purple-200 rounded-md p-2.5 text-purple-800">
          <PauseCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <div className="text-xs">
            <p className="font-medium">Resumed from hold — pick up where you left off</p>
            <p className="mt-0.5">{steps.length} step{steps.length !== 1 ? "s" : ""} completed previously. Choose your next answer below.</p>
          </div>
        </div>
      )}

      <div className="flex items-center gap-3">
        <Progress value={progress} className="flex-1 h-2" />
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          Step {steps.length + 1}{maxDepth > 0 ? ` of ~${maxDepth}` : ""}
        </span>
      </div>

      {steps.length > 0 && <StepsBreadcrumb steps={steps} />}

      <Card className="border-blue-200 bg-blue-50/50 dark:bg-blue-950/20 min-w-0">
        <CardContent className="p-4 space-y-3">
          <p className="text-sm font-semibold">{currentNode.question}</p>

          {currentNode.helpText && (
            <div className="flex items-start gap-2 bg-white dark:bg-background rounded-md p-2 border">
              <HelpCircle className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />
              <p className="text-xs text-muted-foreground">{currentNode.helpText}</p>
            </div>
          )}

          {(currentNode.instructionText || currentNode.instructionImagePath || currentNode.instructionImageUrl || currentNode.instructionLinkUrl) && (
            <div className="bg-indigo-50 dark:bg-indigo-950/20 rounded-md p-3 space-y-2">
              {currentNode.instructionText && (
                <>
                  <div className="flex items-center gap-1.5">
                    <Info className="h-3.5 w-3.5 text-indigo-600" />
                    <span className="text-xs font-medium text-indigo-700">Instructions</span>
                  </div>
                  <p className="text-xs text-indigo-800 whitespace-pre-line">{currentNode.instructionText}</p>
                </>
              )}
              {(() => {
                const imgSrc = currentNode.instructionImagePath || currentNode.instructionImageUrl;
                if (!imgSrc) return null;
                const src = imgSrc.startsWith("/objects/") ? `/api/storage${imgSrc}` : imgSrc;
                return <img src={src} alt="Instruction reference" className="rounded-md border max-h-48 w-auto mt-1" />;
              })()}
              {currentNode.instructionLinkUrl && (
                <a
                  href={currentNode.instructionLinkUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-indigo-700 hover:text-indigo-900 underline underline-offset-2 mt-1"
                >
                  <ExternalLink className="h-3 w-3" />
                  {currentNode.instructionLinkLabel || "Open Reference"}
                </a>
              )}
            </div>
          )}

          {hasEvidence && (
            <div className="bg-violet-50 dark:bg-violet-950/20 rounded-md p-3 space-y-3">
              <div className="flex items-center gap-1">
                <FileText className="h-3.5 w-3.5 text-violet-600" />
                <span className="text-xs font-medium text-violet-700">Evidence needed at this step</span>
              </div>
              {currentNode.evidenceRequirements!.map(req => {
                const entry = getEntry(currentNode.id, req.key);
                const showImage = req.acceptsImage !== false;
                const showText = req.acceptsText === true;
                const satisfied = isReqSatisfied(req, entry);

                return (
                  <div key={req.key} className="space-y-2 bg-white dark:bg-background rounded-md p-2 border">
                    <div className="flex items-center gap-2 text-xs">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={!!entry.acknowledged}
                          onChange={(e) => updateEntry(currentNode.id, req.key, (cur) => ({ ...cur, acknowledged: e.target.checked }))}
                          className="rounded"
                        />
                        <span className="font-medium">{req.label}</span>
                      </label>
                      {req.required && <Badge variant="secondary" className="text-[9px] h-4">Required</Badge>}
                      {satisfied && <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />}
                      {showImage && entry.items.length > 0 && (
                        <span className="text-[10px] text-muted-foreground ml-auto">
                          {entry.items.length} image{entry.items.length !== 1 ? "s" : ""}
                        </span>
                      )}
                    </div>

                    {showImage && (
                      <div className="space-y-2">
                        {entry.items.length > 0 && (
                          <div className="flex flex-wrap gap-2">
                            {entry.items.map(item => (
                              <EvidenceThumbnail
                                key={item.id}
                                item={item}
                                legs={legs}
                                onRemove={() => removeItem(currentNode.id, req.key, item.id)}
                                onScopeChange={(s) => setItemScope(currentNode.id, req.key, item.id, s)}
                              />
                            ))}
                          </div>
                        )}
                        <EvidenceUploadTrigger
                          hasItems={entry.items.length > 0}
                          onUpload={(file) => uploadFile(currentNode.id, req.key, file)}
                        />
                      </div>
                    )}

                    {showText && (
                      <div className="space-y-1.5">
                        <Textarea
                          placeholder={`Notes for ${req.label}...`}
                          value={entry.notes || ""}
                          onChange={(e) => updateEntry(currentNode.id, req.key, (cur) => ({ ...cur, notes: e.target.value }))}
                          rows={2}
                          className="text-xs"
                        />
                        {legs && legs.length > 0 && entry.notes?.trim() && (
                          <ScopeSelector
                            value={entry.notesScope || "group"}
                            legs={legs}
                            onChange={(s) => updateEntry(currentNode.id, req.key, (cur) => ({ ...cur, notesScope: s }))}
                            label="Notes apply to:"
                          />
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {currentNode.options.map((opt, i) => {
              const isLeaf = !opt.childId && opt.outcomeType;
              const colors = opt.outcomeType ? OUTCOME_COLORS[opt.outcomeType] : null;
              return (
                <Button
                  key={i}
                  size="sm"
                  variant={isLeaf ? "outline" : "default"}
                  className={isLeaf && colors ? `${colors.border} ${colors.text} hover:${colors.bg}` : ""}
                  onClick={() => handleChoice(i)}
                  disabled={hasEvidence && !evidenceReady}
                >
                  {opt.label}
                </Button>
              );
            })}
          </div>

          {hasEvidence && !evidenceReady && (
            <p className="text-[10px] text-amber-600">Complete all required evidence before proceeding</p>
          )}

          {steps.length > 0 && (
            <Button variant="ghost" size="sm" onClick={handleUndo} className="gap-1 text-xs">
              <Undo2 className="h-3 w-3" />Go Back
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
    </>
  );
});

function ScopeSelector({
  value, legs, onChange, label,
}: {
  value: string;
  legs: EvidenceLeg[];
  onChange: (s: string) => void;
  label?: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] text-muted-foreground whitespace-nowrap">{label || "Applies to:"}</span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-6 text-[10px] px-2 py-0 w-auto min-w-[120px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="group" className="text-xs">All legs</SelectItem>
          {legs.map(leg => (
            <SelectItem key={leg.id} value={String(leg.id)} className="text-xs">{leg.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function EvidenceThumbnail({
  item, legs, onRemove, onScopeChange,
}: {
  item: EvidenceItem;
  legs?: EvidenceLeg[];
  onRemove: () => void;
  onScopeChange: (s: string) => void;
}) {
  const src = item.imagePreview || (item.imageUrl?.startsWith("/objects/") ? `/api/storage${item.imageUrl}` : item.imageUrl);
  return (
    <div className="border rounded-md p-1.5 bg-muted/20 space-y-1.5">
      <div className="relative group">
        {src && <img src={src} alt="Evidence" className="rounded border max-h-24 w-auto" />}
        {item.uploading && (
          <div className="absolute inset-0 bg-white/60 flex items-center justify-center rounded">
            <Loader2 className="h-4 w-4 animate-spin text-violet-600" />
          </div>
        )}
        {!item.uploading && (
          <button
            onClick={onRemove}
            className="absolute top-0.5 right-0.5 bg-red-500 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
            aria-label="Remove image"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>
      {legs && legs.length > 0 && (
        <ScopeSelector
          value={item.scope || "group"}
          legs={legs}
          onChange={onScopeChange}
        />
      )}
    </div>
  );
}

function EvidenceUploadTrigger({
  hasItems,
  onUpload,
}: {
  hasItems: boolean;
  onUpload: (file: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const handlePasteImage = useCallback(async () => {
    try {
      const clipboardItems = await navigator.clipboard.read();
      for (const item of clipboardItems) {
        const imageType = item.types.find((t) => t.startsWith("image/"));
        if (imageType) {
          const blob = await item.getType(imageType);
          const ext = imageType.split("/")[1] || "png";
          const file = new File([blob], `pasted-image.${ext}`, { type: imageType });
          onUpload(file);
          return;
        }
      }
      toast({ title: "No image found in clipboard", description: "Copy a screenshot or image first, then paste here.", variant: "destructive" });
    } catch {
      toast({ title: "No image found in clipboard", description: "Copy a screenshot or image first, then paste here.", variant: "destructive" });
    }
  }, [onUpload]);

  const handlePasteEvent = useCallback((e: ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items)) {
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) onUpload(file);
        return;
      }
    }
  }, [onUpload]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener("paste", handlePasteEvent);
    return () => el.removeEventListener("paste", handlePasteEvent);
  }, [handlePasteEvent]);

  return (
    <div ref={containerRef} className="flex gap-2" tabIndex={0}>
      <input
        ref={inputRef}
        type="file"
        accept=".png,.jpg,.jpeg,.gif,.webp,.bmp,.tiff,.svg,.pdf"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) {
            onUpload(file);
            e.target.value = "";
          }
        }}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="text-xs gap-1"
        onClick={() => inputRef.current?.click()}
      >
        {hasItems ? <Plus className="h-3 w-3" /> : <Upload className="h-3 w-3" />}
        {hasItems ? "Add another" : "Upload image"}
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="text-xs gap-1"
        onClick={handlePasteImage}
      >
        <ClipboardPaste className="h-3 w-3" />
        Paste image
      </Button>
    </div>
  );
}

function StepsBreadcrumb({ steps }: { steps: Step[] }) {
  return (
    <div className="space-y-1 min-w-0">
      {steps.map((step, i) => (
        <div key={i} className="flex items-center gap-2 text-xs text-muted-foreground min-w-0 overflow-hidden">
          <CheckCircle2 className="h-3 w-3 text-green-500 shrink-0" />
          <span className="truncate min-w-0">{step.question}</span>
          <ChevronRight className="h-3 w-3 shrink-0" />
          <Badge variant="outline" className="text-[10px] truncate max-w-[40%]">{step.answer}</Badge>
        </div>
      ))}
    </div>
  );
}

export { type PlayerProps };
