import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  Save,
  HelpCircle,
  CheckCircle2,
  XCircle,
  FileText,
  Plus,
  Trash2,
  Search,
  ListTree,
  Settings as SettingsIcon,
  Sparkles,
  Loader2,
  Wand2,
  Replace,
  Type,
  Library,
  Bookmark,
  History,
  AlertCircle,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { StatusDot } from "@/components/cohesion";
import { PlainTextEditor } from "@/components/decision-tree/plain-text-editor";
import { FindReplaceDialog } from "./sop-full-page-editor-find-replace";
import { LibraryDrawer, SaveToLibraryDialog } from "./sop-full-page-editor-library";
import { HistoryDrawer } from "./sop-full-page-editor-history";
import { extractSubTreeFromEditor, treesEqual, settingsEqual } from "./sop-full-page-editor-helpers";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
  buildSavePayload,
  addEvidenceReqToMany,
  bulkToggleAppliesPerInvoice,
  type FlowNodeData,
  type SopEditorSettings,
} from "./sop-full-page-editor-helpers";
import { Card } from "@/components/ui/card";

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
}: {
  value: string;
  field: "question" | "instructions";
  onAccept: (next: string) => void;
  testId: string;
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
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-[10px]"
          onClick={handleClick}
          disabled={disabled}
          data-testid={testId}
        >
          {mutation.isPending ? (
            <Loader2 className="w-3 h-3 mr-1 animate-spin" />
          ) : (
            <Sparkles className="w-3 h-3 mr-1" />
          )}
          AI rewrite
        </Button>
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
      className="bg-card rounded-md shadow-sm w-[220px]"
      style={{
        border: `1px solid hsl(var(--cc-blue-border))`,
        boxShadow: data.selected
          ? `0 0 0 2px hsl(var(--background)), 0 0 0 4px hsl(var(--cc-blue-fg))`
          : undefined,
      }}
      data-testid={`flow-node-question`}
    >
      <Handle type="target" position={Position.Top} className="!bg-muted-foreground" />
      <div
        className="px-2.5 py-1 flex items-center gap-1.5 border-b"
        style={{ background: "hsl(var(--cc-blue-bg))", borderColor: "hsl(var(--cc-blue-border))" }}
      >
        <HelpCircle className="w-3 h-3" style={{ color: "hsl(var(--cc-blue-fg))" }} />
        <span
          className="text-[10px] uppercase tracking-wider font-semibold"
          style={{ color: "hsl(var(--cc-blue-fg))" }}
        >
          Question
        </span>
        {data.evidenceCount ? (
          <span
            className="ml-auto inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded font-semibold tabular-nums"
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
      <div className="px-2.5 py-2 text-xs font-medium leading-snug text-card-foreground line-clamp-3 min-h-[44px]">
        {data.label}
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-muted-foreground" />
    </div>
  );
}

function OutcomeNodeView({ data }: NodeProps<Node<FlowNodeData>>) {
  const isApprove = data.outcomeType === "portal_dispute" || data.outcomeType === "dispute";
  const isHold = data.outcomeType === "hold";
  const palette = isApprove
    ? { bg: "hsl(var(--cc-green-bg))", border: "hsl(var(--cc-green-border))", fg: "hsl(var(--cc-green-fg))", label: "Outcome" }
    : isHold
      ? { bg: "hsl(var(--cc-amber-bg))", border: "hsl(var(--cc-amber-border))", fg: "hsl(var(--cc-amber-fg))", label: "Outcome" }
      : { bg: "hsl(var(--cc-red-bg))", border: "hsl(var(--cc-red-border))", fg: "hsl(var(--cc-red-fg))", label: "Dead-end" };
  const Icon = isApprove ? CheckCircle2 : isHold ? FileText : XCircle;
  return (
    <div
      className="rounded-md shadow-sm w-[220px]"
      style={{ background: palette.bg, border: `1px solid ${palette.border}` }}
    >
      <Handle type="target" position={Position.Top} className="!bg-muted-foreground" />
      <div className="px-2.5 py-1 border-b border-current/10 flex items-center gap-1.5">
        <Icon className="w-3 h-3" style={{ color: palette.fg }} />
        <span
          className="text-[10px] uppercase tracking-wider font-semibold"
          style={{ color: palette.fg }}
        >
          {palette.label}
        </span>
      </div>
      <div className="px-2.5 py-2 text-xs font-medium leading-snug text-card-foreground min-h-[44px]">{data.label}</div>
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
      <path id={id} d={path} fill="none" stroke="hsl(var(--border))" strokeWidth={1.5} />
      {label && (
        <foreignObject x={labelX - 24} y={labelY - 12} width={48} height={20} style={{ overflow: "visible" }}>
          <div className="bg-card border border-border rounded-full text-[10px] px-1.5 py-0.5 text-center text-muted-foreground font-medium shadow-sm select-none">
            {label}
          </div>
        </foreignObject>
      )}
      <foreignObject x={labelX + 18} y={labelY - 10} width={20} height={20} style={{ overflow: "visible" }}>
        <button
          onClick={onInsert}
          className="w-5 h-5 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center hover:opacity-90 shadow ring-2 ring-background opacity-0 hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-opacity"
          title="Insert step between"
          aria-label="Insert step between"
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
          className={`w-full text-left flex items-center gap-1.5 px-2 py-1 text-xs rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
            selectedId === id ? "font-medium" : "hover:bg-muted/60"
          }`}
          style={{
            paddingLeft: 8 + depth * 14,
            background: selectedId === id ? "hsl(var(--cc-blue-bg))" : undefined,
            boxShadow: selectedId === id ? "inset 0 0 0 1px hsl(var(--cc-blue-border))" : undefined,
          }}
          data-testid={`outline-row-${id}`}
        >
          <HelpCircle className="w-3 h-3 shrink-0" style={{ color: "hsl(var(--cc-blue-fg))" }} />
          {branchLabel && <span className="text-[9px] text-muted-foreground">[{branchLabel}]</span>}
          <span className="truncate text-foreground">{label}</span>
          {(node.evidenceRequirements?.length ?? 0) > 0 && (
            <span
              className="ml-auto text-[9px] px-1 rounded font-semibold tabular-nums"
              style={{
                color: "hsl(var(--cc-amber-fg))",
                background: "hsl(var(--cc-amber-bg))",
              }}
            >
              {node.evidenceRequirements!.length}ev
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
  tree, nodeId, onChange, onSaveEvidenceToLibrary, onSaveSubTreeToLibrary,
}: {
  tree: DecisionTree;
  nodeId: string | null;
  onChange: (tree: DecisionTree) => void;
  onSaveEvidenceToLibrary: (nodeId: string, index: number) => void;
  onSaveSubTreeToLibrary: (nodeId: string) => void;
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
  const evidenceCount = (node.evidenceRequirements || []).length;
  const outcomeCount = node.options.filter((o) => !o.childId && o.outcomeType).length;
  return (
    <div className="flex flex-col h-full" data-testid="inspector">
      <div className="px-3 py-2 border-b border-border bg-card flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <div
            className="w-7 h-7 rounded-md flex items-center justify-center shrink-0"
            style={{
              background: "hsl(var(--cc-blue-bg))",
              border: "1px solid hsl(var(--cc-blue-border))",
            }}
            aria-hidden="true"
          >
            <HelpCircle className="w-3.5 h-3.5" style={{ color: "hsl(var(--cc-blue-fg))" }} />
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Question node</span>
            <span className="text-[10px] text-muted-foreground font-mono truncate">{node.id.slice(0, 12)}</span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-6 px-2 text-[10px]"
            onClick={() => onSaveSubTreeToLibrary(node.id)}
            data-testid="inspector-save-sub-tree-to-library"
            title="Save this node and its descendants to the SOP library"
            aria-label="Save sub-tree to SOP library"
          >
            <Bookmark className="w-3 h-3 mr-1" /> Save sub-tree
          </Button>
        </div>
        <div className="flex items-center gap-2 flex-wrap" data-testid="inspector-chip-row">
          <span className="inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded-full border border-border bg-muted/40">
            <StatusDot tone="blue" />
            <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">Branches</span>
            <span className="text-[10px] tabular-nums font-medium text-foreground">{branchCount}</span>
          </span>
          <span className="inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded-full border border-border bg-muted/40">
            <StatusDot tone={outcomeCount > 0 ? "green" : "muted"} />
            <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">Outcomes</span>
            <span className="text-[10px] tabular-nums font-medium text-foreground">{outcomeCount}</span>
          </span>
          <span className="inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded-full border border-border bg-muted/40">
            <StatusDot tone={evidenceCount > 0 ? "amber" : "muted"} />
            <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">Evidence</span>
            <span className="text-[10px] tabular-nums font-medium text-foreground">{evidenceCount}</span>
          </span>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        <div>
          <div className="flex items-center justify-between">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Question text</Label>
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
            className="mt-1 text-xs"
          />
        </div>
        <div>
          <div className="flex items-center justify-between">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Instructions / help</Label>
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
            className="mt-1 text-xs"
            placeholder="Optional guidance shown to the operator."
          />
        </div>

        <div>
          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Branches</Label>
          <div className="mt-1 space-y-2">
            {node.options.map((opt, idx) => {
              const isContinuation = !!opt.childId;
              const tone: "blue" | "green" | "amber" | "muted" = isContinuation
                ? "blue"
                : opt.outcomeType
                  ? "green"
                  : "muted";
              const bgVar = isContinuation
                ? "--cc-blue-bg"
                : opt.outcomeType
                  ? "--cc-green-bg"
                  : null;
              const borderVar = isContinuation
                ? "--cc-blue-border"
                : opt.outcomeType
                  ? "--cc-green-border"
                  : null;
              return (
                <div
                  key={idx}
                  className="rounded p-2 space-y-1.5 border focus-within:ring-2 focus-within:ring-offset-0 transition-shadow"
                  style={{
                    background: bgVar ? `hsl(var(${bgVar}))` : "hsl(var(--background))",
                    borderColor: borderVar ? `hsl(var(${borderVar}))` : "hsl(var(--border))",
                    ["--tw-ring-color" as string]: "hsl(var(--cc-blue-border))",
                  }}
                  data-testid={`inspector-branch-${idx}`}
                >
                  <div className="flex items-center gap-1.5">
                    <StatusDot tone={tone} />
                    <Input
                      value={opt.label}
                      onChange={(e) => onChange(setOption(tree, node.id, idx, { label: e.target.value }))}
                      className="h-7 text-xs bg-card"
                      placeholder="Branch label"
                    />
                  </div>
                  {isContinuation ? (
                    <div className="text-[10px] flex items-center justify-between" style={{ color: "hsl(var(--cc-blue-fg))" }}>
                      <span className="uppercase tracking-wider font-semibold">→ Continues</span>
                      <button
                        className="text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                        onClick={() => onChange(setOption(tree, node.id, idx, { childId: undefined }))}
                      >
                        Detach
                      </button>
                    </div>
                  ) : (
                    <div>
                      <Select
                        value={opt.outcomeType || ""}
                        onValueChange={(val) =>
                          onChange(setOption(tree, node.id, idx, { outcomeType: val as OutcomeType, outcomeLabel: OUTCOME_LABELS[val as OutcomeType] }))
                        }
                      >
                        <SelectTrigger className="h-7 text-xs bg-card">
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
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Evidence requirements ({(node.evidenceRequirements || []).length})
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
                className="rounded p-1.5 flex items-center gap-1.5 border focus-within:ring-2 focus-within:ring-offset-0 transition-shadow"
                style={{
                  background: "hsl(var(--cc-amber-bg))",
                  borderColor: "hsl(var(--cc-amber-border))",
                  ["--tw-ring-color" as string]: "hsl(var(--cc-blue-border))",
                }}
                data-testid={`inspector-evidence-${idx}`}
              >
                <FileText className="w-3 h-3 shrink-0" style={{ color: "hsl(var(--cc-amber-fg))" }} />
                <Input
                  value={req.label}
                  onChange={(e) => onChange(setEvidenceReq(tree, node.id, idx, { label: e.target.value }))}
                  className="h-6 text-xs flex-1 bg-card"
                  placeholder="Evidence name"
                />
                <button
                  className="p-1 hover:bg-muted rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => onSaveEvidenceToLibrary(node.id, idx)}
                  title="Save to library"
                  aria-label="Save evidence to library"
                  data-testid={`inspector-save-evidence-to-library-${idx}`}
                >
                  <Bookmark className="w-3 h-3 text-muted-foreground" />
                </button>
                <button
                  className="p-1 hover:bg-muted rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => onChange(removeEvidenceReq(tree, node.id, idx))}
                  title="Remove"
                  aria-label="Remove evidence requirement"
                >
                  <Trash2 className="w-3 h-3 text-muted-foreground" />
                </button>
              </div>
            ))}
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

// ---------------------------------------------------------------------------
// Settings panel — full editable form for the error_types columns that the
// canvas doesn't already manage (everything but decisionTree,
// evidenceRequirements, disputeReasonsLibrary, emailTemplate). Mirrors
// the old modal's "basics" tab so authors never have to bounce back to
// /error-types just to rename an SOP or flip a channel. Changes go into
// the editor's `settings` state and ride along with the tree on Save.
// ---------------------------------------------------------------------------

type SubmissionPath = "portal_other" | "portal_gps" | "direct_email";

function pathFromSettings(
  s: Pick<SopEditorSettings, "useGpsControlDeviation" | "useDirectEmail">,
): SubmissionPath {
  if (s.useDirectEmail) return "direct_email";
  if (s.useGpsControlDeviation) return "portal_gps";
  return "portal_other";
}

function flagsFromPath(
  p: SubmissionPath,
): { useGpsControlDeviation: boolean; useDirectEmail: boolean } {
  return {
    useGpsControlDeviation: p === "portal_gps",
    useDirectEmail: p === "direct_email",
  };
}

function SettingsPanel({
  settings,
  onChange,
}: {
  settings: SopEditorSettings;
  onChange: (patch: Partial<SopEditorSettings>) => void;
}) {
  const submissionPath = pathFromSettings(settings);
  return (
    <div
      className="flex-1 overflow-y-auto p-3 space-y-3"
      data-testid="settings-panel"
    >
      <div>
        <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Name <span className="text-destructive">*</span>
        </Label>
        <Input
          value={settings.name}
          onChange={(e) => onChange({ name: e.target.value })}
          className="mt-1 h-8 text-xs"
          placeholder="e.g., No-Show — GPS Confirmed"
          data-testid="settings-name"
        />
      </div>
      <div>
        <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Category
        </Label>
        <Input
          value={settings.category}
          onChange={(e) => onChange({ category: e.target.value })}
          className="mt-1 h-8 text-xs"
          placeholder="e.g., GPS Issues, Scheduling"
          data-testid="settings-category"
        />
      </div>
      <div>
        <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Description
        </Label>
        <Textarea
          value={settings.description}
          onChange={(e) => onChange({ description: e.target.value })}
          rows={3}
          className="mt-1 text-xs"
          placeholder="When this error type applies…"
          data-testid="settings-description"
        />
      </div>
      <div>
        <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Guidance
        </Label>
        <Textarea
          value={settings.guidance}
          onChange={(e) => onChange({ guidance: e.target.value })}
          rows={3}
          className="mt-1 text-xs"
          placeholder="High-level guidance shown to staff while reviewing."
          data-testid="settings-guidance"
        />
      </div>
      <div>
        <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Recommended actions
        </Label>
        <Textarea
          value={settings.recommendedActions}
          onChange={(e) => onChange({ recommendedActions: e.target.value })}
          rows={3}
          className="mt-1 text-xs"
          placeholder="Suggested next steps after the SOP completes."
          data-testid="settings-recommended-actions"
        />
      </div>

      <div className="rounded-md border border-border p-2 space-y-2">
        <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Submission path
        </Label>
        <Select
          value={submissionPath}
          onValueChange={(v) => onChange(flagsFromPath(v as SubmissionPath))}
        >
          <SelectTrigger className="h-8 text-xs" data-testid="settings-submission-path">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="portal_other" className="text-xs">
              MAS Portal — Other Issue (default)
            </SelectItem>
            <SelectItem value="portal_gps" className="text-xs">
              MAS Portal — GPS Control Deviation
            </SelectItem>
            <SelectItem value="direct_email" className="text-xs">
              Direct Email
            </SelectItem>
          </SelectContent>
        </Select>
        <p className="text-[10px] text-muted-foreground leading-snug">
          Pick exactly one. Portal options file a Freshdesk ticket;
          Direct Email bypasses the portal and emails the dispute to the
          address configured in Settings → Direct Email.
        </p>
      </div>

      <div className="rounded-md border border-border p-2 flex items-start gap-2">
        <Switch
          checked={settings.tripOverriding}
          onCheckedChange={(v) => onChange({ tripOverriding: v })}
          data-testid="settings-trip-overriding"
        />
        <div className="space-y-0.5">
          <Label className="text-xs">Trip-overriding error</Label>
          <p className="text-[10px] text-muted-foreground leading-snug">
            ON when this error invalidates the whole trip (eligibility
            lapse, time-at-facility). Sibling legs can ride along as
            <em> Sibling Duplicate</em> instead of running their own SOP.
          </p>
        </div>
      </div>

      <div>
        <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Dispute instructions
        </Label>
        <Textarea
          value={settings.disputeInstructions}
          onChange={(e) => onChange({ disputeInstructions: e.target.value })}
          rows={5}
          className="mt-1 text-xs"
          placeholder={"Writing guidelines the AI uses for portal dispute notes.\nLeave blank to use the global default from Settings."}
          data-testid="settings-dispute-instructions"
        />
      </div>
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
  // Task #777 — selection is now a Set so the canvas can shift-click
  // multiple question nodes. The Outline + Inspector still treat the
  // single-selection case (size === 1) exactly as before; the bulk
  // action bar appears only when size > 1.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const selectedId =
    selectedIds.size === 1
      ? (selectedIds.values().next().value as string)
      : null;
  const setSelectedId = useCallback((id: string | null) => {
    setSelectedIds(id == null ? new Set() : new Set([id]));
  }, []);
  const toggleSelectedId = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const [bulkEvidenceOpen, setBulkEvidenceOpen] = useState(false);
  const [bulkEvidenceLabel, setBulkEvidenceLabel] = useState("");
  const [search, setSearch] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [leftTab, setLeftTab] = useState<"outline" | "ai" | "settings" | "plaintext">("outline");
  const [findReplaceOpen, setFindReplaceOpen] = useState(false);
  // Bumped on every successful persist so child components (the Plain
  // Text tab) can reset their unsaved-change baseline regardless of
  // which Save button triggered the write.
  const [savedVersion, setSavedVersion] = useState(0);
  // Snapshot of the last loaded/saved tree+settings; used to recompute
  // the global dirty flag when an operation (like Plain Text's
  // Discard) reverts state back to a known baseline.
  const loadedSnapshotRef = useRef<{ tree: DecisionTree; settings: SopEditorSettings } | null>(null);
  const [libraryDrawerOpen, setLibraryDrawerOpen] = useState(false);
  const [historyDrawerOpen, setHistoryDrawerOpen] = useState(false);
  // Pending payload to save to the library; null when no dialog open.
  const [saveToLibrary, setSaveToLibrary] = useState<
    | { kind: "evidence_requirement"; payload: Record<string, unknown>; defaultLabel: string }
    | { kind: "sub_tree"; payload: Record<string, unknown>; defaultLabel: string }
    | null
  >(null);
  const [settings, setSettings] = useState<SopEditorSettings>({
    name: "",
    category: "",
    description: "",
    guidance: "",
    recommendedActions: "",
    disputeInstructions: "",
    useGpsControlDeviation: false,
    useDirectEmail: false,
    tripOverriding: false,
  });

  // Load tree + settings from server when the error type arrives.
  useEffect(() => {
    if (!errorType) return;
    const t = coerceTree(errorType.decisionTree) ?? createEmptyTree();
    const s: SopEditorSettings = {
      name: errorType.name || "",
      category: errorType.category || "",
      description: errorType.description || "",
      guidance: errorType.guidance || "",
      recommendedActions: errorType.recommendedActions || "",
      disputeInstructions: errorType.disputeInstructions || "",
      useGpsControlDeviation: errorType.useGpsControlDeviation === true,
      useDirectEmail: errorType.useDirectEmail === true,
      tripOverriding: errorType.tripOverriding === true,
    };
    setTree(t);
    setSelectedId(t.rootId);
    setSettings(s);
    setDirty(false);
    loadedSnapshotRef.current = { tree: t, settings: s };
  }, [errorType]);

  const updateSettings = useCallback((patch: Partial<SopEditorSettings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
    setDirty(true);
  }, []);

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

  // Keyboard shortcuts: ⌘F opens Find & Replace, ⌘S saves.
  // We listen at the window level so the shortcut works regardless of
  // which panel currently holds focus. The handlers no-op when no tree
  // has loaded yet to avoid acting on a half-mounted editor.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key === "f") {
        e.preventDefault();
        setFindReplaceOpen(true);
      } else if (key === "s") {
        e.preventDefault();
        void handleSaveRef.current?.();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Stable ref to the latest handleSave so the keydown listener above
  // can call the current closure without re-binding on every render.
  const handleSaveRef = useRef<(() => Promise<void>) | null>(null);

  const flow = useMemo(
    () => (tree ? treeToFlow(tree, selectedIds) : { nodes: [], edges: [] }),
    [tree, selectedIds],
  );

  // Task #777 — bulk: append the same evidence requirement to every
  // selected question node, then close the popover + clear the input.
  const handleBulkAddEvidence = useCallback(() => {
    if (!tree) return;
    const label = bulkEvidenceLabel.trim();
    if (!label || selectedIds.size < 2) return;
    setTree(addEvidenceReqToMany(tree, selectedIds, label));
    setDirty(true);
    setBulkEvidenceOpen(false);
    setBulkEvidenceLabel("");
    toast({
      title: "Evidence requirement added",
      description: `Added "${label}" to ${selectedIds.size} nodes.`,
    });
  }, [tree, selectedIds, bulkEvidenceLabel]);

  // Task #777 — per-node flip of the "applies per invoice" flag. Each
  // selected node is independently inverted; nodes whose `false→true`
  // flip would create a save-time validation error are skipped and
  // reported in the toast.
  const handleBulkToggleAppliesPerInvoice = useCallback(() => {
    if (!tree || selectedIds.size < 2) return;
    const { tree: nextTree, skipped } = bulkToggleAppliesPerInvoice(
      tree,
      selectedIds,
    );
    setTree(nextTree);
    setDirty(true);
    const appliedCount = selectedIds.size - skipped.length;
    if (skipped.length > 0) {
      toast({
        title:
          appliedCount > 0
            ? `Flipped ${appliedCount} of ${selectedIds.size} nodes`
            : "No nodes flipped",
        description:
          `${skipped.length} node${skipped.length === 1 ? "" : "s"} skipped — turning "applies per invoice" on there would conflict with evidence or per-leg context on the node or its immediate next step.`,
        variant: appliedCount === 0 ? "destructive" : undefined,
      });
    } else {
      toast({
        title: `Flipped "applies per invoice" on ${appliedCount} nodes`,
      });
    }
  }, [tree, selectedIds]);

  // Task #778 — open the Save dialog with the right payload for the
  // chosen evidence row. Captures the EvidenceReq minus id so the
  // library payload matches the new backend's shape.
  const handleSaveEvidenceToLibrary = useCallback(
    (nodeId: string, index: number) => {
      if (!tree) return;
      const node = tree.nodes.find((n) => n.id === nodeId);
      const req = node?.evidenceRequirements?.[index];
      if (!req) return;
      // Drop the synthetic `key` from the payload — it's only meaningful
      // within the editor's local list. The library payload is the
      // semantic shape (label/required/typeId/etc).
      const { key: _key, ...rest } = req;
      void _key;
      setSaveToLibrary({
        kind: "evidence_requirement",
        payload: rest as unknown as Record<string, unknown>,
        defaultLabel: req.label || "",
      });
    },
    [tree],
  );

  const handleSaveSubTreeToLibrary = useCallback(
    (nodeId: string) => {
      if (!tree) return;
      const subTree = extractSubTreeFromEditor(tree, nodeId);
      const root = subTree.nodes.find((n) => n.id === subTree.rootId);
      setSaveToLibrary({
        kind: "sub_tree",
        payload: JSON.parse(JSON.stringify(subTree)) as Record<string, unknown>,
        defaultLabel: root?.question || "",
      });
    },
    [tree],
  );

  // Shared persistence path. Throws on validation or network errors so
  // callers (the top-bar Save button AND the Plain Text tab's Save All
  // button) can surface failures consistently. Always operates on the
  // latest in-memory tree from state, which both the canvas/Inspector
  // and the Plain Text tab write through.
  const persistTreeAndSettings = useCallback(
    async (treeToSave: DecisionTree) => {
      if (!errorType) throw new Error("Error type not loaded");
      if (!settings.name.trim()) {
        setLeftTab("settings");
        throw new Error("Name is required — open the Settings tab to add one.");
      }
      const violations = validateAppliesPerInvoice(treeToSave);
      if (violations.length > 0) {
        throw new Error(
          "One or more steps marked \"same answer for every leg\" still collect evidence or require per-leg context.",
        );
      }
      const emptyLabels = findEmptyEvidenceLabels(treeToSave);
      if (emptyLabels.length > 0) {
        setSelectedId(emptyLabels[0].nodeId);
        throw new Error(
          emptyLabels.length === 1
            ? "One evidence requirement has an empty name."
            : `${emptyLabels.length} evidence requirements have empty names.`,
        );
      }
      await updateMutation.mutateAsync({
        id: errorType.id,
        data: buildSavePayload(treeToSave, settings),
      });
      await queryClient.invalidateQueries({ queryKey: getListErrorTypesQueryKey() });
      setDirty(false);
      loadedSnapshotRef.current = { tree: treeToSave, settings };
      setSavedVersion((v) => v + 1);
    },
    [errorType, settings, updateMutation, queryClient],
  );

  // Recompute the global dirty flag after a baseline revert (Plain
  // Text's Discard). Cheap JSON.stringify compare against the
  // last loaded/saved snapshot — close enough since the editor only
  // edits the tree + the small SopEditorSettings object.
  const recomputeDirty = useCallback(
    (nextTree: DecisionTree, nextSettings: SopEditorSettings) => {
      const snap = loadedSnapshotRef.current;
      if (!snap) return;
      const same =
        JSON.stringify(nextTree) === JSON.stringify(snap.tree) &&
        JSON.stringify(nextSettings) === JSON.stringify(snap.settings);
      setDirty(!same);
    },
    [],
  );

  const handleSave = async (): Promise<void> => {
    if (!errorType || !tree) return;
    setSaving(true);
    try {
      // Single source of truth for saving — also bumps `savedVersion`
      // and updates `loadedSnapshotRef` so the Plain Text tab's
      // unsaved-change baseline stays in sync no matter which Save
      // button triggered the write.
      await persistTreeAndSettings(tree);
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
  handleSaveRef.current = handleSave;

  if (isLoading) {
    return (
      <div className="h-[calc(100vh-4rem)] -mx-4 -mb-4 flex flex-col bg-background border-t border-border" data-testid="sop-editor-loading">
        <div className="h-14 px-4 flex items-center gap-3 border-b border-border bg-card">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-6 w-48" />
          <div className="flex-1" />
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-8 w-28" />
        </div>
        <div className="flex-1 flex min-h-0">
          <div className="w-72 border-r border-border bg-card p-3 space-y-2">
            <Skeleton className="h-7 w-full" />
            <Skeleton className="h-7 w-full" />
            <Skeleton className="h-7 w-3/4" />
            <Skeleton className="h-7 w-5/6" />
          </div>
          <div className="flex-1 p-6 space-y-3">
            <Skeleton className="h-24 w-64" />
            <Skeleton className="h-24 w-64 ml-12" />
          </div>
          <div className="w-80 border-l border-border bg-card p-3 space-y-2">
            <Skeleton className="h-7 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-7 w-full" />
          </div>
        </div>
      </div>
    );
  }
  if (!errorType) {
    return (
      <div className="p-8">
        <EmptyState
          icon={AlertCircle}
          title="Error type not found"
          description="This SOP may have been deleted or you may not have access to it."
          primaryAction={{ label: "Back to Error Types", href: "/error-types" }}
        />
      </div>
    );
  }
  if (!tree) return null;

  const selectedNode = selectedId ? tree.nodes.find((n) => n.id === selectedId) : null;

  return (
    <div className="h-[calc(100vh-4rem)] -mx-4 -mb-4 flex flex-col bg-background border-t border-border" data-testid="sop-full-page-editor">
      {/* Top bar — PageHeader-rhythm with breadcrumb + status pill */}
      <div className="h-14 px-4 flex items-center gap-3 border-b border-border bg-card shrink-0">
        <button
          onClick={() => navigate("/error-types")}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded px-1 -ml-1"
          data-testid="back-to-error-types"
          aria-label="Back to Error Types"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
          Error Types
        </button>
        <span className="text-muted-foreground/60 text-xs" aria-hidden="true">›</span>
        <h1 className="text-sm font-semibold truncate max-w-md" data-testid="sop-editor-title">
          {errorType.name}
        </h1>
        {dirty ? (
          <span
            className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] uppercase tracking-wider font-semibold"
            style={{
              color: "hsl(var(--cc-amber-fg))",
              background: "hsl(var(--cc-amber-bg))",
              border: "1px solid hsl(var(--cc-amber-border))",
            }}
            data-testid="sop-editor-status-pill"
          >
            <StatusDot tone="amber" />
            Draft · unsaved
          </span>
        ) : (
          <span
            className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] uppercase tracking-wider font-semibold"
            style={{
              color: "hsl(var(--cc-green-fg))",
              background: "hsl(var(--cc-green-bg))",
              border: "1px solid hsl(var(--cc-green-border))",
            }}
            data-testid="sop-editor-status-pill"
          >
            <StatusDot tone="green" />
            Saved
          </span>
        )}
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setHistoryDrawerOpen(true)}
          data-testid="open-history-drawer"
          aria-label="Open version history"
          className="h-8 gap-1"
        >
          <History className="w-3.5 h-3.5" /> History
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setLibraryDrawerOpen(true)}
          data-testid="open-library-drawer"
          aria-label="Open SOP library"
          className="h-8 gap-1"
        >
          <Library className="w-3.5 h-3.5" /> Library
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setFindReplaceOpen(true)}
          data-testid="open-find-replace"
          aria-label="Find and replace across SOPs"
          className="h-8 gap-1"
        >
          <Replace className="w-3.5 h-3.5" /> Find &amp; Replace
          <kbd className="ml-1 hidden md:inline-flex h-4 items-center rounded border border-border bg-muted/50 px-1 text-[9px] font-mono text-muted-foreground tabular-nums">
            ⌘F
          </kbd>
        </Button>
        <div className="h-6 w-px bg-border mx-1" aria-hidden="true" />
        <Button
          size="sm"
          onClick={handleSave}
          disabled={!dirty || saving}
          data-testid="save-tree"
          className="h-8 gap-1"
          aria-label="Save SOP"
        >
          <Save className="w-3.5 h-3.5" /> {saving ? "Saving…" : "Save SOP"}
          <kbd className="ml-1 hidden md:inline-flex h-4 items-center rounded border border-primary-foreground/30 bg-primary-foreground/10 px-1 text-[9px] font-mono text-primary-foreground/80 tabular-nums">
            ⌘S
          </kbd>
        </Button>
      </div>

      {/* Three-panel body */}
      <div className="flex-1 flex min-h-0">
        {/* Left panel — outline */}
        <div className="w-72 border-r border-border bg-card flex flex-col shrink-0">
          <div
            className="flex items-center gap-1 px-2 py-1.5 bg-muted/30 border-b border-border"
            role="tablist"
            aria-label="Left panel"
          >
            {([
              { id: "outline", label: "Outline", Icon: ListTree },
              { id: "plaintext", label: "Plain Text", Icon: Type },
              { id: "ai", label: "AI Builder", Icon: Wand2 },
              { id: "settings", label: "Settings", Icon: SettingsIcon },
            ] as const).map(({ id, label, Icon }) => {
              const active = leftTab === id;
              return (
                <button
                  key={id}
                  onClick={() => setLeftTab(id)}
                  role="tab"
                  aria-selected={active}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 px-2 py-1 rounded-full text-[10px] uppercase tracking-wider font-semibold border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                  style={
                    active
                      ? {
                          color: "hsl(var(--cc-blue-fg))",
                          background: "hsl(var(--cc-blue-bg))",
                          borderColor: "hsl(var(--cc-blue-border))",
                        }
                      : {
                          color: "hsl(var(--muted-foreground))",
                          background: "transparent",
                          borderColor: "transparent",
                        }
                  }
                  data-testid={`left-tab-${id}`}
                >
                  {active ? <StatusDot tone="blue" /> : <Icon className="w-3 h-3" />}
                  {label}
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
          ) : leftTab === "plaintext" ? (
            <div
              className="flex-1 overflow-y-auto p-3"
              data-testid="plaintext-panel"
            >
              <PlainTextEditor
                tree={tree}
                onTreeChange={onTreeChange}
                savedVersion={savedVersion}
                onDiscard={(baseline) => {
                  setTree(baseline);
                  recomputeDirty(baseline, settings);
                }}
                onSave={async (updated) => {
                  try {
                    await persistTreeAndSettings(updated);
                    toast({ title: "Saved", description: "SOP tree updated." });
                  } catch (e) {
                    toast({
                      title: "Save failed",
                      description: e instanceof Error ? e.message : "Unknown error",
                      variant: "destructive",
                    });
                    throw e;
                  }
                }}
              />
            </div>
          ) : (
            <SettingsPanel settings={settings} onChange={updateSettings} />
          )}
        </div>

        {/* Center canvas */}
        <div className="flex-1 relative min-w-0">
          <ReactFlow
            nodes={flow.nodes}
            edges={flow.edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodeClick={(ev, n) => {
              // Outcome (synthetic terminal) nodes are not selectable
              // — only question nodes participate in selection.
              if ((n.data as FlowNodeData).kind !== "question") return;
              if (ev.shiftKey) toggleSelectedId(n.id);
              else setSelectedId(n.id);
            }}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            proOptions={{ hideAttribution: true }}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable
          >
            <Background gap={18} />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable />
          </ReactFlow>

          {selectedIds.size > 1 && (
            <Card
              className="absolute left-1/2 -translate-x-1/2 bottom-4 z-10 h-14 px-4 flex items-center gap-3 shadow-lg border-border bg-card"
              data-testid="bulk-action-bar"
            >
              <span className="inline-flex items-center gap-1.5">
                <StatusDot tone="blue" />
                <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">Selected</span>
                <span className="text-xs tabular-nums font-medium text-foreground">{selectedIds.size}</span>
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">nodes</span>
              </span>
              <div className="h-6 w-px bg-border mx-1" aria-hidden="true" />
              <Popover
                open={bulkEvidenceOpen}
                onOpenChange={(o) => {
                  setBulkEvidenceOpen(o);
                  if (!o) setBulkEvidenceLabel("");
                }}
              >
                <PopoverTrigger asChild>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    data-testid="bulk-add-evidence-trigger"
                  >
                    <Plus className="w-3 h-3 mr-1" /> Add evidence req…
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-72 p-3 space-y-2" align="center">
                  <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Evidence label
                  </Label>
                  <Input
                    value={bulkEvidenceLabel}
                    onChange={(e) => setBulkEvidenceLabel(e.target.value)}
                    placeholder="e.g., Driver's GPS log screenshot"
                    className="h-8 text-xs"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleBulkAddEvidence();
                    }}
                    data-testid="bulk-add-evidence-input"
                    autoFocus
                  />
                  <div className="flex items-center justify-end">
                    <Button
                      size="sm"
                      className="h-7 text-xs"
                      onClick={handleBulkAddEvidence}
                      disabled={!bulkEvidenceLabel.trim()}
                      data-testid="bulk-add-evidence-save"
                    >
                      Save
                    </Button>
                  </div>
                </PopoverContent>
              </Popover>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={handleBulkToggleAppliesPerInvoice}
                data-testid="bulk-toggle-applies-per-invoice"
              >
                Toggle "applies per invoice"
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                onClick={() => setSelectedIds(new Set())}
                data-testid="bulk-clear-selection"
              >
                Clear selection
              </Button>
            </Card>
          )}
        </div>

        {findReplaceOpen && (
          <FindReplaceDialog
            open={findReplaceOpen}
            onOpenChange={setFindReplaceOpen}
            currentErrorType={errorType}
            allErrorTypes={errorTypes || []}
          />
        )}

        <LibraryDrawer
          isOpen={libraryDrawerOpen}
          onClose={() => setLibraryDrawerOpen(false)}
          selectedNodeId={selectedId}
          tree={tree}
          onTreeChange={onTreeChange}
        />

        <HistoryDrawer
          isOpen={historyDrawerOpen}
          onClose={() => setHistoryDrawerOpen(false)}
          errorTypeId={errorType.id}
          hasUnsavedChanges={
            // Task #779 — explicit deep equality vs the loaded snapshot
            // for BOTH halves (tree + settings) so the confirmation
            // dialog's "unsaved changes will be lost" warning reflects
            // the actual on-disk vs in-memory state. `dirty` is kept
            // only as a defensive fallback for the brief loading
            // window before `loadedSnapshotRef` is populated.
            loadedSnapshotRef.current
              ? !treesEqual(tree, loadedSnapshotRef.current.tree) ||
                !settingsEqual(settings, loadedSnapshotRef.current.settings)
              : dirty
          }
        />

        <SaveToLibraryDialog
          open={saveToLibrary !== null}
          onOpenChange={(o) => { if (!o) setSaveToLibrary(null); }}
          kind={saveToLibrary?.kind ?? "evidence_requirement"}
          payload={saveToLibrary?.payload ?? null}
          defaultLabel={saveToLibrary?.defaultLabel}
        />

        {/* Right inspector — hidden during multi-select so the bulk
            action bar is the only edit affordance on screen. */}
        {selectedIds.size <= 1 && (
          <div className="w-80 border-l border-border bg-card flex flex-col shrink-0" data-testid="inspector-pane">
            <Inspector
              tree={tree}
              nodeId={selectedId}
              onChange={onTreeChange}
              onSaveEvidenceToLibrary={handleSaveEvidenceToLibrary}
              onSaveSubTreeToLibrary={handleSaveSubTreeToLibrary}
            />
            {selectedNode && dirty && (
              <div className="border-t border-border px-3 py-1.5 text-[10px] text-muted-foreground bg-muted/30 flex items-center gap-1.5">
                <StatusDot tone="amber" />
                Last edit pending save. Press ⌘S to persist.
              </div>
            )}
          </div>
        )}
      </div>

      {/* Bottom status strip — mirrors the dashboard/queue stat row */}
      <div
        className="h-9 px-4 flex items-center gap-3 border-t border-border bg-card text-[11px] text-muted-foreground shrink-0"
        data-testid="sop-editor-status-strip"
      >
        <span className="flex items-center gap-1.5">
          <span className="uppercase tracking-wider text-[10px] font-semibold">Nodes</span>
          <span className="tabular-nums font-medium text-foreground">{tree.nodes.length}</span>
        </span>
        <span className="border-l border-dotted border-border h-3" aria-hidden="true" />
        <span className="flex items-center gap-1.5">
          <span className="uppercase tracking-wider text-[10px] font-semibold">Evidence</span>
          <span className="tabular-nums font-medium text-foreground">
            {tree.nodes.reduce((s, n) => s + (n.evidenceRequirements?.length ?? 0), 0)}
          </span>
        </span>
        <span className="border-l border-dotted border-border h-3" aria-hidden="true" />
        <span className="flex items-center gap-1.5">
          <span className="uppercase tracking-wider text-[10px] font-semibold">Selected</span>
          <span className="tabular-nums font-medium text-foreground">{selectedIds.size || (selectedId ? 1 : 0)}</span>
        </span>
        <div className="flex-1" />
        {dirty ? (
          <span className="flex items-center gap-1.5" data-testid="status-strip-state">
            <StatusDot tone="amber" />
            <span className="uppercase tracking-wider text-[10px] font-semibold">Unsaved draft</span>
          </span>
        ) : (
          <span className="flex items-center gap-1.5" data-testid="status-strip-state">
            <StatusDot tone="green" />
            <span className="uppercase tracking-wider text-[10px] font-semibold">All changes saved</span>
          </span>
        )}
      </div>
    </div>
  );
}
