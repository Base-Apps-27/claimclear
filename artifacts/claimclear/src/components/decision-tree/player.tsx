import { useState, useCallback, useRef } from "react";
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
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import {
  ChevronRight, Undo2, HelpCircle, CheckCircle2,
  Send, Ban, PauseCircle, Mail, FileText, Camera,
  Upload, X, Image as ImageIcon, Info, Loader2, ExternalLink,
} from "lucide-react";

const OUTCOME_ICONS: Record<OutcomeType, typeof Send> = {
  portal_dispute: Send,
  internal: Ban,
  hold: PauseCircle,
  dispute: Mail,
};

interface Step {
  nodeId: string;
  question: string;
  answer: string;
  optionIndex: number;
}

interface EvidenceItem {
  key: string;
  checked: boolean;
  imageUrl?: string;
  imagePreview?: string;
  notes?: string;
  uploading?: boolean;
}

interface PlayerProps {
  tree: DecisionTree;
  onOutcome: (outcomeType: OutcomeType, outcomeLabel: string) => void;
  isTestMode?: boolean;
  claimId?: number;
  onEvidenceCollected?: (evidence: {
    evidenceTypeId?: number;
    evidenceTypeName: string;
    treeNodeId: string;
    imageUrl?: string;
    notes?: string;
  }) => void;
}

export function TreePlayer({ tree, onOutcome, isTestMode, claimId, onEvidenceCollected }: PlayerProps) {
  const [steps, setSteps] = useState<Step[]>([]);
  const [currentNodeId, setCurrentNodeId] = useState(tree.rootId);
  const [outcome, setOutcome] = useState<{ type: OutcomeType; label: string } | null>(null);
  const [nodeEvidence, setNodeEvidence] = useState<Record<string, Record<string, EvidenceItem>>>({});

  const currentNode = tree.nodes.find(n => n.id === currentNodeId);
  const maxDepth = getMaxDepth(tree);
  const progress = maxDepth > 0 ? Math.round((steps.length / maxDepth) * 100) : 0;

  const handleChoice = useCallback((optionIndex: number) => {
    if (!currentNode) return;
    const opt = currentNode.options[optionIndex];
    if (!opt) return;

    if (currentNode.evidenceRequirements?.length && onEvidenceCollected && claimId) {
      const items = nodeEvidence[currentNode.id] || {};
      for (const req of currentNode.evidenceRequirements) {
        const item = items[req.key];
        if (item?.checked && (item.imageUrl || item.notes)) {
          onEvidenceCollected({
            evidenceTypeId: req.evidenceTypeId,
            evidenceTypeName: req.label,
            treeNodeId: currentNode.id,
            imageUrl: item.imageUrl,
            notes: item.notes,
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
  }, [currentNode, steps, isTestMode, onOutcome, nodeEvidence, claimId, onEvidenceCollected]);

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

  const updateEvidenceItem = (nodeId: string, key: string, updates: Partial<EvidenceItem>) => {
    setNodeEvidence(prev => ({
      ...prev,
      [nodeId]: {
        ...prev[nodeId],
        [key]: { ...prev[nodeId]?.[key], key, checked: prev[nodeId]?.[key]?.checked ?? false, ...updates },
      },
    }));
  };

  const nodeEvidenceComplete = (node: TreeNode): boolean => {
    if (!node.evidenceRequirements?.length) return true;
    const items = nodeEvidence[node.id] || {};
    return node.evidenceRequirements
      .filter(r => r.required)
      .every(r => items[r.key]?.checked);
  };

  if (outcome) {
    const colors = OUTCOME_COLORS[outcome.type];
    const Icon = OUTCOME_ICONS[outcome.type];
    return (
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
            <div className="flex gap-2 justify-center">
              <Button variant="outline" size="sm" onClick={handleUndo} className="gap-1">
                <Undo2 className="h-3 w-3" />Go Back
              </Button>
              <Button variant="outline" size="sm" onClick={handleRestart} className="gap-1">
                Restart
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!currentNode) return <p className="text-sm text-muted-foreground">Tree configuration error.</p>;

  const hasEvidence = !!currentNode.evidenceRequirements?.length;
  const evidenceReady = nodeEvidenceComplete(currentNode);

  return (
    <div className="space-y-3 min-w-0 overflow-hidden">
      {isTestMode && (
        <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-300">Test Mode - no changes will be saved</Badge>
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
                const item = nodeEvidence[currentNode.id]?.[req.key];
                const showImage = req.acceptsImage !== false;
                const showText = req.acceptsText === true;

                return (
                  <div key={req.key} className="space-y-2 bg-white dark:bg-background rounded-md p-2 border">
                    <label className="flex items-center gap-2 text-xs cursor-pointer">
                      <input
                        type="checkbox"
                        checked={!!item?.checked}
                        onChange={(e) => updateEvidenceItem(currentNode.id, req.key, { checked: e.target.checked })}
                        className="rounded"
                      />
                      <span className="font-medium">{req.label}</span>
                      {req.required && <Badge variant="secondary" className="text-[9px] h-4">Required</Badge>}
                    </label>

                    {showImage && (
                      <EvidenceImageUploader
                        imagePreview={item?.imagePreview}
                        imageUrl={item?.imageUrl}
                        uploading={item?.uploading}
                        onUpload={async (file) => {
                          updateEvidenceItem(currentNode.id, req.key, {
                            uploading: true,
                            imagePreview: URL.createObjectURL(file),
                          });
                          try {
                            const res = await fetch("/api/storage/uploads/request-url", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              credentials: "include",
                              body: JSON.stringify({
                                name: file.name,
                                size: file.size,
                                contentType: file.type,
                              }),
                            });
                            const { uploadURL, objectPath } = await res.json();
                            await fetch(uploadURL, {
                              method: "PUT",
                              headers: { "Content-Type": file.type },
                              body: file,
                            });
                            updateEvidenceItem(currentNode.id, req.key, {
                              imageUrl: objectPath,
                              uploading: false,
                              checked: true,
                            });
                          } catch {
                            updateEvidenceItem(currentNode.id, req.key, { uploading: false });
                          }
                        }}
                        onRemove={() => {
                          updateEvidenceItem(currentNode.id, req.key, {
                            imageUrl: undefined,
                            imagePreview: undefined,
                            checked: false,
                          });
                        }}
                      />
                    )}

                    {showText && (
                      <Textarea
                        placeholder={`Notes for ${req.label}...`}
                        value={item?.notes || ""}
                        onChange={(e) => updateEvidenceItem(currentNode.id, req.key, { notes: e.target.value })}
                        rows={2}
                        className="text-xs"
                      />
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
  );
}

function EvidenceImageUploader({
  imagePreview,
  imageUrl,
  uploading,
  onUpload,
  onRemove,
}: {
  imagePreview?: string;
  imageUrl?: string;
  uploading?: boolean;
  onUpload: (file: File) => void;
  onRemove: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  if (imagePreview || imageUrl) {
    const src = imagePreview || (imageUrl?.startsWith("/objects/") ? `/api/storage${imageUrl}` : imageUrl!);
    return (
      <div className="relative group">
        <img src={src} alt="Evidence" className="rounded border max-h-32 w-auto" />
        {uploading && (
          <div className="absolute inset-0 bg-white/60 flex items-center justify-center rounded">
            <Loader2 className="h-5 w-5 animate-spin text-violet-600" />
          </div>
        )}
        {!uploading && (
          <button
            onClick={onRemove}
            className="absolute top-1 right-1 bg-red-500 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex gap-2">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onUpload(file);
        }}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="text-xs gap-1"
        onClick={() => inputRef.current?.click()}
      >
        <Upload className="h-3 w-3" />
        Upload Image
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="text-xs gap-1"
        onClick={() => {
          if (inputRef.current) {
            inputRef.current.setAttribute("capture", "environment");
            inputRef.current.click();
            inputRef.current.removeAttribute("capture");
          }
        }}
      >
        <Camera className="h-3 w-3" />
        Take Photo
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
