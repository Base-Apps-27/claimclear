import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useLocation, Link } from "wouter";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  type Node,
  type Edge,
  type NodeProps,
  type EdgeProps,
  getBezierPath,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  useListErrorTypes,
  useUpdateErrorType,
  getListErrorTypesQueryKey,
  type ErrorTypeResponse,
} from "@workspace/api-client-react";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import {
  ChevronLeft,
  ChevronRight,
  Save,
  HelpCircle,
  CheckCircle2,
  XCircle,
  PauseCircle,
  FileText,
  Plus,
  Trash2,
  Copy,
  Search,
  ListTree,
  Settings as SettingsIcon,
  Sparkles,
  Loader2,
  Wand2,
  GitBranch,
  ArrowRight,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import {
  type DecisionTree,
  type OutcomeType,
  createEmptyTree,
  OUTCOME_LABELS,
  OUTCOME_AUTHOR_OPTIONS,
  validateAppliesPerInvoice,
  findEmptyEvidenceLabels,
} from "@/components/decision-tree/types";
import {
  treeToFlow,
  updateNode,
  setOption,
  insertBetween,
  addEvidenceReq,
  setEvidenceReq,
  removeEvidenceReq,
  simplifyTextField,
  buildTreeFromText,
  coerceTree,
  type FlowNodeData,
} from "./sop-full-page-editor-helpers";

// ---------------------------------------------------------------------------
// AI rewrite hook + inline accept/reject popover
// ---------------------------------------------------------------------------

function useSimplifyText(field: "question" | "instructions") {
  return useMutation({
    mutationFn: (text: string) => simplifyTextField(text, field),
  });
}

function AiRewriteButton({
  value,
  field,
  onAccept,
  testId,
  label = "Rewrite with AI",
}: {
  value: string;
  field: "question" | "instructions";
  onAccept: (next: string) => void;
  testId: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const mutation = useSimplifyText(field);
  const disabled = !value.trim() || mutation.isPending;

  const handleClick = () => {
    if (disabled) return;
    setOpen(true);
    mutation.mutate(value, {
      onError: (e) => {
        setOpen(false);
        toast({
          title: "AI rewrite failed",
          description: e instanceof Error ? e.message : "Unknown error",
          variant: "destructive",
        });
      },
    });
  };

  const suggestion = mutation.data;
  const unchanged = suggestion !== undefined && suggestion.trim() === value.trim();

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) mutation.reset();
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={handleClick}
          disabled={disabled}
          data-testid={testId}
          className="inline-flex items-center gap-1 h-6 px-2 text-[10px] font-medium rounded border transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          style={{
            color: "hsl(var(--cc-purple-fg))",
            background: "transparent",
            borderColor: "hsl(var(--cc-purple-border))",
          }}
          onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.background = "hsl(var(--cc-purple-bg))"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
        >
          {mutation.isPending ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <Wand2 className="w-3 h-3" />
          )}
          {label}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-3 space-y-2" align="end">
        {mutation.isPending ? (
          <div className="text-[11px] text-muted-foreground flex items-center gap-2">
            <Loader2 className="w-3 h-3 animate-spin" /> Rewriting…
          </div>
        ) : suggestion !== undefined ? (
          <>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Suggestion
            </div>
            <div
              className="text-xs whitespace-pre-wrap border border-border rounded p-2 bg-muted/30 max-h-48 overflow-y-auto"
              data-testid={`${testId}-suggestion`}
            >
              {suggestion}
            </div>
            {unchanged && (
              <div className="text-[10px] text-muted-foreground italic">
                AI returned no changes.
              </div>
            )}
            <div className="flex items-center justify-end gap-1.5">
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-[11px]"
                onClick={() => {
                  setOpen(false);
                  mutation.reset();
                }}
                data-testid={`${testId}-reject`}
              >
                Reject
              </Button>
              <Button
                size="sm"
                className="h-7 text-[11px]"
                disabled={unchanged}
                onClick={() => {
                  onAccept(suggestion);
                  setOpen(false);
                  mutation.reset();
                }}
                data-testid={`${testId}-accept`}
              >
                Accept
              </Button>
            </div>
          </>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// Custom React Flow node + edge components
// ---------------------------------------------------------------------------

function QuestionNodeView({ data }: NodeProps<Node<FlowNodeData>>) {
  return (
    <div
      className={`bg-card border-2 rounded-md shadow-sm w-[220px] transition-all ${
        data.selected
          ? "ring-2 ring-offset-2 ring-offset-background"
          : "hover:shadow-md"
      }`}
      style={{
        borderColor: data.selected ? "hsl(217 91% 60%)" : "hsl(214 95% 87%)",
      }}
      data-testid={`flow-node-question`}
    >
      <Handle type="target" position={Position.Top} className="!bg-slate-400 !w-2 !h-2" />
      <div
        className="px-2.5 py-1 border-b flex items-center gap-1.5"
        style={{ borderColor: "hsl(214 95% 93%)", background: "hsl(214 100% 98%)" }}
      >
        <HelpCircle className="w-3 h-3" style={{ color: "hsl(217 91% 45%)" }} />
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
          Question
        </span>
        {data.evidenceCount ? (
          <span
            className="ml-auto flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded font-semibold tabular-nums"
            style={{
              color: "hsl(var(--cc-amber-fg))",
              background: "hsl(var(--cc-amber-bg))",
              border: "1px solid hsl(var(--cc-amber-border))",
            }}
          >
            <FileText className="w-2.5 h-2.5" /> {data.evidenceCount}
          </span>
        ) : null}
      </div>
      <div className="px-2.5 py-2 text-xs font-medium leading-snug text-foreground line-clamp-3 min-h-[44px]">
        {data.label}
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-slate-400 !w-2 !h-2" />
    </div>
  );
}

function OutcomeNodeView({ data }: NodeProps<Node<FlowNodeData>>) {
  const isApprove = data.outcomeType === "portal_dispute" || data.outcomeType === "dispute";
  const isHold = data.outcomeType === "hold";
  const tokens = isApprove
    ? {
        bg: "hsl(var(--cc-green-bg))",
        border: "hsl(var(--cc-green-border))",
        fg: "hsl(var(--cc-green-fg))",
        Icon: CheckCircle2,
        label: "Outcome",
      }
    : isHold
      ? {
          bg: "hsl(var(--cc-amber-bg))",
          border: "hsl(var(--cc-amber-border))",
          fg: "hsl(var(--cc-amber-fg))",
          Icon: PauseCircle,
          label: "On hold",
        }
      : {
          bg: "hsl(0 84% 96%)",
          border: "hsl(0 84% 80%)",
          fg: "hsl(var(--destructive))",
          Icon: XCircle,
          label: "Dead-end",
        };
  const Icon = tokens.Icon;
  return (
    <div
      className="border-2 rounded-md shadow-sm w-[220px]"
      style={{ background: tokens.bg, borderColor: tokens.border }}
    >
      <Handle type="target" position={Position.Top} className="!bg-slate-400 !w-2 !h-2" />
      <div className="px-2.5 py-1 border-b border-current/10 flex items-center gap-1.5">
        <Icon className="w-3 h-3" style={{ color: tokens.fg }} />
        <span
          className="text-[10px] uppercase tracking-wider font-semibold"
          style={{ color: tokens.fg }}
        >
          {tokens.label}
        </span>
      </div>
      <div className="px-2.5 py-2 text-xs font-medium leading-snug min-h-[44px] text-foreground">
        {data.label}
      </div>
    </div>
  );
}

function InsertableEdge({
  id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, label, data,
}: EdgeProps & { label?: React.ReactNode; data?: { parentId: string; optionIndex: number } }) {
  const [path, labelX, labelY] = getBezierPath({
    sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition,
  });
  const onInsert = (e: React.MouseEvent) => {
    e.stopPropagation();
    const evt = new CustomEvent("sop-editor:insert-between", {
      detail: { edgeId: id, parentId: data?.parentId, optionIndex: data?.optionIndex },
    });
    window.dispatchEvent(evt);
  };
  return (
    <>
      <path id={id} d={path} fill="none" stroke="#94a3b8" strokeWidth={1.5} />
      {label && (
        <foreignObject x={labelX - 24} y={labelY - 12} width={48} height={20} style={{ overflow: "visible" }}>
          <div className="bg-white border border-slate-300 rounded-full text-[10px] px-1.5 py-0.5 text-center text-slate-600 font-medium shadow-sm select-none">
            {label}
          </div>
        </foreignObject>
      )}
      <foreignObject x={labelX + 18} y={labelY - 10} width={20} height={20} style={{ overflow: "visible" }}>
        <button
          onClick={onInsert}
          className="w-5 h-5 rounded-full text-white text-xs font-bold flex items-center justify-center shadow ring-2 ring-white opacity-0 hover:opacity-100 transition-opacity"
          style={{ background: "hsl(217 91% 50%)" }}
          title="Insert step between"
          data-testid={`insert-between-${id}`}
        >
          +
        </button>
      </foreignObject>
    </>
  );
}

const nodeTypes = { question: QuestionNodeView, outcome: OutcomeNodeView };
const edgeTypes = { insertable: InsertableEdge };

// ---------------------------------------------------------------------------
// Outline (left panel)
// ---------------------------------------------------------------------------

function Outline({
  tree, selectedId, onSelect, search,
}: {
  tree: DecisionTree;
  selectedId: string | null;
  onSelect: (id: string) => void;
  search: string;
}) {
  const filter = search.trim().toLowerCase();
  const visited = new Set<string>();
  const rows: React.ReactNode[] = [];
  const walk = (id: string, depth: number, branchLabel?: string) => {
    if (visited.has(id)) return;
    visited.add(id);
    const node = tree.nodes.find((n) => n.id === id);
    if (!node) return;
    const label = node.question || "(untitled)";
    const match = !filter || label.toLowerCase().includes(filter);
    if (match) {
      rows.push(
        <button
          key={id}
          onClick={() => onSelect(id)}
          className={`w-full text-left flex items-center gap-1.5 px-2 py-1 text-xs rounded transition-colors ${
            selectedId === id
              ? "font-semibold"
              : "hover:bg-muted/60"
          }`}
          style={{
            paddingLeft: 8 + depth * 14,
            background: selectedId === id ? "hsl(214 100% 96%)" : undefined,
            boxShadow: selectedId === id ? "inset 0 0 0 1px hsl(214 95% 80%)" : undefined,
          }}
          data-testid={`outline-row-${id}`}
        >
          <HelpCircle className="w-3 h-3 shrink-0" style={{ color: "hsl(217 91% 50%)" }} />
          {branchLabel && (
            <span
              className="text-[9px] px-1 rounded font-mono"
              style={{ color: "hsl(var(--cc-purple-fg))", background: "hsl(var(--cc-purple-bg))" }}
            >
              {branchLabel}
            </span>
          )}
          <span className="truncate text-foreground">{label}</span>
          {(node.evidenceRequirements?.length ?? 0) > 0 && (
            <span
              className="ml-auto text-[9px] px-1.5 py-0.5 rounded font-semibold tabular-nums"
              style={{
                color: "hsl(var(--cc-amber-fg))",
                background: "hsl(var(--cc-amber-bg))",
                border: "1px solid hsl(var(--cc-amber-border))",
              }}
            >
              {node.evidenceRequirements!.length} ev
            </span>
          )}
        </button>,
      );
    }
    for (const opt of node.options) {
      if (opt.childId) walk(opt.childId, depth + 1, opt.label);
    }
  };
  walk(tree.rootId, 0);
  return <div className="flex-1 overflow-y-auto py-1 space-y-0.5">{rows}</div>;
}

// ---------------------------------------------------------------------------
// Right inspector
// ---------------------------------------------------------------------------

function Inspector({
  tree, nodeId, onChange,
}: {
  tree: DecisionTree;
  nodeId: string | null;
  onChange: (tree: DecisionTree) => void;
}) {
  if (!nodeId) {
    return (
      <div className="p-4 text-xs text-muted-foreground">
        Select a node in the canvas or outline to edit it.
      </div>
    );
  }
  const node = tree.nodes.find((n) => n.id === nodeId);
  if (!node) {
    return <div className="p-4 text-xs text-muted-foreground">Node not found.</div>;
  }
  const branchCount = node.options.length;
  const evidenceCount = node.evidenceRequirements?.length ?? 0;
  return (
    <div className="flex flex-col h-full" data-testid="inspector">
      <div className="px-3 pt-3 pb-2 border-b border-border bg-card">
        <div className="flex items-center gap-2">
          <div
            className="w-6 h-6 rounded-md flex items-center justify-center shrink-0"
            style={{ background: "hsl(214 100% 96%)", border: "1px solid hsl(214 95% 87%)" }}
          >
            <HelpCircle className="w-3.5 h-3.5" style={{ color: "hsl(217 91% 45%)" }} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold leading-none">
              Question step
            </div>
            <div className="text-[10px] text-muted-foreground font-mono mt-0.5 truncate">
              {node.id.slice(0, 16)}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1 mt-2 text-[10px]">
          <span
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-semibold tabular-nums"
            style={{
              color: "hsl(var(--cc-purple-fg))",
              background: "hsl(var(--cc-purple-bg))",
              border: "1px solid hsl(var(--cc-purple-border))",
            }}
          >
            <GitBranch className="w-2.5 h-2.5" /> {branchCount} {branchCount === 1 ? "branch" : "branches"}
          </span>
          {evidenceCount > 0 && (
            <span
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-semibold tabular-nums"
              style={{
                color: "hsl(var(--cc-amber-fg))",
                background: "hsl(var(--cc-amber-bg))",
                border: "1px solid hsl(var(--cc-amber-border))",
              }}
            >
              <FileText className="w-2.5 h-2.5" /> {evidenceCount} ev
            </span>
          )}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        <div>
          <div className="flex items-center justify-between mb-1">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Question text</Label>
            <AiRewriteButton
              value={node.question}
              field="question"
              testId="inspector-question-ai-rewrite"
              onAccept={(next) => onChange(updateNode(tree, node.id, { question: next }))}
            />
          </div>
          <Textarea
            data-testid="inspector-question"
            rows={3}
            value={node.question}
            onChange={(e) => onChange(updateNode(tree, node.id, { question: e.target.value }))}
            className="text-xs"
          />
        </div>
        <div>
          <div className="flex items-center justify-between mb-1">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Instructions / help</Label>
            <AiRewriteButton
              value={node.instructionText || ""}
              field="instructions"
              testId="inspector-instructions-ai-rewrite"
              onAccept={(next) => onChange(updateNode(tree, node.id, { instructionText: next }))}
            />
          </div>
          <Textarea
            rows={2}
            value={node.instructionText || ""}
            onChange={(e) => onChange(updateNode(tree, node.id, { instructionText: e.target.value }))}
            className="text-xs"
            placeholder="Optional guidance shown to the operator."
          />
        </div>

        <div>
          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Branches</Label>
          <div className="mt-1 space-y-1.5">
            {node.options.map((opt, idx) => (
              <div key={idx} className="rounded-md border border-border bg-background overflow-hidden">
                <div
                  className="px-2 py-1 flex items-center gap-1.5 border-b border-border"
                  style={{ background: "hsl(var(--muted) / 0.3)" }}
                >
                  <span
                    className="text-[9px] font-mono font-semibold px-1.5 py-0.5 rounded tabular-nums shrink-0"
                    style={{
                      color: "hsl(var(--cc-purple-fg))",
                      background: "hsl(var(--cc-purple-bg))",
                    }}
                  >
                    #{idx + 1}
                  </span>
                  <Input
                    value={opt.label}
                    onChange={(e) => onChange(setOption(tree, node.id, idx, { label: e.target.value }))}
                    className="h-6 text-xs border-0 bg-transparent shadow-none focus-visible:ring-0 px-1"
                    placeholder="Branch label"
                  />
                </div>
                <div className="p-1.5">
                {opt.childId ? (
                  <div className="text-[10px] text-muted-foreground flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1">
                      <ArrowRight className="w-3 h-3" />
                      Continues to next question
                    </span>
                    <button
                      className="hover:underline font-medium"
                      style={{ color: "hsl(var(--cc-purple-fg))" }}
                      onClick={() => onChange(setOption(tree, node.id, idx, { childId: undefined }))}
                    >
                      Detach
                    </button>
                  </div>
                ) : (
                  <Select
                    value={opt.outcomeType || ""}
                    onValueChange={(val) =>
                      onChange(setOption(tree, node.id, idx, { outcomeType: val as OutcomeType, outcomeLabel: OUTCOME_LABELS[val as OutcomeType] }))
                    }
                  >
                    <SelectTrigger className="h-7 text-xs">
                      <SelectValue placeholder="Pick outcome…" />
                    </SelectTrigger>
                    <SelectContent>
                      {OUTCOME_AUTHOR_OPTIONS.map((o) => (
                        <SelectItem key={o} value={o} className="text-xs">
                          {OUTCOME_LABELS[o]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-1.5">
              Evidence requirements
              <span
                className="px-1.5 py-0.5 rounded font-semibold tabular-nums normal-case tracking-normal"
                style={{
                  color: "hsl(var(--cc-amber-fg))",
                  background: "hsl(var(--cc-amber-bg))",
                  border: "1px solid hsl(var(--cc-amber-border))",
                }}
              >
                {(node.evidenceRequirements || []).length}
              </span>
            </Label>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-[10px]"
              onClick={() => onChange(addEvidenceReq(tree, node.id))}
              data-testid="add-evidence"
            >
              <Plus className="w-3 h-3 mr-1" /> Add
            </Button>
          </div>
          <div className="space-y-1.5">
            {(node.evidenceRequirements || []).map((req, idx) => (
              <div
                key={idx}
                className="rounded-md p-1.5 flex items-center gap-1.5"
                style={{
                  background: "hsl(var(--cc-amber-bg) / 0.4)",
                  border: "1px solid hsl(var(--cc-amber-border))",
                }}
              >
                <FileText className="w-3 h-3 shrink-0" style={{ color: "hsl(var(--cc-amber-fg))" }} />
                <Input
                  value={req.label}
                  onChange={(e) => onChange(setEvidenceReq(tree, node.id, idx, { label: e.target.value }))}
                  className="h-6 text-xs flex-1 border-0 bg-transparent shadow-none focus-visible:ring-0 px-1"
                  placeholder="Evidence name"
                />
                <button
                  className="p-1 hover:bg-background/60 rounded"
                  onClick={() => onChange(removeEvidenceReq(tree, node.id, idx))}
                  title="Remove"
                >
                  <Trash2 className="w-3 h-3 text-muted-foreground" />
                </button>
              </div>
            ))}
            {(node.evidenceRequirements || []).length === 0 && (
              <div className="text-[10px] text-muted-foreground italic px-1">
                No evidence required for this step.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// AI Builder left-panel tab — paste an SOP description, get back a full
// decision tree from the AI. Shows a diff summary (node count + the
// outgoing tree's root question) before letting the author replace
// their in-memory tree. The change is NOT auto-saved — the user must
// still click Save in the top bar.
// ---------------------------------------------------------------------------

function AiBuilderPanel({
  currentTree,
  errorTypeName,
  onReplace,
}: {
  currentTree: DecisionTree;
  errorTypeName?: string;
  onReplace: (next: DecisionTree) => void;
}) {
  const [text, setText] = useState("");
  const [proposed, setProposed] = useState<DecisionTree | null>(null);
  const mutation = useMutation({
    mutationFn: (description: string) => buildTreeFromText(description, errorTypeName),
    onSuccess: (tree) => setProposed(tree),
    onError: (e) => {
      toast({
        title: "AI build failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    },
  });

  const handleGenerate = () => {
    if (!text.trim() || mutation.isPending) return;
    setProposed(null);
    mutation.mutate(text);
  };

  const handleReplace = () => {
    if (!proposed) return;
    onReplace(proposed);
    setProposed(null);
    toast({
      title: "Tree replaced",
      description: "Click Save to persist the new tree.",
    });
  };

  const proposedRoot = proposed
    ? proposed.nodes.find((n) => n.id === proposed.rootId)?.question || "(untitled)"
    : null;

  return (
    <div className="flex flex-col h-full p-2 gap-2" data-testid="ai-builder-panel">
      <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
        Describe the workflow
      </Label>
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={8}
        className="text-xs"
        placeholder={"Paste the SOP in plain English. Example:\n\nFirst check if GPS data is available. If yes, verify the breadcrumbs match pickup and dropoff. If they match, mark ready. Otherwise place on hold."}
        data-testid="ai-builder-text"
        disabled={mutation.isPending}
      />
      <Button
        size="sm"
        onClick={handleGenerate}
        disabled={!text.trim() || mutation.isPending}
        data-testid="ai-builder-generate"
        className="gap-1"
      >
        {mutation.isPending ? (
          <><Loader2 className="w-3 h-3 animate-spin" /> Generating…</>
        ) : (
          <><Wand2 className="w-3 h-3" /> Generate tree</>
        )}
      </Button>
      {proposed && (
        <div className="border border-border rounded p-2 space-y-2 bg-muted/30" data-testid="ai-builder-diff">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Proposed tree
          </div>
          <div className="text-xs space-y-1">
            <div>
              <span className="text-muted-foreground">Current:</span>{" "}
              <span className="font-medium">{currentTree.nodes.length}</span> nodes
            </div>
            <div>
              <span className="text-muted-foreground">Proposed:</span>{" "}
              <span className="font-medium">{proposed.nodes.length}</span> nodes
            </div>
            <div className="text-muted-foreground">
              Starts with: <span className="text-foreground italic">"{proposedRoot}"</span>
            </div>
          </div>
          <div className="flex items-center justify-end gap-1.5">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-[11px]"
              onClick={() => setProposed(null)}
              data-testid="ai-builder-cancel"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className="h-7 text-[11px]"
              onClick={handleReplace}
              data-testid="ai-builder-replace"
            >
              Replace tree
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground italic">
            Replacing swaps the canvas in memory. Click Save in the top bar to persist.
          </p>
        </div>
      )}
    </div>
  );
}

export default function SopFullPageEditor() {
  const params = useParams<{ errorTypeId: string }>();
  const errorTypeId = Number(params.errorTypeId);
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();

  const { data: errorTypes, isLoading } = useListErrorTypes();
  const updateMutation = useUpdateErrorType();

  const errorType: ErrorTypeResponse | undefined = useMemo(
    () => (errorTypes || []).find((et) => et.id === errorTypeId),
    [errorTypes, errorTypeId],
  );

  const [tree, setTree] = useState<DecisionTree | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [leftTab, setLeftTab] = useState<"outline" | "ai" | "settings">("outline");

  // Load tree from server when the error type arrives.
  useEffect(() => {
    if (!errorType) return;
    const t = coerceTree(errorType.decisionTree) ?? createEmptyTree();
    setTree(t);
    setSelectedId(t.rootId);
    setDirty(false);
  }, [errorType]);

  // Listen for insert-between events from the custom edge component.
  useEffect(() => {
    function handler(ev: Event) {
      const detail = (ev as CustomEvent).detail as { parentId: string; optionIndex: number };
      setTree((cur) => {
        if (!cur) return cur;
        const { tree: next, newId } = insertBetween(cur, detail.parentId, detail.optionIndex);
        setSelectedId(newId);
        setDirty(true);
        return next;
      });
    }
    window.addEventListener("sop-editor:insert-between", handler as EventListener);
    return () => window.removeEventListener("sop-editor:insert-between", handler as EventListener);
  }, []);

  const onTreeChange = useCallback((next: DecisionTree) => {
    setTree(next);
    setDirty(true);
  }, []);

  const flow = useMemo(() => (tree ? treeToFlow(tree, selectedId) : { nodes: [], edges: [] }), [tree, selectedId]);

  const handleSave = async () => {
    if (!errorType || !tree) return;
    // Mirror the same author-time guards the modal save path enforces
    // (error-types.tsx::handleSave). Without these, the full-page editor
    // can persist trees the modal explicitly refuses — Task #470
    // (appliesPerInvoice) and Task #706 (empty evidence labels) — which
    // breaks the bulk endpoint and the SOP runner downstream.
    const violations = validateAppliesPerInvoice(tree);
    if (violations.length > 0) {
      toast({
        title: "Can't save — invalid \"same answer for every leg\" step",
        description:
          "One or more steps marked \"same answer for every leg\" still collect evidence or require per-leg context. Open the affected step and clear the issue, then save again.",
        variant: "destructive",
      });
      return;
    }
    const emptyLabels = findEmptyEvidenceLabels(tree);
    if (emptyLabels.length > 0) {
      toast({
        title: "Can't save — evidence is missing a name",
        description:
          emptyLabels.length === 1
            ? "One evidence requirement has an empty name. Open the affected step and give it a clear, human-readable name."
            : `${emptyLabels.length} evidence requirements have empty names. Open each affected step and give them clear names.`,
        variant: "destructive",
      });
      setSelectedId(emptyLabels[0].nodeId);
      return;
    }
    setSaving(true);
    try {
      await updateMutation.mutateAsync({
        id: errorType.id,
        data: {
          decisionTree: JSON.parse(JSON.stringify(tree)) as unknown as Record<string, unknown>,
        },
      });
      await queryClient.invalidateQueries({ queryKey: getListErrorTypesQueryKey() });
      setDirty(false);
      toast({ title: "Saved", description: "SOP tree updated." });
    } catch (e) {
      toast({
        title: "Save failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) {
    return <div className="p-8 text-sm text-muted-foreground">Loading SOP…</div>;
  }
  if (!errorType) {
    return (
      <div className="p-8 text-sm">
        <p className="text-muted-foreground mb-2">Error type not found.</p>
        <Link href="/error-types" className="text-blue-600 hover:underline">← Back to Error Types</Link>
      </div>
    );
  }
  if (!tree) return null;

  const selectedNode = selectedId ? tree.nodes.find((n) => n.id === selectedId) : null;

  return (
    <div className="h-[calc(100vh-4rem)] -mx-4 -mb-4 flex flex-col bg-background border-t border-border" data-testid="sop-full-page-editor">
      {/* Top bar — breadcrumb + status + actions */}
      <div className="h-14 pl-2 pr-3 flex items-center gap-3 border-b border-border bg-card shrink-0">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate("/error-types")}
          data-testid="back-to-error-types"
          className="h-8 px-2 text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="w-4 h-4" />
        </Button>
        {/* Breadcrumb */}
        <nav className="flex items-center gap-1.5 text-xs min-w-0" aria-label="Breadcrumb">
          <button
            onClick={() => navigate("/error-types")}
            className="text-muted-foreground hover:text-foreground truncate"
          >
            Error Types
          </button>
          {errorType.category && (
            <>
              <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0" />
              <span className="text-muted-foreground truncate">{errorType.category}</span>
            </>
          )}
          <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0" />
          <span
            className="font-semibold text-foreground truncate"
            data-testid="breadcrumb-error-type-name"
          >
            {errorType.name}
          </span>
        </nav>
        {/* Status pill */}
        {dirty ? (
          <span
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider shrink-0"
            style={{
              color: "hsl(var(--cc-amber-fg))",
              background: "hsl(var(--cc-amber-bg))",
              border: "1px solid hsl(var(--cc-amber-border))",
            }}
            data-testid="status-pill-unsaved"
          >
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{ background: "hsl(var(--cc-amber-fg))" }}
            />
            Unsaved
          </span>
        ) : (
          <span
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider shrink-0"
            style={{
              color: "hsl(var(--cc-green-fg))",
              background: "hsl(var(--cc-green-bg))",
              border: "1px solid hsl(var(--cc-green-border))",
            }}
            data-testid="status-pill-saved"
          >
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{ background: "hsl(var(--cc-success))" }}
            />
            Saved
          </span>
        )}
        <div className="flex-1" />
        {/* Tree stats */}
        <div className="hidden md:flex items-center gap-3 text-[10px] text-muted-foreground shrink-0">
          <span className="flex items-center gap-1">
            <span className="uppercase tracking-wider font-semibold">Nodes</span>
            <span className="font-bold tabular-nums text-foreground">{tree.nodes.length}</span>
          </span>
          <span className="w-px h-3 bg-border" aria-hidden />
          <span className="flex items-center gap-1">
            <span className="uppercase tracking-wider font-semibold">Evidence</span>
            <span className="font-bold tabular-nums text-foreground">
              {tree.nodes.reduce((s, n) => s + (n.evidenceRequirements?.length ?? 0), 0)}
            </span>
          </span>
        </div>
        <div className="w-px h-6 bg-border hidden md:block" aria-hidden />
        <Button
          size="sm"
          onClick={handleSave}
          disabled={!dirty || saving}
          data-testid="save-tree"
          className="h-8"
        >
          {saving ? (
            <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
          ) : (
            <Save className="w-3.5 h-3.5 mr-1.5" />
          )}
          {saving ? "Saving…" : "Save SOP"}
        </Button>
      </div>

      {/* Three-panel body */}
      <div className="flex-1 flex min-h-0">
        {/* Left panel — outline */}
        <div className="w-72 border-r border-border bg-card flex flex-col shrink-0">
          <div className="flex border-b border-border bg-muted/30">
            {([
              { id: "outline", label: "Outline", Icon: ListTree },
              { id: "ai", label: "AI Builder", Icon: Wand2 },
              { id: "settings", label: "Settings", Icon: SettingsIcon },
            ] as const).map((tab) => {
              const active = leftTab === tab.id;
              const Icon = tab.Icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setLeftTab(tab.id)}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-[11px] font-semibold uppercase tracking-wider border-b-2 transition-colors ${
                    active
                      ? "border-foreground text-foreground bg-card"
                      : "border-transparent text-muted-foreground hover:text-foreground hover:bg-card/60"
                  }`}
                  data-testid={`left-tab-${tab.id}`}
                >
                  <Icon className="w-3.5 h-3.5" /> {tab.label}
                </button>
              );
            })}
          </div>
          {leftTab === "outline" ? (
            <>
              <div className="p-2 border-b border-border">
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search nodes…"
                    className="pl-7 h-7 text-xs"
                    data-testid="outline-search"
                  />
                </div>
              </div>
              <Outline
                tree={tree}
                selectedId={selectedId}
                onSelect={setSelectedId}
                search={search}
              />
            </>
          ) : leftTab === "ai" ? (
            <AiBuilderPanel
              currentTree={tree}
              errorTypeName={errorType.name}
              onReplace={(next) => {
                setTree(next);
                setSelectedId(next.rootId);
                setDirty(true);
                setLeftTab("outline");
              }}
            />
          ) : (
            <div className="p-3 text-xs text-muted-foreground space-y-2">
              <div>
                <Label className="text-[10px] uppercase tracking-wider">Name</Label>
                <div className="font-medium text-foreground">{errorType.name}</div>
              </div>
              <div>
                <Label className="text-[10px] uppercase tracking-wider">Category</Label>
                <div className="text-foreground">{errorType.category || "—"}</div>
              </div>
              <p className="text-[10px] mt-3 italic">
                Edit full settings (name, category, dispute instructions, channel) from the Error Types page modal.
                That move into this panel is on the Phase 2 list.
              </p>
            </div>
          )}
        </div>

        {/* Center canvas */}
        <div
          className="flex-1 relative min-w-0"
          style={{
            backgroundImage:
              "radial-gradient(circle, hsl(var(--border)) 1px, transparent 1px)",
            backgroundSize: "18px 18px",
          }}
        >
          <ReactFlow
            nodes={flow.nodes}
            edges={flow.edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodeClick={(_, n) => {
              if ((n.data as FlowNodeData).kind === "question") setSelectedId(n.id);
            }}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            proOptions={{ hideAttribution: true }}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable
          >
            <Background gap={18} color="transparent" />
            <Controls
              showInteractive={false}
              className="!shadow-md !border !border-border !rounded-md overflow-hidden"
            />
            <MiniMap pannable zoomable className="!border !border-border !rounded-md" />
          </ReactFlow>
        </div>

        {/* Right inspector */}
        <div className="w-80 border-l border-border bg-card flex flex-col shrink-0">
          <Inspector tree={tree} nodeId={selectedId} onChange={onTreeChange} />
          {selectedNode && dirty && (
            <div
              className="border-t border-border px-3 py-2 text-[10px] flex items-center gap-1.5"
              style={{
                background: "hsl(var(--cc-amber-bg) / 0.5)",
                color: "hsl(var(--cc-amber-fg))",
              }}
            >
              <span
                className="w-1.5 h-1.5 rounded-full shrink-0"
                style={{ background: "hsl(var(--cc-amber-fg))" }}
              />
              <span className="font-medium">Edit pending — press Save SOP to persist.</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
