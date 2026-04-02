import { useState, useCallback } from "react";
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
import {
  ChevronRight, Undo2, HelpCircle, CheckCircle2,
  Send, Ban, PauseCircle, Mail, FileText,
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

interface PlayerProps {
  tree: DecisionTree;
  onOutcome: (outcomeType: OutcomeType, outcomeLabel: string) => void;
  isTestMode?: boolean;
}

export function TreePlayer({ tree, onOutcome, isTestMode }: PlayerProps) {
  const [steps, setSteps] = useState<Step[]>([]);
  const [currentNodeId, setCurrentNodeId] = useState(tree.rootId);
  const [outcome, setOutcome] = useState<{ type: OutcomeType; label: string } | null>(null);
  const [nodeEvidence, setNodeEvidence] = useState<Record<string, Record<string, boolean>>>({});

  const currentNode = tree.nodes.find(n => n.id === currentNodeId);
  const maxDepth = getMaxDepth(tree);
  const progress = maxDepth > 0 ? Math.round((steps.length / maxDepth) * 100) : 0;

  const handleChoice = useCallback((optionIndex: number) => {
    if (!currentNode) return;
    const opt = currentNode.options[optionIndex];
    if (!opt) return;

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
  }, [currentNode, steps, isTestMode, onOutcome]);

  const handleUndo = useCallback(() => {
    if (steps.length === 0) return;
    if (outcome) {
      setOutcome(null);
    }
    const newSteps = steps.slice(0, -1);
    setSteps(newSteps);
    const prevNodeId = newSteps.length > 0 ? newSteps[newSteps.length - 1].nodeId : tree.rootId;
    if (newSteps.length > 0) {
      const lastStep = newSteps[newSteps.length - 1];
      const prevNode = tree.nodes.find(n => n.id === lastStep.nodeId);
      const chosenOpt = prevNode?.options[lastStep.optionIndex];
      if (chosenOpt?.childId) {
        setCurrentNodeId(chosenOpt.childId);
      } else {
        setCurrentNodeId(prevNodeId);
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

  const toggleEvidence = (nodeId: string, key: string) => {
    setNodeEvidence(prev => ({
      ...prev,
      [nodeId]: { ...prev[nodeId], [key]: !prev[nodeId]?.[key] },
    }));
  };

  const nodeEvidenceComplete = (node: TreeNode): boolean => {
    if (!node.evidenceRequirements?.length) return true;
    const checks = nodeEvidence[node.id] || {};
    return node.evidenceRequirements
      .filter(r => r.required)
      .every(r => checks[r.key]);
  };

  if (outcome) {
    const colors = OUTCOME_COLORS[outcome.type];
    const Icon = OUTCOME_ICONS[outcome.type];
    return (
      <div className="space-y-3">
        {isTestMode && (
          <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-300">Test Mode</Badge>
        )}
        <StepsBreadcrumb steps={steps} />
        <Card className={`${colors.bg} border ${colors.border}`}>
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
    <div className="space-y-3">
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

      <Card className="border-blue-200 bg-blue-50/50 dark:bg-blue-950/20">
        <CardContent className="p-4 space-y-3">
          <p className="text-sm font-semibold">{currentNode.question}</p>

          {currentNode.helpText && (
            <div className="flex items-start gap-2 bg-white dark:bg-background rounded-md p-2 border">
              <HelpCircle className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />
              <p className="text-xs text-muted-foreground">{currentNode.helpText}</p>
            </div>
          )}

          {hasEvidence && (
            <div className="bg-violet-50 dark:bg-violet-950/20 rounded-md p-3 space-y-2">
              <div className="flex items-center gap-1">
                <FileText className="h-3.5 w-3.5 text-violet-600" />
                <span className="text-xs font-medium text-violet-700">Evidence needed at this step</span>
              </div>
              {currentNode.evidenceRequirements!.map(req => (
                <label key={req.key} className="flex items-center gap-2 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!!nodeEvidence[currentNode.id]?.[req.key]}
                    onChange={() => toggleEvidence(currentNode.id, req.key)}
                    className="rounded"
                  />
                  <span>{req.label}</span>
                  {req.required && <Badge variant="secondary" className="text-[9px] h-4">Required</Badge>}
                </label>
              ))}
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

function StepsBreadcrumb({ steps }: { steps: Step[] }) {
  return (
    <div className="space-y-1">
      {steps.map((step, i) => (
        <div key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
          <CheckCircle2 className="h-3 w-3 text-green-500 shrink-0" />
          <span className="truncate">{step.question}</span>
          <ChevronRight className="h-3 w-3 shrink-0" />
          <Badge variant="outline" className="text-[10px] shrink-0">{step.answer}</Badge>
        </div>
      ))}
    </div>
  );
}

export { type PlayerProps };
