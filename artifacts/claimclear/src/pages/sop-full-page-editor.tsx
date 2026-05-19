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
      className={`bg-white border-2 rounded-lg shadow-sm w-[220px] ${
        data.selected ? "border-blue-500 ring-2 ring-blue-200" : "border-blue-300"
      }`}
      data-testid={`flow-node-question`}
    >
      <Handle type="target" position={Position.Top} className="!bg-slate-400" />
      <div className="px-2.5 py-1 border-b border-blue-100 flex items-center gap-1.5">
        <HelpCircle className="w-3 h-3 text-blue-600" />
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Question</span>
        {data.evidenceCount ? (
          <span className="ml-auto flex items-center gap-0.5 text-[10px] text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded font-medium">
            <FileText className="w-2.5 h-2.5" /> {data.evidenceCount}
          </span>
        ) : null}
      </div>
      <div className="px-2.5 py-2 text-xs font-medium leading-snug text-foreground line-clamp-3 min-h-[44px]">
        {data.label}
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-slate-400" />
    </div>
  );
}

function OutcomeNodeView({ data }: NodeProps<Node<FlowNodeData>>) {
  const isApprove = data.outcomeType === "portal_dispute" || data.outcomeType === "dispute";
  const isHold = data.outcomeType === "hold";
  const colors = isApprove
    ? "bg-green-50 border-green-400"
    : isHold
      ? "bg-amber-50 border-amber-400"
      : "bg-red-50 border-red-400";
  const Icon = isApprove ? CheckCircle2 : isHold ? FileText : XCircle;
  const iconColor = isApprove ? "text-green-700" : isHold ? "text-amber-700" : "text-red-700";
  return (
    <div className={`border-2 rounded-lg shadow-sm w-[220px] ${colors}`}>
      <Handle type="target" position={Position.Top} className="!bg-slate-400" />
      <div className="px-2.5 py-1 border-b border-current/10 flex items-center gap-1.5">
        <Icon className={`w-3 h-3 ${iconColor}`} />
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Outcome</span>
      </div>
      <div className="px-2.5 py-2 text-xs font-medium leading-snug min-h-[44px]">{data.label}</div>
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
          className="w-5 h-5 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center hover:bg-blue-700 shadow ring-2 ring-white opacity-0 hover:opacity-100 transition-opacity"
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
          className={`w-full text-left flex items-center gap-1.5 px-2 py-1 text-xs rounded ${
            selectedId === id ? "bg-blue-50 ring-1 ring-blue-300 font-medium" : "hover:bg-muted/60"
          }`}
          style={{ paddingLeft: 8 + depth * 14 }}
          data-testid={`outline-row-${id}`}
        >
          <HelpCircle className="w-3 h-3 text-blue-600 shrink-0" />
          {branchLabel && <span className="text-[9px] text-muted-foreground">[{branchLabel}]</span>}
          <span className="truncate text-foreground">{label}</span>
          {(node.evidenceRequirements?.length ?? 0) > 0 && (
            <span className="ml-auto text-[9px] bg-amber-100 text-amber-700 px-1 rounded font-medium">
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
  return (
    <div className="flex flex-col h-full" data-testid="inspector">
      <div className="h-10 px-3 flex items-center gap-2 border-b border-border bg-card">
        <HelpCircle className="w-3.5 h-3.5 text-blue-600" />
        <span className="text-xs font-medium">Question node</span>
        <span className="ml-auto text-[10px] text-muted-foreground font-mono">{node.id.slice(0, 12)}</span>
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
            {node.options.map((opt, idx) => (
              <div key={idx} className="border border-border rounded p-2 space-y-1.5 bg-background">
                <div className="flex items-center gap-1.5">
                  <Input
                    value={opt.label}
                    onChange={(e) => onChange(setOption(tree, node.id, idx, { label: e.target.value }))}
                    className="h-7 text-xs"
                    placeholder="Branch label"
                  />
                </div>
                {opt.childId ? (
                  <div className="text-[10px] text-muted-foreground flex items-center justify-between">
                    <span>→ continues to next question</span>
                    <button
                      className="text-blue-600 hover:underline"
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
                  </div>
                )}
              </div>
            ))}
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
              <div key={idx} className="border border-border rounded p-1.5 bg-background flex items-center gap-1.5">
                <FileText className="w-3 h-3 text-amber-600 shrink-0" />
                <Input
                  value={req.label}
                  onChange={(e) => onChange(setEvidenceReq(tree, node.id, idx, { label: e.target.value }))}
                  className="h-6 text-xs flex-1"
                  placeholder="Evidence name"
                />
                <button
                  className="p-1 hover:bg-muted rounded"
                  onClick={() => onChange(removeEvidenceReq(tree, node.id, idx))}
                  title="Remove"
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
      {/* Top bar */}
      <div className="h-12 px-3 flex items-center gap-2 border-b border-border bg-card shrink-0">
        <Button variant="ghost" size="sm" onClick={() => navigate("/error-types")} data-testid="back-to-error-types">
          <ChevronLeft className="w-4 h-4 mr-1" /> Error Types
        </Button>
        <div className="text-sm">
          <span className="text-muted-foreground">SOP:</span>{" "}
          <span className="font-medium">{errorType.name}</span>
        </div>
        {dirty && (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-800 border border-amber-200">
            Unsaved changes
          </span>
        )}
        <div className="flex-1" />
        <div className="text-[10px] text-muted-foreground">
          {tree.nodes.length} nodes · {tree.nodes.reduce((s, n) => s + (n.evidenceRequirements?.length ?? 0), 0)} evidence reqs
        </div>
        <Button
          size="sm"
          onClick={handleSave}
          disabled={!dirty || saving}
          data-testid="save-tree"
        >
          <Save className="w-3.5 h-3.5 mr-1" /> {saving ? "Saving…" : "Save"}
        </Button>
      </div>

      {/* Three-panel body */}
      <div className="flex-1 flex min-h-0">
        {/* Left panel — outline */}
        <div className="w-72 border-r border-border bg-card flex flex-col shrink-0">
          <div className="flex border-b border-border">
            <button
              onClick={() => setLeftTab("outline")}
              className={`flex-1 flex items-center justify-center gap-1 py-2 text-[11px] font-medium border-b-2 ${
                leftTab === "outline" ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
              data-testid="left-tab-outline"
            >
              <ListTree className="w-3.5 h-3.5" /> Outline
            </button>
            <button
              onClick={() => setLeftTab("ai")}
              className={`flex-1 flex items-center justify-center gap-1 py-2 text-[11px] font-medium border-b-2 ${
                leftTab === "ai" ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
              data-testid="left-tab-ai"
            >
              <Wand2 className="w-3.5 h-3.5" /> AI Builder
            </button>
            <button
              onClick={() => setLeftTab("settings")}
              className={`flex-1 flex items-center justify-center gap-1 py-2 text-[11px] font-medium border-b-2 ${
                leftTab === "settings" ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
              data-testid="left-tab-settings"
            >
              <SettingsIcon className="w-3.5 h-3.5" /> Settings
            </button>
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
        <div className="flex-1 relative min-w-0">
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
            <Background gap={18} />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable />
          </ReactFlow>
        </div>

        {/* Right inspector */}
        <div className="w-80 border-l border-border bg-card flex flex-col shrink-0">
          <Inspector tree={tree} nodeId={selectedId} onChange={onTreeChange} />
          {selectedNode && (
            <div className="border-t border-border p-2 text-[10px] text-muted-foreground bg-muted/30">
              Last edit pending save. Press Save in the top bar to persist.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
