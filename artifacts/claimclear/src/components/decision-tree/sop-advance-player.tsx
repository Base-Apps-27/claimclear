import { useMemo, useState, useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  type DecisionTree,
  type TreeNode,
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
  Loader2,
} from "lucide-react";
import { terminalKindForLeg } from "@/lib/sop-terminal-routing";
import { IncludeTerminal } from "./terminals/include-terminal";
import { ClosedTerminal } from "./terminals/closed-terminal";
import { HoldTerminal } from "./terminals/hold-terminal";
import { DuplicateTerminal } from "./terminals/duplicate-terminal";
import {
  SiblingDuplicatePrompt,
  type SiblingDuplicatePromptProps,
} from "./terminals/sibling-prompt";
import type { TerminalLeg } from "./terminals/types";
import type { ErrorTypeChannelInput } from "@/lib/sop-terminal-routing";

// v2 SOP-advance player: posts each step to /sop-advance so the server stays the source of truth.

interface SopAnswerRow {
  nodeId: string;
  answer: string;
  ts: string;
}

interface LegLite extends TerminalLeg {
  errorTypeId?: string | null;
  sopAnswers?: unknown;
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
  /** Source for the include terminal's "Channel: …" hint. Owned by the
   *  parent surface (`claim-detail-v2`) which already loads the
   *  error-types list to render the badge in the leg header. */
  errorType?: ErrorTypeChannelInput | null;
  /** When set, the in-SOP sibling-detection prompt renders above the
   *  first SOP question. The parent computes eligibility — see
   *  `lib/sop-sibling-eligibility.ts`. */
  siblingPrompt?: Omit<SiblingDuplicatePromptProps, "legId" | "invoiceGroupId"> | null;
}

function apiBase(): string {
  return import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
}

function normalizeAnswers(raw: unknown): SopAnswerRow[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((r): r is SopAnswerRow =>
    !!r && typeof r === "object" && "nodeId" in r && "answer" in r,
  );
}

export function SopAdvancePlayer({
  leg,
  tree,
  disabledReason,
  onAdvanced,
  errorType,
  siblingPrompt,
}: Props) {
  const qc = useQueryClient();
  const disabled = !!disabledReason;
  const answers = useMemo(() => normalizeAnswers(leg.sopAnswers), [leg.sopAnswers]);
  const maxDepth = useMemo(() => getMaxDepth(tree), [tree]);

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

  // Terminal dispatch — single switch on outcomeRole-derived terminal
  // kind (Guard #1: no parallel enum, no precedence ladder copy here).
  const terminalKind = terminalKindForLeg(leg);
  if (terminalKind !== "none") {
    const terminalLeg: TerminalLeg = {
      id: leg.id,
      sopOutcome: leg.sopOutcome,
      sopNodeId: leg.sopNodeId,
      dropReason: leg.dropReason,
      duplicateOfClaimId: leg.duplicateOfClaimId,
      invoiceGroupId: leg.invoiceGroupId,
      perLegContext: leg.perLegContext,
    };
    return (
      <div className="space-y-3 min-w-0">
        {answers.length > 0 && <SopBreadcrumb tree={tree} answers={answers} />}
        {terminalKind === "include" && (
          <IncludeTerminal
            leg={terminalLeg}
            tree={tree}
            disabledReason={disabledReason}
            onAdvanced={onAdvanced}
            errorType={errorType ?? null}
          />
        )}
        {terminalKind === "closed" && (
          <ClosedTerminal
            leg={terminalLeg}
            tree={tree}
            disabledReason={disabledReason}
            onAdvanced={onAdvanced}
          />
        )}
        {terminalKind === "hold" && (
          <HoldTerminal
            leg={terminalLeg}
            tree={tree}
            disabledReason={disabledReason}
            onAdvanced={onAdvanced}
          />
        )}
        {terminalKind === "duplicate" && (
          <DuplicateTerminal
            leg={terminalLeg}
            tree={tree}
            disabledReason={disabledReason}
            onAdvanced={onAdvanced}
          />
        )}
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
  // The sibling-detection prompt only makes sense BEFORE the operator
  // has committed to walking the leg. Once any answer is recorded, the
  // operator's intent is clear and the prompt would be confusing noise.
  const showSiblingPrompt = !!siblingPrompt && answers.length === 0;

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

      {showSiblingPrompt && siblingPrompt && (
        <SiblingDuplicatePrompt
          legId={leg.id}
          invoiceGroupId={leg.invoiceGroupId ?? null}
          {...siblingPrompt}
        />
      )}

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

