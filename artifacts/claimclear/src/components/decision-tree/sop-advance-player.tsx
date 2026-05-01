import { useMemo, useState, useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  type DecisionTree,
  type TreeNode,
  type OutcomeType,
  OUTCOME_LABELS,
  OUTCOME_COLORS,
  getMaxDepth,
} from "./types";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { toast } from "@/hooks/use-toast";
import {
  ChevronRight,
  HelpCircle,
  CheckCircle2,
  Send,
  Ban,
  PauseCircle,
  Mail,
  Loader2,
  XCircle,
  FileX,
  Play,
} from "lucide-react";

// v2 SOP-advance player: posts each step to /sop-advance so the server stays the source of truth.

interface SopAnswerRow {
  nodeId: string;
  answer: string;
  ts: string;
}

interface LegLite {
  id: number;
  errorTypeId?: string | null;
  sopNodeId?: string | null;
  sopOutcome?: string | null;
  sopAnswers?: unknown;
  dropReason?: string | null;
  invoiceGroupId?: number | null;
  perLegContext?: string | null;
}

interface Props {
  leg: LegLite;
  tree: DecisionTree;
  /** Disable advancing — typically when the parent surface is locked or
   *  the leg is in a terminal sub-status the operator must reclassify out
   *  of first. Tree navigation buttons are still rendered (so the operator
   *  can read the current question) but the answer choices are disabled. */
  disabledReason?: string | null;
  /** Called after a successful `/sop-advance` POST. Lets the parent refresh
   *  related queries (group preview, leg list, etc) without this component
   *  needing to know about them. */
  onAdvanced?: (next: { isTerminal: boolean; sopOutcome: string | null }) => void;
}

function apiBase(): string {
  return import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
}

const OUTCOME_ICONS: Record<OutcomeType, typeof Send> = {
  portal_dispute: Send,
  internal: Ban,
  hold: PauseCircle,
  dispute: Mail,
  cannot_dispute: XCircle,
  non_issue: FileX,
};

function normalizeAnswers(raw: unknown): SopAnswerRow[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((r): r is SopAnswerRow =>
    !!r && typeof r === "object" && "nodeId" in r && "answer" in r,
  );
}

export function SopAdvancePlayer({ leg, tree, disabledReason, onAdvanced }: Props) {
  const qc = useQueryClient();
  const disabled = !!disabledReason;
  const answers = useMemo(() => normalizeAnswers(leg.sopAnswers), [leg.sopAnswers]);
  const maxDepth = useMemo(() => getMaxDepth(tree), [tree]);

  const clearSopHoldMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${apiBase()}/api/claims/${leg.id}/clear-sop-hold`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `HTTP ${res.status}`);
      }
      return res.json() as Promise<LegLite>;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["claim", leg.id] });
      qc.invalidateQueries({ queryKey: ["claims"] });
      if (leg.invoiceGroupId != null) {
        qc.invalidateQueries({ queryKey: ["invoice-group", leg.invoiceGroupId] });
        qc.invalidateQueries({ queryKey: ["invoice-groups"] });
      }
      onAdvanced?.({ isTerminal: false, sopOutcome: null });
    },
    onError: (err: Error) => {
      toast({
        title: "Could not clear SOP hold",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  // The leg might already be terminal — derive the visible state from
  // the persisted sop_outcome/sop_node_id rather than from local state.
  const terminalOutcome: OutcomeType | null = useMemo(() => {
    if (!leg.sopOutcome) return null;
    if (leg.sopOutcome === "portal_dispute") return "portal_dispute";
    if (leg.sopOutcome === "dispute") return "dispute";
    if (leg.sopOutcome === "hold") return "hold";
    if (leg.sopOutcome === "cannot_dispute") return "cannot_dispute";
    if (leg.sopOutcome === "non_issue") return "non_issue";
    return null;
  }, [leg.sopOutcome]);

  const currentNodeId: string = leg.sopNodeId ?? tree.rootId;
  const currentNode: TreeNode | undefined = tree.nodes.find((n) => n.id === currentNodeId);

  const [pendingAnswer, setPendingAnswer] = useState<string | null>(null);

  // Derive a human-readable per-leg context string from the breadcrumb
  // of (question → answer) pairs. This is what gets persisted to the
  // leg's perLegContext field so the AI dispute write-up can pick it up
  // — replacing the previous standalone textarea on the queue strip.
  function deriveContextFromAnswers(rows: SopAnswerRow[]): string {
    const lines: string[] = [];
    for (const r of rows) {
      const node = tree.nodes.find((n) => n.id === r.nodeId);
      const q = (node?.question ?? r.nodeId).trim();
      lines.push(`• ${q} — ${r.answer}`);
    }
    return lines.join("\n");
  }

  async function persistDerivedContext(updated: LegLite) {
    const rows = normalizeAnswers(updated.sopAnswers);
    if (rows.length === 0) return;
    const derived = deriveContextFromAnswers(rows);
    if (!derived) return;
    // Don't clobber a manually-edited context that already differs
    // meaningfully from a pure derivation. We treat the existing context
    // as user-edited if it doesn't start with a derived-style bullet.
    const existing = (updated.perLegContext ?? "").trim();
    const looksDerived = existing === "" || existing.startsWith("• ");
    if (!looksDerived) return;
    try {
      await fetch(`${apiBase()}/api/claims/${leg.id}/per-leg-context`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ context: derived }),
      });
    } catch {
      // Non-fatal: the worktree advance itself succeeded; context
      // sync is a best-effort enrichment.
    }
  }

  const advanceMutation = useMutation({
    mutationFn: async ({ nodeId, answer }: { nodeId: string; answer: string }) => {
      const res = await fetch(`${apiBase()}/api/claims/${leg.id}/sop-advance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ nodeId, answer }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `HTTP ${res.status}`);
      }
      return res.json() as Promise<LegLite & { sopOutcome: string | null }>;
    },
    onSuccess: async (updated) => {
      const isTerminal = updated.sopOutcome != null;
      // Persist the derived per-leg context BEFORE invalidating, so the
      // refetched claim already carries the worktree-derived narrative.
      await persistDerivedContext(updated);
      // Invalidate every cache key that includes this leg or its parent
      // group so the rest of the v2 surface (Aggregate Context, Legs Queue,
      // group preview gate) reflects the new server state on next render.
      qc.invalidateQueries({ queryKey: ["claim", leg.id] });
      qc.invalidateQueries({ queryKey: ["claims"] });
      if (leg.invoiceGroupId != null) {
        qc.invalidateQueries({ queryKey: ["invoice-group", leg.invoiceGroupId] });
        qc.invalidateQueries({ queryKey: ["invoice-groups"] });
      }
      onAdvanced?.({ isTerminal, sopOutcome: updated.sopOutcome });
    },
    onError: (err: Error) => {
      toast({
        title: "Could not advance the SOP",
        description: err.message,
        variant: "destructive",
      });
    },
    onSettled: () => setPendingAnswer(null),
  });

  const handleChoice = useCallback(
    (answer: string) => {
      if (!currentNode || disabled || advanceMutation.isPending) return;
      setPendingAnswer(answer);
      advanceMutation.mutate({ nodeId: currentNode.id, answer });
    },
    [currentNode, disabled, advanceMutation],
  );

  // Terminal state — render the outcome banner. The operator's next
  // action (queue for portal, drop with closure intake, place on hold,
  // reclassify) lives in the parent v2 surface; this player just shows
  // what was decided.
  if (terminalOutcome) {
    const colors = OUTCOME_COLORS[terminalOutcome];
    const Icon = OUTCOME_ICONS[terminalOutcome];
    const label = OUTCOME_LABELS[terminalOutcome];
    const isSopHold = terminalOutcome === "hold";
    const canResumeFromNode = isSopHold && !!leg.sopNodeId && tree.nodes.some((n) => n.id === leg.sopNodeId);
    return (
      <div className="space-y-3 min-w-0">
        {answers.length > 0 && <SopBreadcrumb tree={tree} answers={answers} />}
        <Card className={`${colors.bg} border ${colors.border}`} data-testid="sop-terminal-card">
          <CardContent className="p-4 text-center space-y-2">
            <Icon className={`h-9 w-9 mx-auto ${colors.text}`} />
            <div>
              <p className={`text-base font-semibold ${colors.text}`}>{label}</p>
              <p className="text-xs text-muted-foreground mt-1">
                SOP outcome:{" "}
                <code className="font-mono">{leg.sopOutcome}</code>
                {leg.dropReason ? (
                  <>
                    {" · drop reason: "}
                    <code className="font-mono">{leg.dropReason}</code>
                  </>
                ) : null}
              </p>
              {isSopHold && canResumeFromNode ? (
                <div className="mt-3 space-y-2">
                  <p className="text-xs text-muted-foreground" data-testid="sop-hold-guidance">
                    SOP walk paused at this step. Resume to continue from where you left off.
                  </p>
                  <Button
                    size="sm"
                    className="gap-1.5"
                    disabled={disabled || clearSopHoldMutation.isPending}
                    onClick={() => clearSopHoldMutation.mutate()}
                    data-testid="sop-hold-resume-btn"
                  >
                    {clearSopHoldMutation.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Play className="h-3.5 w-3.5" />
                    )}
                    Resume — clear hold
                  </Button>
                  {disabled && disabledReason && (
                    <p className="text-xs text-muted-foreground italic">{disabledReason}</p>
                  )}
                </div>
              ) : isSopHold ? (
                <div className="mt-3 space-y-2">
                  <p className="text-xs text-amber-700" data-testid="sop-hold-stale-guidance">
                    Resume is not available; the SOP workflow was updated since this hold was placed. Reclassify the leg to restart the SOP walk.
                  </p>
                </div>
              ) : (
                <p
                  className="text-xs text-muted-foreground italic mt-2"
                  data-testid="sop-terminal-guidance"
                >
                  Outcome set by SOP — Reclassify if wrong.
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!currentNode) {
    return (
      <p className="text-sm text-muted-foreground">
        Tree configuration error — node <code>{currentNodeId}</code> not found in the current
        decision tree. Reclassify the leg to recover.
      </p>
    );
  }

  const progress = maxDepth > 0 ? Math.min(100, Math.round((answers.length / maxDepth) * 100)) : 0;

  return (
    <div className="space-y-3 min-w-0" data-testid="sop-advance-player">
      <div className="flex items-center gap-3">
        <Progress value={progress} className="flex-1 h-2" />
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          Step {answers.length + 1}
          {maxDepth > 0 ? ` of ~${maxDepth}` : ""}
        </span>
      </div>

      {answers.length > 0 && <SopBreadcrumb tree={tree} answers={answers} />}

      <Card className="border-blue-200 bg-blue-50 dark:bg-blue-950/30 dark:border-blue-900">
        <CardContent className="p-4 space-y-3">
          <p className="text-sm font-semibold">{currentNode.question}</p>
          {currentNode.helpText && (
            <div className="flex items-start gap-2 bg-white dark:bg-background rounded-md p-2 border">
              <HelpCircle className="h-4 w-4 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
              <p className="text-xs text-muted-foreground">{currentNode.helpText}</p>
            </div>
          )}

          <div className="space-y-1.5">
            {currentNode.options?.map((opt, i) => {
              const isPending = advanceMutation.isPending && pendingAnswer === opt.label;
              return (
                <Button
                  key={`${currentNode.id}-${i}`}
                  variant="outline"
                  className="w-full justify-between text-left h-auto py-2.5"
                  disabled={disabled || advanceMutation.isPending}
                  onClick={() => handleChoice(opt.label)}
                  data-testid={`sop-option-${i}`}
                >
                  <span className="text-sm">{opt.label}</span>
                  {isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0 ml-2" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5 opacity-60 shrink-0 ml-2" />
                  )}
                </Button>
              );
            })}
          </div>

          {disabled && disabledReason && (
            <p className="text-xs text-muted-foreground italic">{disabledReason}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SopBreadcrumb({ tree, answers }: { tree: DecisionTree; answers: SopAnswerRow[] }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[11px]" data-testid="sop-breadcrumb">
      {answers.map((a, i) => {
        const node = tree.nodes.find((n) => n.id === a.nodeId);
        return (
          <span
            key={`${a.nodeId}-${i}`}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border bg-muted/50"
          >
            <span className="text-muted-foreground truncate max-w-[140px]">
              {node?.question ?? a.nodeId}
            </span>
            <span className="text-muted-foreground">→</span>
            <Badge variant="secondary" className="h-4 px-1 text-[10px] font-medium">
              {a.answer}
            </Badge>
            {i < answers.length - 1 ? <ChevronRight className="h-3 w-3 opacity-50" /> : null}
          </span>
        );
      })}
      {answers.length > 0 && <CheckCircle2 className="h-3 w-3 text-green-600 ml-1" />}
    </div>
  );
}
