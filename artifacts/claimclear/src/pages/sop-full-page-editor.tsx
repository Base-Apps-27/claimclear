import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
// Classic JSX runtime fallback (used when tests run without the
// project tsconfig that enables the automatic runtime) needs
// `React` in module scope.
void React;
import { useParams, useLocation, Link } from "wouter";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  useReactFlow,
  type Node,
  type Edge,
  type NodeProps,
  type EdgeProps,
  getBezierPath,
} from "@xyflow/react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import "./sop-full-page-editor-xyflow-styles";
import {
  useListErrorTypes,
  useListEvidenceTypes,
  useListSopLibraryItems,
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
  ChevronDown,
  Copy,
  ClipboardPaste,
  X,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { StatusDot } from "@/components/cohesion";
import { PlainTextEditor } from "@/components/decision-tree/plain-text-editor";
import { FindReplaceDialog } from "./sop-full-page-editor-find-replace";
import { LibraryDrawer, SaveToLibraryDialog } from "./sop-full-page-editor-library";
import { HistoryDrawer } from "./sop-full-page-editor-history";
import {
  extractSubTreeFromEditor,
  treesEqual,
  settingsEqual,
  extractSubtree,
  remapSubtreeIds,
  scrubSubtreeRefs,
  pasteSubtreeIntoOption,
  getEmptyOptionSlots,
  type EmptyOptionSlot,
} from "./sop-full-page-editor-helpers";
import {
  clearClipboard,
  setClipboard,
  useSopClipboard,
} from "./sop-clipboard";
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
  FILENAME_TEMPLATE_VARIABLES,
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
  ingestDocument,
  scanAmbiguity,
  checkCoverage,
  suggestNextQuestion,
  suggestBranchFromClaim,
  type AmbiguityFlag,
  type CoverageReport,
  type SuggestedNextQuestion,
  coerceTree,
  buildSavePayload,
  addEvidenceReqToMany,
  bulkToggleAppliesPerInvoice,
  addOption,
  removeOption,
  deleteNode,
  getOrphanQuestionIds,
  setInstructionImage,
  attachChildQuestion,
  addBranchWithSuggestion,
  getHoverHighlightIds,
  addChildQuestion,
  outcomeTone,
  NODE_W,
  NODE_H,
  type FlowNodeData,
  type CanvasTone,
  type SopEditorSettings,
} from "./sop-full-page-editor-helpers";
import { Card } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { InstructionImageUploader } from "@/components/decision-tree/instruction-image-uploader";

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

function QuestionNodeView({ id, data }: NodeProps<Node<FlowNodeData>>) {
  // Inline rename (Task #818): double-click swaps the title for a
  // textarea bound to the same node-text setter the inspector uses.
  // We dispatch a CustomEvent (matches the existing
  // sop-editor:insert-between idiom) so the node component stays a
  // pure render and the page owns tree state.
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(data.label);
  useEffect(() => {
    if (!editing) setDraft(data.label);
  }, [data.label, editing]);

  const commit = useCallback(() => {
    const next = draft.trim();
    if (next && next !== data.label) {
      window.dispatchEvent(
        new CustomEvent("sop-editor:rename-node", {
          detail: { nodeId: id, text: next },
        }),
      );
    }
    setEditing(false);
  }, [draft, data.label, id]);

  return (
    <div
      className="bg-card rounded-md shadow-sm w-[220px] transition-opacity duration-200"
      style={{
        border: `1px solid hsl(var(--cc-blue-border))`,
        boxShadow: data.selected
          ? `0 0 0 2px hsl(var(--background)), 0 0 0 4px hsl(var(--cc-blue-fg))`
          : undefined,
        opacity: data.dimmed ? 0.25 : 1,
      }}
      data-testid={`flow-node-question`}
      data-node-kind="question"
      data-dimmed={data.dimmed ? "true" : "false"}
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
      {editing ? (
        <textarea
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              commit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              setDraft(data.label);
              setEditing(false);
            }
            e.stopPropagation();
          }}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          className="w-full px-2.5 py-2 text-xs font-medium leading-snug text-card-foreground bg-card border-0 outline-none resize-none min-h-[44px] focus-visible:ring-2 focus-visible:ring-inset"
          style={{ ["--tw-ring-color" as string]: "hsl(var(--cc-blue-border))" }}
          data-testid={`flow-node-rename-input`}
        />
      ) : (
        <div
          className="px-2.5 py-2 text-xs font-medium leading-snug text-card-foreground line-clamp-3 min-h-[44px] cursor-text"
          onDoubleClick={(e) => {
            e.stopPropagation();
            setEditing(true);
          }}
          title="Double-click to rename"
        >
          {data.label}
        </div>
      )}
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
      className="rounded-md shadow-sm w-[220px] transition-opacity duration-200"
      style={{ background: palette.bg, border: `1px solid ${palette.border}`, opacity: data.dimmed ? 0.25 : 1 }}
      data-node-kind="outcome"
      data-dimmed={data.dimmed ? "true" : "false"}
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
}: EdgeProps & { label?: React.ReactNode; data?: { parentId: string; optionIndex: number; tone?: CanvasTone; dimmed?: boolean } }) {
  const [path, labelX, labelY] = getBezierPath({
    sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition,
  });
  const tone: CanvasTone = data?.tone ?? "muted";
  const dimmed = data?.dimmed === true;
  // Tone → CSS var map. Outcome edges get the inspector chip palette
  // (green for approve, amber for hold, red for dead-end) so the
  // shape of a tree's outcomes is legible at a glance (Task #818).
  const strokeVar =
    tone === "blue" ? "--cc-blue-border"
    : tone === "green" ? "--cc-green-border"
    : tone === "amber" ? "--cc-amber-border"
    : tone === "red" ? "--cc-red-border"
    : "--border";
  const labelBgVar =
    tone === "blue" ? "--cc-blue-bg"
    : tone === "green" ? "--cc-green-bg"
    : tone === "amber" ? "--cc-amber-bg"
    : tone === "red" ? "--cc-red-bg"
    : null;
  const labelBorderVar = strokeVar;
  const labelFgVar =
    tone === "blue" ? "--cc-blue-fg"
    : tone === "green" ? "--cc-green-fg"
    : tone === "amber" ? "--cc-amber-fg"
    : tone === "red" ? "--cc-red-fg"
    : null;
  // Long branch labels would overflow the canvas; cap the visible
  // text and rely on the native title tooltip for the full string.
  const labelStr = typeof label === "string" ? label : "";
  const MAX_LABEL = 18;
  const truncated = labelStr.length > MAX_LABEL ? labelStr.slice(0, MAX_LABEL - 1) + "…" : labelStr;
  const labelWidth = Math.min(Math.max(labelStr.length * 6 + 16, 36), 132);
  const onInsert = (e: React.MouseEvent) => {
    e.stopPropagation();
    const evt = new CustomEvent("sop-editor:insert-between", {
      detail: { edgeId: id, parentId: data?.parentId, optionIndex: data?.optionIndex },
    });
    window.dispatchEvent(evt);
  };
  return (
    <>
      <path
        id={id}
        d={path}
        fill="none"
        stroke={`hsl(var(${strokeVar}))`}
        strokeWidth={1.5}
        data-tone={tone}
        data-dimmed={dimmed ? "true" : "false"}
        style={{ opacity: dimmed ? 0.18 : 1, transition: "opacity 200ms" }}
      />
      {label && (
        <foreignObject
          x={labelX - labelWidth / 2}
          y={labelY - 12}
          width={labelWidth}
          height={22}
          style={{ overflow: "visible", opacity: dimmed ? 0.25 : 1, transition: "opacity 200ms" }}
        >
          <div
            className="rounded-full text-[10px] px-1.5 py-0.5 text-center font-medium shadow-sm select-none border truncate"
            style={{
              background: labelBgVar ? `hsl(var(${labelBgVar}))` : "hsl(var(--card))",
              borderColor: `hsl(var(${labelBorderVar}))`,
              color: labelFgVar ? `hsl(var(${labelFgVar}))` : "hsl(var(--muted-foreground))",
              maxWidth: labelWidth,
            }}
            data-tone={tone}
            title={labelStr}
          >
            {truncated}
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

// Task #818 — MiniMap node fill driven by FlowNodeData. Question
// nodes get the inspector blue; outcomes pick up their own tone via
// `outcomeTone`. Keeps the mini-map glanceable when the canvas is
// zoomed out.
function miniMapNodeColor(n: Node): string {
  const d = n.data as FlowNodeData | undefined;
  if (!d) return "hsl(var(--muted-foreground))";
  if (d.kind === "outcome") {
    const tone = outcomeTone(d.outcomeType);
    if (tone === "green") return "hsl(var(--cc-green-fg))";
    if (tone === "amber") return "hsl(var(--cc-amber-fg))";
    if (tone === "red") return "hsl(var(--cc-red-fg))";
    return "hsl(var(--muted-foreground))";
  }
  return "hsl(var(--cc-blue-fg))";
}

// Task #818 — central canvas. Lives inside <ReactFlowProvider> so it
// can use the imperative `setCenter` API for smooth pan/zoom-to
// selection, and owns hover state for the path-on-hover dimming.
// Everything tree-mutating still bubbles up via the parent's
// dispatched CustomEvents / passed callbacks; this component is
// purely the viewport.
type ContextMenuTarget = { id: string; kind: "question" | "outcome" };

function SopCanvas({
  flow,
  selectedIds,
  selectedId,
  setSelectedId,
  toggleSelectedId,
  onContextAction,
  tree,
}: {
  flow: { nodes: Node<FlowNodeData>[]; edges: Edge[] };
  selectedIds: Set<string>;
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  toggleSelectedId: (id: string) => void;
  onContextAction: (
    action: "add" | "delete" | "save" | "copy_tree" | "copy_id",
    target: ContextMenuTarget,
  ) => void;
  tree: DecisionTree;
}) {
  const rootId = tree.rootId;
  const rf = useReactFlow();
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [menuTarget, setMenuTarget] = useState<ContextMenuTarget | null>(null);

  // Decorate flow with hover dimming. Cheap O(n) over nodes/edges —
  // we deliberately avoid re-running dagre because layout is stable.
  const decoratedFlow = useMemo(() => {
    if (!hoveredId) return flow;
    const highlighted = getHoverHighlightIds(tree, hoveredId);
    return {
      nodes: flow.nodes.map((n) => ({
        ...n,
        data: { ...n.data, dimmed: !highlighted.has(n.id) },
      })),
      edges: flow.edges.map((e) => ({
        ...e,
        data: {
          ...(e.data as object),
          dimmed: !(highlighted.has(e.source) && highlighted.has(e.target)),
        },
      })),
    };
  }, [flow, hoveredId, tree]);

  // Smooth pan/zoom to the currently-selected node. Use setCenter so
  // the user keeps spatial context — fitView would yank the whole
  // viewport every time. Skipped for multi-select (selection bar
  // handles that case) and on first paint (the ReactFlow `fitView`
  // prop frames the initial layout).
  //
  // IMPORTANT: depend on the UN-decorated `flow.nodes` (stable across
  // hover changes), not `decoratedFlow.nodes` — otherwise hovering a
  // node would silently re-center the viewport on the selection.
  const firstSelectionRef = useRef(true);
  useEffect(() => {
    if (firstSelectionRef.current) {
      firstSelectionRef.current = false;
      return;
    }
    if (!selectedId || selectedIds.size !== 1) return;
    const node = flow.nodes.find((n) => n.id === selectedId);
    if (!node) return;
    const cx = node.position.x + NODE_W / 2;
    const cy = node.position.y + NODE_H / 2;
    rf.setCenter(cx, cy, { duration: 600, zoom: Math.max(rf.getZoom(), 0.9) });
  }, [selectedId, selectedIds.size, flow.nodes, rf]);

  // Task #818 a11y — keyboard users can focus nodes (xyflow makes
  // them tabbable); when focus moves to a node we mirror the hover
  // path-highlight so the same affordance is available without a
  // mouse. Nodes dispatch this CustomEvent via their wrapper div.
  useEffect(() => {
    const onFocus = (ev: Event) => {
      const detail = (ev as CustomEvent).detail as { nodeId: string | null };
      setHoveredId(detail?.nodeId ?? null);
    };
    window.addEventListener("sop-editor:node-focus", onFocus as EventListener);
    return () => window.removeEventListener("sop-editor:node-focus", onFocus as EventListener);
  }, []);

  // Drag-from-handle to create child. xyflow v12 fires
  // onConnectEnd with the originating node/handle even when the
  // user drops on empty pane. We delegate creation up via a
  // CustomEvent so the parent stays the source of truth for the
  // tree state.
  const onConnectEnd = useCallback((_evt: unknown, conn: { fromNode?: Node | null; toNode?: Node | null; isValid?: boolean | null }) => {
    if (!conn) return;
    if (conn.toNode) return; // landed on a real node — leave linking to a future task
    const from = conn.fromNode;
    if (!from) return;
    const d = from.data as FlowNodeData | undefined;
    if (d?.kind !== "question") return;
    window.dispatchEvent(
      new CustomEvent("sop-editor:add-child", { detail: { parentId: from.id } }),
    );
  }, []);

  return (
    <ContextMenu
      onOpenChange={(open) => {
        if (!open) setMenuTarget(null);
      }}
    >
      <ContextMenuTrigger asChild>
        <div
          className="w-full h-full"
          data-testid="sop-canvas-root"
          // Keyboard a11y: when focus moves into / out of a node
          // wrapper (xyflow makes nodes tabbable), mirror the hover
          // path-highlight by dispatching the same focus event the
          // parent listens for. We use focusin/focusout on the
          // container so we don't have to thread a callback into
          // every node component.
          onFocusCapture={(e) => {
            const t = e.target as HTMLElement;
            const nodeEl = t.closest<HTMLElement>(".react-flow__node");
            const id = nodeEl?.getAttribute("data-id");
            if (id) {
              window.dispatchEvent(
                new CustomEvent("sop-editor:node-focus", { detail: { nodeId: id } }),
              );
            }
          }}
          onBlurCapture={(e) => {
            const next = e.relatedTarget as HTMLElement | null;
            const stillOnNode = next?.closest?.(".react-flow__node");
            if (!stillOnNode) {
              window.dispatchEvent(
                new CustomEvent("sop-editor:node-focus", { detail: { nodeId: null } }),
              );
            }
          }}
        >
          <ReactFlow
            nodes={decoratedFlow.nodes}
            edges={decoratedFlow.edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodeClick={(ev, n) => {
              const data = n.data as FlowNodeData;
              const targetId = data.kind === "outcome"
                ? n.id.split("__term")[0]
                : n.id;
              if (ev.shiftKey && data.kind === "question") toggleSelectedId(targetId);
              else setSelectedId(targetId);
            }}
            onNodeMouseEnter={(_e, n) => setHoveredId(n.id)}
            onNodeMouseLeave={() => setHoveredId(null)}
            onNodeContextMenu={(e, n) => {
              // Resolve outcome → parent question (mirrors onNodeClick).
              const data = n.data as FlowNodeData;
              const targetId = data.kind === "outcome"
                ? n.id.split("__term")[0]
                : n.id;
              setMenuTarget({ id: targetId, kind: data.kind });
              // Don't preventDefault — we want the ContextMenuTrigger
              // wrapper to receive the native event and open the menu.
              e.stopPropagation();
            }}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            proOptions={{ hideAttribution: true }}
            nodesDraggable={false}
            nodesConnectable
            onConnectEnd={onConnectEnd}
            elementsSelectable
          >
            <Background gap={18} />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable nodeColor={miniMapNodeColor} />
          </ReactFlow>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-52" data-testid="sop-canvas-menu">
        <ContextMenuItem
          disabled={!menuTarget || menuTarget.kind !== "question"}
          onSelect={() => menuTarget && onContextAction("add", menuTarget)}
          data-testid="ctx-add-branch"
        >
          Add branch
        </ContextMenuItem>
        <ContextMenuItem
          // Parity with the inspector's Delete: only enabled on a
          // question node that ISN'T the tree root (deleting the root
          // is unsupported and would only surface a toast later).
          disabled={!menuTarget || menuTarget.kind !== "question" || menuTarget.id === rootId}
          onSelect={() => menuTarget && onContextAction("delete", menuTarget)}
          data-testid="ctx-delete"
        >
          Delete
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          disabled={!menuTarget || menuTarget.kind !== "question"}
          onSelect={() => menuTarget && onContextAction("save", menuTarget)}
          data-testid="ctx-save-subtree"
        >
          Save sub-tree to library…
        </ContextMenuItem>
        <ContextMenuItem
          disabled={!menuTarget || menuTarget.kind !== "question"}
          onSelect={() => menuTarget && onContextAction("copy_tree", menuTarget)}
          data-testid="ctx-copy-subtree"
        >
          Copy sub-tree
        </ContextMenuItem>
        <ContextMenuItem
          disabled={!menuTarget}
          onSelect={() => menuTarget && onContextAction("copy_id", menuTarget)}
          data-testid="ctx-copy-id"
        >
          Copy node id
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

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

// Task #817 — per-branch "Suggest next question" affordance.
// Renders a small button on every empty option slot in the Inspector.
// Clicking it asks the model for 1–3 candidate follow-up questions and
// shows them in a popover; picking one calls `onPick` which is wired to
// `attachChildQuestion` so the new question node is created and the
// slot is connected to it.
function InspectorSuggestNextButton({
  parentQuestion,
  optionLabel,
  errorTypeName,
  sourceSopText,
  onPick,
}: {
  parentQuestion: string;
  optionLabel: string;
  errorTypeName?: string;
  sourceSopText?: string;
  onPick: (question: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [candidates, setCandidates] = useState<SuggestedNextQuestion[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const run = async () => {
    setLoading(true);
    setErr(null);
    setCandidates(null);
    try {
      const res = await suggestNextQuestion({
        parentQuestion,
        optionLabel,
        errorTypeName,
        sourceSopText,
      });
      setCandidates(res.candidates || []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next && candidates === null && !loading) void run();
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-[10px] w-full justify-start"
          data-testid="inspector-suggest-next"
        >
          <Sparkles className="w-3 h-3 mr-1" />
          Suggest next question
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="left"
        align="start"
        className="w-72 p-2 space-y-1.5"
        data-testid="inspector-suggest-next-popover"
      >
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
          AI suggestions
        </div>
        {loading && (
          <div className="text-[11px] text-muted-foreground italic">Thinking…</div>
        )}
        {err && (
          <div className="text-[11px] text-destructive">{err}</div>
        )}
        {!loading && !err && candidates && candidates.length === 0 && (
          <div className="text-[11px] text-muted-foreground italic">
            No suggestions.
          </div>
        )}
        {!loading && !err && candidates && candidates.length > 0 && (
          <div className="space-y-1">
            {candidates.map((c, i) => (
              <button
                key={i}
                type="button"
                className="w-full text-left rounded border border-border bg-card hover:bg-muted/40 px-2 py-1.5 text-[11px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                data-testid={`inspector-suggest-next-candidate-${i}`}
                onClick={() => {
                  onPick(c.question);
                  setOpen(false);
                }}
              >
                <div className="font-medium">{c.question}</div>
                {c.rationale && (
                  <div className="text-muted-foreground mt-0.5">{c.rationale}</div>
                )}
              </button>
            ))}
          </div>
        )}
        <div className="flex items-center justify-between pt-1">
          <button
            type="button"
            className="text-[10px] text-muted-foreground hover:underline"
            onClick={() => setOpen(false)}
            data-testid="inspector-suggest-next-dismiss"
          >
            Dismiss
          </button>
          <button
            type="button"
            className="text-[10px] text-primary hover:underline"
            onClick={() => void run()}
            disabled={loading}
          >
            {loading ? "…" : "Retry"}
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function Inspector({
  tree, nodeId, onChange, onSelectNode, onSaveEvidenceToLibrary, onSaveSubTreeToLibrary,
  onCopySubTree, onPasteSubTree, clipboardNodeCount,
  errorTypeName, sourceSopText,
}: {
  tree: DecisionTree;
  nodeId: string | null;
  onChange: (tree: DecisionTree) => void;
  onSelectNode: (id: string | null) => void;
  onSaveEvidenceToLibrary: (nodeId: string, index: number) => void;
  onSaveSubTreeToLibrary: (nodeId: string) => void;
  onCopySubTree: (nodeId: string) => void;
  onPasteSubTree: (parentId: string, optionIndex: number) => void;
  clipboardNodeCount: number | null;
  errorTypeName?: string;
  sourceSopText?: string;
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
  const childBranchCount = node.options.filter((o) => o.childId).length;
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  const performDelete = () => {
    const res = deleteNode(tree, node.id);
    setDeleteConfirmOpen(false);
    if (!res.ok) {
      toast({
        title: "Couldn't delete",
        description:
          res.reason === "root"
            ? "Root step can't be deleted."
            : res.reason === "no_parent"
              ? "Step has no parent to re-parent onto."
              : "Delete failed.",
        variant: "destructive",
      });
      return;
    }
    onChange(res.tree);
    onSelectNode(res.tree.rootId);
  };

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
            onClick={() => onCopySubTree(node.id)}
            disabled={node.id === tree.rootId}
            data-testid="inspector-copy-sub-tree"
            title={
              node.id === tree.rootId
                ? "Copying the root step isn't supported — pick a child step."
                : "Copy this step and its descendants (⌘C)"
            }
            aria-label="Copy sub-tree"
          >
            <Copy className="w-3 h-3 mr-1" /> Copy
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[10px]"
            onClick={() => onSaveSubTreeToLibrary(node.id)}
            data-testid="inspector-save-sub-tree-to-library"
            title="Save this node and its descendants to the SOP library"
            aria-label="Save sub-tree to SOP library"
          >
            <Bookmark className="w-3 h-3 mr-1" /> Save sub-tree
          </Button>
          {node.id !== tree.rootId && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[10px] text-destructive hover:text-destructive"
              onClick={() => {
                if (childBranchCount > 0) setDeleteConfirmOpen(true);
                else performDelete();
              }}
              data-testid="inspector-delete-node"
              title="Delete this question node"
              aria-label="Delete question node"
            >
              <Trash2 className="w-3 h-3 mr-1" /> Delete
            </Button>
          )}
          <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
            <AlertDialogContent data-testid="inspector-delete-node-confirm">
              <AlertDialogHeader>
                <AlertDialogTitle>Delete this step?</AlertDialogTitle>
                <AlertDialogDescription>
                  {childBranchCount > 0
                    ? `This step has ${childBranchCount} child branch${childBranchCount === 1 ? "" : "es"}. They'll be re-parented onto the parent when there's room, otherwise pruned.`
                    : "This step has no children."}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={performDelete}
                  data-testid="inspector-delete-node-confirm-action"
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
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
          <div className="mt-1.5">
            <InstructionImageUploader
              imagePath={node.instructionImagePath}
              imageUrl={node.instructionImageUrl}
              onUploaded={(path) => onChange(setInstructionImage(tree, node.id, path))}
              onRemove={() => onChange(setInstructionImage(tree, node.id, undefined))}
            />
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Branches</Label>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-[10px]"
              onClick={() => onChange(addOption(tree, node.id))}
              data-testid="inspector-add-branch"
              title="Add a new branch"
            >
              <Plus className="w-3 h-3 mr-1" /> Add branch
            </Button>
          </div>
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
                    <button
                      type="button"
                      className="p-1 hover:bg-muted rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => onChange(removeOption(tree, node.id, idx))}
                      title="Delete this branch"
                      aria-label="Delete branch"
                      data-testid={`inspector-remove-branch-${idx}`}
                    >
                      <Trash2 className="w-3 h-3 text-muted-foreground" />
                    </button>
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
                    <div className="space-y-1">
                      {clipboardNodeCount !== null && !opt.outcomeType && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 w-full text-[11px] gap-1"
                          onClick={() => onPasteSubTree(node.id, idx)}
                          data-testid={`inspector-paste-sub-tree-${idx}`}
                          title="Paste the copied sub-tree onto this empty branch (⌘V)"
                        >
                          <ClipboardPaste className="w-3 h-3" />
                          Paste sub-tree ({clipboardNodeCount} node{clipboardNodeCount === 1 ? "" : "s"})
                        </Button>
                      )}
                      <InspectorSuggestNextButton
                        parentQuestion={node.question}
                        optionLabel={opt.label}
                        errorTypeName={errorTypeName}
                        sourceSopText={sourceSopText}
                        onPick={(question) => {
                          const { tree: next, newId } = attachChildQuestion(
                            tree,
                            node.id,
                            idx,
                            question,
                          );
                          if (!newId) return;
                          onChange(next);
                          onSelectNode(newId);
                        }}
                      />
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
                      {/* Re-attach a previously-detached sub-tree by
                          pointing this empty branch at one of the tree's
                          orphan question nodes. Parity with the pre-#780
                          modal editor where Detach was reversible. */}
                      {(() => {
                        const orphans = getOrphanQuestionIds(tree).filter(
                          (id) => id !== node.id,
                        );
                        if (orphans.length === 0) return null;
                        return (
                          <Select
                            value=""
                            onValueChange={(id) => {
                              onChange(
                                setOption(tree, node.id, idx, {
                                  childId: id,
                                  outcomeType: undefined,
                                  outcomeLabel: undefined,
                                }),
                              );
                            }}
                          >
                            <SelectTrigger
                              className="h-7 text-xs bg-card"
                              data-testid={`inspector-reattach-branch-${idx}`}
                            >
                              <SelectValue placeholder="…or re-attach orphan step" />
                            </SelectTrigger>
                            <SelectContent>
                              {orphans.map((id) => {
                                const orphan = tree.nodes.find((n) => n.id === id);
                                const label = (orphan?.question || "(untitled)").slice(0, 48);
                                return (
                                  <SelectItem key={id} value={id} className="text-xs">
                                    {label}
                                  </SelectItem>
                                );
                              })}
                            </SelectContent>
                          </Select>
                        );
                      })()}
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
              <details
                key={idx}
                className="group rounded border focus-within:ring-2 focus-within:ring-offset-0 transition-shadow"
                style={{
                  background: "hsl(var(--cc-amber-bg))",
                  borderColor: "hsl(var(--cc-amber-border))",
                  ["--tw-ring-color" as string]: "hsl(var(--cc-blue-border))",
                }}
                data-testid={`inspector-evidence-${idx}`}
              >
                <summary className="list-none cursor-pointer p-1.5 flex items-center gap-1.5 [&::-webkit-details-marker]:hidden">
                  <ChevronDown
                    className="w-3 h-3 shrink-0 text-muted-foreground -rotate-90 group-open:rotate-0 transition-transform"
                    aria-hidden
                  />
                  <FileText className="w-3 h-3 shrink-0" style={{ color: "hsl(var(--cc-amber-fg))" }} />
                  <Input
                    value={req.label}
                    onChange={(e) => onChange(setEvidenceReq(tree, node.id, idx, { label: e.target.value }))}
                    onClick={(e) => e.stopPropagation()}
                    className="h-6 text-xs flex-1 bg-card"
                    placeholder="Evidence name"
                  />
                  <button
                    type="button"
                    className="p-1 hover:bg-muted rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={(e) => { e.preventDefault(); onSaveEvidenceToLibrary(node.id, idx); }}
                    title="Save to library"
                    aria-label="Save evidence to library"
                    data-testid={`inspector-save-evidence-to-library-${idx}`}
                  >
                    <Bookmark className="w-3 h-3 text-muted-foreground" />
                  </button>
                  <button
                    type="button"
                    className="p-1 hover:bg-muted rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={(e) => { e.preventDefault(); onChange(removeEvidenceReq(tree, node.id, idx)); }}
                    title="Remove"
                    aria-label="Remove evidence requirement"
                    data-testid={`inspector-remove-evidence-${idx}`}
                  >
                    <Trash2 className="w-3 h-3 text-muted-foreground" />
                  </button>
                </summary>
                <div
                  className="px-2 pb-2 pt-1 space-y-2 border-t"
                  style={{ borderColor: "hsl(var(--cc-amber-border))" }}
                >
                  {/* File upload is the default mode for every
                      evidence row (operators attach images, PDFs, or
                      CSV/Excel exports), so we don't expose an
                      "accepts image" toggle — the runner renders the
                      Upload + Paste affordance whenever
                      `acceptsImage !== false`, and we keep that
                      default true. The only meaningful per-row choice
                      is whether the operator can ALSO satisfy the
                      requirement by typing a note (e.g. "brief
                      written explanation"). */}
                  <div className="flex items-center gap-4 flex-wrap">
                    <label className="flex items-center gap-1.5 text-[11px] text-foreground cursor-pointer">
                      <Switch
                        checked={req.required !== false}
                        onCheckedChange={(checked) =>
                          onChange(setEvidenceReq(tree, node.id, idx, { required: checked }))
                        }
                        data-testid={`inspector-evidence-required-${idx}`}
                        aria-label="Required"
                      />
                      <span>Required to advance</span>
                    </label>
                    <label
                      className="flex items-center gap-1.5 text-[11px] text-foreground cursor-pointer"
                      title="Also let the operator satisfy this by typing a note (in addition to uploading)."
                    >
                      <Switch
                        checked={req.acceptsText === true}
                        onCheckedChange={(checked) =>
                          onChange(setEvidenceReq(tree, node.id, idx, { acceptsText: checked }))
                        }
                        data-testid={`inspector-evidence-accepts-text-${idx}`}
                        aria-label="Allow typed note"
                      />
                      <span>Allow typed note</span>
                    </label>
                  </div>
                  {/* Filename template — admin pre-defines the saved
                      file's name so the operator gets a one-click
                      "copy filename" affordance at runtime. Variable
                      chips append a `{token}` to the input so authors
                      don't have to memorize the placeholder syntax.
                      Resolver and supported variables live in
                      `decision-tree/types.ts`. */}
                  <div>
                    <Label
                      htmlFor={`evidence-filename-${idx}`}
                      className="text-[10px] uppercase tracking-wider text-muted-foreground"
                    >
                      Filename template
                    </Label>
                    <Input
                      id={`evidence-filename-${idx}`}
                      value={req.filenameTemplate || ""}
                      onChange={(e) =>
                        onChange(
                          setEvidenceReq(tree, node.id, idx, {
                            filenameTemplate: e.target.value,
                          }),
                        )
                      }
                      placeholder="e.g. Inv_{invoice_number}_EOB_{dos}"
                      className="mt-1 h-6 text-[11px] font-mono bg-card"
                      data-testid={`inspector-evidence-filename-${idx}`}
                    />
                    <div className="mt-1 flex flex-wrap gap-1">
                      {FILENAME_TEMPLATE_VARIABLES.map((v) => (
                        <button
                          key={v.key}
                          type="button"
                          className="px-1.5 py-0.5 text-[10px] font-mono rounded border border-border bg-card hover:bg-muted text-muted-foreground hover:text-foreground"
                          onClick={() =>
                            onChange(
                              setEvidenceReq(tree, node.id, idx, {
                                filenameTemplate: `${req.filenameTemplate || ""}{${v.key}}`,
                              }),
                            )
                          }
                          title={`Insert ${v.label}`}
                          data-testid={`inspector-evidence-filename-var-${idx}-${v.key}`}
                        >
                          {`{${v.key}}`}
                        </button>
                      ))}
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-1">
                      Operator gets a one-click "copy filename" button at runtime. Unknown variables drop out cleanly.
                    </p>
                  </div>
                </div>
              </details>
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
  errorTypeId,
  errorTypeName,
  initialText,
  onTextChange,
  onReplace,
  onApplyRewrite,
  onSelectNode,
}: {
  currentTree: DecisionTree;
  errorTypeId?: number;
  errorTypeName?: string;
  // Task #784 — last-saved plain-text SOP description; rehydrated from
  // the error type so the panel doesn't reset every time the editor
  // remounts. `onTextChange` writes the in-memory text back up so the
  // top-bar Save persists it alongside the tree + settings.
  initialText: string;
  onTextChange: (next: string) => void;
  onReplace: (next: DecisionTree) => void;
  onApplyRewrite: (nodeId: string, nextQuestion: string) => void;
  onSelectNode: (nodeId: string) => void;
}) {
  const [text, setText] = useState(initialText);
  // Keep local text in sync if the parent reloads a different SOP.
  useEffect(() => {
    setText(initialText);
  }, [initialText]);
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

  // Document ingest — PDF/PNG/JPG → extracted text fills the textarea.
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const ingestMutation = useMutation({
    mutationFn: (file: File) => ingestDocument(file),
    onSuccess: (extracted) => {
      setText(extracted);
      onTextChange(extracted);
      toast({
        title: "Document ingested",
        description: "Review the extracted text, then click Generate tree.",
      });
    },
    onError: (e) => {
      toast({
        title: "Ingest failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    },
  });

  // Ambiguity scan — flag unclear question wording.
  const [ambiguityFlags, setAmbiguityFlags] = useState<AmbiguityFlag[] | null>(null);
  const ambiguityMutation = useMutation({
    mutationFn: () => scanAmbiguity({ tree: currentTree, errorTypeName }),
    onSuccess: (flags) => {
      setAmbiguityFlags(flags);
      toast({
        title: flags.length === 0 ? "No ambiguities found" : `Found ${flags.length} flag${flags.length === 1 ? "" : "s"}`,
      });
    },
    onError: (e) => {
      toast({
        title: "Clarity scan failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    },
  });

  // Coverage check — walk recent claims through current tree.
  const [coverage, setCoverage] = useState<CoverageReport | null>(null);
  const coverageMutation = useMutation({
    mutationFn: () => {
      if (!errorTypeId) throw new Error("Save the SOP once before running coverage.");
      return checkCoverage({ errorTypeId, tree: currentTree, sampleSize: 200 });
    },
    onSuccess: (report) => setCoverage(report),
    onError: (e) => {
      toast({
        title: "Coverage check failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    },
  });

  return (
    <div className="flex flex-col h-full p-2 gap-2 overflow-y-auto" data-testid="ai-builder-panel">
      <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
        Describe the workflow
      </Label>
      <Textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          onTextChange(e.target.value);
        }}
        rows={8}
        className="text-xs"
        placeholder={"Paste the SOP in plain English. Example:\n\nFirst check if GPS data is available. If yes, verify the breadcrumbs match pickup and dropoff. If they match, mark ready. Otherwise place on hold."}
        data-testid="ai-builder-text"
        disabled={mutation.isPending || ingestMutation.isPending}
      />
      <div className="flex items-center gap-1.5">
        <Button
          size="sm"
          onClick={handleGenerate}
          disabled={!text.trim() || mutation.isPending}
          data-testid="ai-builder-generate"
          className="gap-1 flex-1"
        >
          {mutation.isPending ? (
            <><Loader2 className="w-3 h-3 animate-spin" /> Generating…</>
          ) : (
            <><Wand2 className="w-3 h-3" /> Generate tree</>
          )}
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf,image/png,image/jpeg"
          className="hidden"
          data-testid="ai-builder-upload-input"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) ingestMutation.mutate(f);
            e.target.value = "";
          }}
        />
        <Button
          size="sm"
          variant="outline"
          className="h-8 gap-1 text-[11px]"
          onClick={() => fileInputRef.current?.click()}
          disabled={ingestMutation.isPending || mutation.isPending}
          data-testid="ai-builder-upload"
          title="Extract text from PDF / image"
        >
          {ingestMutation.isPending ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <FileText className="w-3 h-3" />
          )}
          Upload doc
        </Button>
      </div>
      {(mutation.isPending || ingestMutation.isPending) && (
        <div className="space-y-1.5" data-testid="ai-builder-shimmer">
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-5/6" />
          <Skeleton className="h-3 w-4/6" />
        </div>
      )}
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

      {/* Clarity / ambiguity scan */}
      <div className="border-t border-border pt-2 mt-1 space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Clarity check
          </Label>
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1 text-[11px]"
            onClick={() => ambiguityMutation.mutate()}
            disabled={ambiguityMutation.isPending || currentTree.nodes.length === 0}
            data-testid="ai-builder-scan-ambiguity"
          >
            {ambiguityMutation.isPending ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Sparkles className="w-3 h-3" />
            )}
            Scan
          </Button>
        </div>
        {ambiguityFlags && ambiguityFlags.length > 0 && (
          <div className="space-y-1.5" data-testid="ai-builder-ambiguity-results">
            {ambiguityFlags.map((f, i) => (
              <div
                key={`${f.nodeId}-${i}`}
                className="rounded border border-border bg-card p-2 text-[11px] space-y-1"
                data-testid={`ai-builder-ambiguity-flag-${i}`}
              >
                <div className="flex items-center justify-between gap-1.5">
                  <span
                    className="inline-block px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wider font-semibold"
                    style={{
                      color: f.severity === "high"
                        ? "hsl(var(--cc-red-fg, var(--destructive)))"
                        : f.severity === "medium"
                          ? "hsl(var(--cc-amber-fg))"
                          : "hsl(var(--muted-foreground))",
                      background: f.severity === "high"
                        ? "hsl(var(--cc-red-bg, var(--destructive) / 0.1))"
                        : f.severity === "medium"
                          ? "hsl(var(--cc-amber-bg))"
                          : "hsl(var(--muted))",
                    }}
                  >
                    {f.severity}
                  </span>
                  <button
                    className="text-primary hover:underline"
                    onClick={() => onSelectNode(f.nodeId)}
                    data-testid={`ai-builder-ambiguity-jump-${i}`}
                  >
                    Jump to node →
                  </button>
                </div>
                <div className="text-muted-foreground italic">{f.reason}</div>
                {f.suggestedRewrite && (
                  <div className="space-y-1">
                    <div className="text-foreground">
                      <span className="text-muted-foreground">Suggest:</span> {f.suggestedRewrite}
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 text-[10px] px-2"
                      onClick={() => {
                        onApplyRewrite(f.nodeId, f.suggestedRewrite);
                        setAmbiguityFlags((prev) =>
                          prev ? prev.filter((_, idx) => idx !== i) : prev,
                        );
                      }}
                      data-testid={`ai-builder-ambiguity-apply-${i}`}
                    >
                      Apply rewrite
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        {ambiguityFlags && ambiguityFlags.length === 0 && (
          <p className="text-[10px] text-muted-foreground italic">No ambiguities detected.</p>
        )}
      </div>

      {/* Coverage check against recent claims */}
      <div className="border-t border-border pt-2 mt-1 space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Coverage check
          </Label>
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1 text-[11px]"
            onClick={() => coverageMutation.mutate()}
            disabled={coverageMutation.isPending || !errorTypeId}
            data-testid="ai-builder-coverage-check"
            title={!errorTypeId ? "Save the SOP first" : "Walk the last 200 claims through this tree"}
          >
            {coverageMutation.isPending ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Sparkles className="w-3 h-3" />
            )}
            Check
          </Button>
        </div>
        {coverage && (
          <div className="space-y-1.5 text-[11px]" data-testid="ai-builder-coverage-results">
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground">Checked:</span>
              <span className="font-medium">{coverage.totalChecked}</span>
              <span className="text-muted-foreground">claims</span>
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              <Stat label="Terminated" value={coverage.terminated} tone="green" />
              <Stat label="Abandoned" value={coverage.abandoned} tone="amber" />
              <Stat label="Unmatched" value={coverage.unmatched} tone="red" />
            </div>
            {coverage.unmatchedSamples.length > 0 && (
              <div className="space-y-1.5 mt-1">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Unmatched samples
                </div>
                {coverage.unmatchedSamples.map((s) => (
                  <div
                    key={s.claimId}
                    className="rounded border border-border bg-card p-2 space-y-1"
                    data-testid={`ai-builder-coverage-sample-${s.claimId}`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[10px]">{s.invoiceNumber || `claim #${s.claimId}`}</span>
                      {s.finalNodeId && (
                        <button
                          className="text-primary hover:underline text-[10px]"
                          onClick={() => onSelectNode(s.finalNodeId!)}
                        >
                          Jump →
                        </button>
                      )}
                    </div>
                    <div className="text-muted-foreground italic">
                      At: "{s.finalQuestion || "(unknown)"}"
                    </div>
                    {s.unmatchedAtOption && (
                      <div>
                        <span className="text-muted-foreground">Answered:</span>{" "}
                        <span className="font-medium">"{s.unmatchedAtOption}"</span>
                      </div>
                    )}
                    {s.finalQuestion && s.unmatchedAtOption && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 text-[10px] px-2"
                        data-testid={`ai-builder-coverage-suggest-${s.claimId}`}
                        onClick={async () => {
                          try {
                            const sug = await suggestBranchFromClaim({
                              finalQuestion: s.finalQuestion,
                              unmatchedAnswer: s.unmatchedAtOption!,
                              errorTypeName,
                              sourceSopText: text,
                            });
                            if (!s.finalNodeId) {
                              toast({
                                title: "Can't attach",
                                description: "Final node id missing.",
                                variant: "destructive",
                              });
                              return;
                            }
                            const branchLabel = sug.branchLabel || s.unmatchedAtOption!;
                            const next = sug.nextQuestion
                              ? { nextQuestion: sug.nextQuestion }
                              : {
                                  outcomeType: (sug.outcomeType || "hold") as
                                    | "portal_dispute"
                                    | "hold"
                                    | "cannot_dispute"
                                    | "non_issue"
                                    | "internal",
                                  outcomeLabel:
                                    sug.outcomeLabel || sug.outcomeType || "Hold",
                                };
                            const { tree: nextTree } = addBranchWithSuggestion(
                              currentTree,
                              s.finalNodeId,
                              branchLabel,
                              next,
                            );
                            onReplace(nextTree);
                            onSelectNode(s.finalNodeId);
                            toast({
                              title: "Branch attached",
                              description: sug.nextQuestion
                                ? `Added "${branchLabel}" → "${sug.nextQuestion}"`
                                : `Added "${branchLabel}" → ${sug.outcomeLabel || sug.outcomeType}`,
                            });
                          } catch (e) {
                            toast({
                              title: "Suggest failed",
                              description: e instanceof Error ? e.message : "Unknown error",
                              variant: "destructive",
                            });
                          }
                        }}
                      >
                        Suggest fix
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: "green" | "amber" | "red" }) {
  const fg = tone === "green" ? "--cc-green-fg" : tone === "amber" ? "--cc-amber-fg" : "--destructive";
  const bg = tone === "green" ? "--cc-green-bg" : tone === "amber" ? "--cc-amber-bg" : "--muted";
  return (
    <div
      className="rounded border border-border p-1.5 text-center"
      style={{ background: `hsl(var(${bg}))`, color: `hsl(var(${fg}))` }}
    >
      <div className="text-base font-semibold tabular-nums">{value}</div>
      <div className="text-[9px] uppercase tracking-wider opacity-80">{label}</div>
    </div>
  );
}

// Helper exported for the suggest-next button on Inspector option slots.
// Wraps `suggestNextQuestion` with toast-driven UX and an auto-create
// path: the first candidate is inserted as the next-step question on
// that slot.
export type SuggestNextHandler = (
  parentNodeId: string,
  optionIdx: number,
) => Promise<SuggestedNextQuestion[]>;

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
    sourceSopText: "",
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
      sourceSopText: errorType.sourceSopText || "",
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

  // Task #818 — inline rename. The QuestionNodeView dispatches this
  // event when the user commits a textarea edit. We funnel it through
  // updateNode so it goes through the same validation/dirty path the
  // inspector uses.
  useEffect(() => {
    function handler(ev: Event) {
      const detail = (ev as CustomEvent).detail as { nodeId: string; text: string };
      if (!detail?.nodeId || !detail.text) return;
      setTree((cur) => {
        if (!cur) return cur;
        const next = updateNode(cur, detail.nodeId, { question: detail.text });
        setDirty(true);
        return next;
      });
    }
    window.addEventListener("sop-editor:rename-node", handler as EventListener);
    return () => window.removeEventListener("sop-editor:rename-node", handler as EventListener);
  }, []);

  // Task #818 — drag-from-handle child creation. The canvas's
  // onConnectEnd handler fires this when the user drops a connection
  // onto empty pane; we append a new "New branch" option + question.
  useEffect(() => {
    function handler(ev: Event) {
      const detail = (ev as CustomEvent).detail as { parentId: string };
      if (!detail?.parentId) return;
      setTree((cur) => {
        if (!cur) return cur;
        const { tree: next, newId } = addChildQuestion(cur, detail.parentId);
        if (newId) {
          setSelectedId(newId);
          setDirty(true);
        }
        return next;
      });
    }
    window.addEventListener("sop-editor:add-child", handler as EventListener);
    return () => window.removeEventListener("sop-editor:add-child", handler as EventListener);
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
      } else if (key === "c") {
        // Don't hijack the browser's text-copy gesture when the user
        // has actually selected some text or is focused in an editable
        // field — only treat ⌘C as "copy sub-tree" when the focus is
        // outside any input/textarea/contenteditable AND no text
        // selection exists.
        const target = e.target as HTMLElement | null;
        const inField =
          !!target &&
          (target.tagName === "INPUT" ||
            target.tagName === "TEXTAREA" ||
            (target as HTMLElement).isContentEditable);
        const sel = typeof window !== "undefined" ? window.getSelection?.() : null;
        const hasTextSelection = !!sel && sel.toString().length > 0;
        if (inField || hasTextSelection) return;
        const id = copyPasteRef.current.selectedId;
        if (id) {
          e.preventDefault();
          copyPasteRef.current.copy(id);
        }
      } else if (key === "v") {
        const target = e.target as HTMLElement | null;
        const inField =
          !!target &&
          (target.tagName === "INPUT" ||
            target.tagName === "TEXTAREA" ||
            (target as HTMLElement).isContentEditable);
        if (inField) return;
        if (!copyPasteRef.current.hasClipboard) return;
        e.preventDefault();
        // If a single empty option slot is the natural target (selected
        // node has exactly one empty option), paste straight in.
        // Otherwise open the picker so the user can choose.
        const auto = copyPasteRef.current.autoSlot();
        if (auto) {
          copyPasteRef.current.paste(auto.parentId, auto.optionIndex);
        } else {
          copyPasteRef.current.openPicker();
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Stable ref so the global keydown listener above can call the
  // current copy/paste closures without re-binding on every render.
  const copyPasteRef = useRef<{
    selectedId: string | null;
    hasClipboard: boolean;
    copy: (id: string) => void;
    paste: (parentId: string, optionIndex: number) => void;
    openPicker: () => void;
    autoSlot: () => { parentId: string; optionIndex: number } | null;
  }>({
    selectedId: null,
    hasClipboard: false,
    copy: () => {},
    paste: () => {},
    openPicker: () => {},
    autoSlot: () => null,
  });

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

  // Task #816 — Cross-SOP copy/paste -----------------------------------
  const clipboard = useSopClipboard();
  const [pastePickerOpen, setPastePickerOpen] = useState(false);
  // Load the destination workspace's allowlists so paste-time scrubbing
  // can drop references the destination doesn't have. Both lists are
  // small and already cached for other surfaces, so this is a free
  // read in the common case.
  const { data: evidenceTypesData } = useListEvidenceTypes();
  const { data: sopLibraryItemsData } = useListSopLibraryItems();

  const handleCopySubTree = useCallback(
    (nodeId: string) => {
      if (!tree) return;
      const payload = extractSubtree(tree, nodeId);
      if (!payload) {
        toast({
          title: "Can't copy this step",
          description:
            nodeId === tree.rootId
              ? "Copying the SOP's root step isn't supported. Select a child step instead."
              : "Step not found.",
          variant: "destructive",
        });
        return;
      }
      setClipboard({
        payload,
        nodeCount: payload.nodes.length,
        sourceSopTitle: errorType?.name || "Untitled SOP",
        sourceErrorTypeId: errorType?.id ?? null,
        copiedAt: Date.now(),
      });
      toast({
        title: "Sub-tree copied",
        description: `${payload.nodes.length} step${payload.nodes.length === 1 ? "" : "s"} on the clipboard. Open another SOP and paste onto any empty branch.`,
      });
    },
    [tree, errorType],
  );

  const performPaste = useCallback(
    (parentId: string, optionIndex: number): boolean => {
      if (!tree || !clipboard) return false;
      // Refuse to paste over a non-empty option (childId attached OR a
      // terminal outcome). The Paste UI only renders on empty slots,
      // but guarding here protects future callers (context menu,
      // keyboard fast-path, etc.) from silently clobbering existing
      // branches.
      const targetParent = tree.nodes.find((n) => n.id === parentId);
      const targetOption = targetParent?.options[optionIndex];
      if (!targetParent || !targetOption) {
        toast({
          title: "Can't paste here",
          description: "That branch slot no longer exists. Refresh and try again.",
          variant: "destructive",
        });
        return false;
      }
      if (targetOption.childId || targetOption.outcomeType) {
        toast({
          title: "Can't paste here",
          description: "That branch is already in use. Clear it first, then paste.",
          variant: "destructive",
        });
        return false;
      }
      // Scrub cross-references against the destination workspace's
      // actual lists. evidenceTypeIds are pulled from the global
      // EvidenceType list; sopLibraryItemIds are pulled from the SOP
      // library list. Both lists are loaded into the editor on mount;
      // if a list hasn't resolved yet (undefined), we skip its scrub
      // rather than wiping every reference.
      const evIds: Set<number> | undefined = evidenceTypesData?.evidenceTypes
        ? new Set(evidenceTypesData.evidenceTypes.map((e) => e.id))
        : undefined;
      const libIds: Set<string | number> | undefined = sopLibraryItemsData
        ? new Set<string | number>(sopLibraryItemsData.map((i) => i.id))
        : undefined;
      const { payload: scrubbed, dropped } = scrubSubtreeRefs(
        clipboard.payload,
        { evidenceTypeIds: evIds, sopLibraryItemIds: libIds },
      );
      const remapped = remapSubtreeIds(scrubbed);
      const nextTree = pasteSubtreeIntoOption(tree, parentId, optionIndex, remapped);
      setTree(nextTree);
      setDirty(true);
      setSelectedId(remapped.rootId);
      const droppedParts: string[] = [];
      if (dropped.evidenceTypeIds.length > 0) {
        droppedParts.push(
          `${dropped.evidenceTypeIds.length} evidence type${dropped.evidenceTypeIds.length === 1 ? "" : "s"}`,
        );
      }
      if (dropped.sopLibraryItemIds.length > 0) {
        droppedParts.push(
          `${dropped.sopLibraryItemIds.length} library reference${dropped.sopLibraryItemIds.length === 1 ? "" : "s"}`,
        );
      }
      toast({
        title: "Sub-tree pasted",
        description:
          droppedParts.length > 0
            ? `Inserted ${remapped.nodes.length} step${remapped.nodes.length === 1 ? "" : "s"}. Dropped: ${droppedParts.join(", ")} not available here.`
            : `Inserted ${remapped.nodes.length} step${remapped.nodes.length === 1 ? "" : "s"} onto the selected branch.`,
      });
      // Per spec: the clipboard clears after a successful paste so the
      // next ⌘V doesn't accidentally re-paste the same payload.
      clearClipboard();
      return true;
    },
    [tree, clipboard, setSelectedId],
  );

  const handlePasteSubTree = useCallback(
    (parentId: string, optionIndex: number) => {
      if (!clipboard) {
        toast({
          title: "Clipboard is empty",
          description: "Copy a sub-tree from any SOP first.",
          variant: "destructive",
        });
        return;
      }
      performPaste(parentId, optionIndex);
    },
    [clipboard, performPaste],
  );

  // Empty option slots in the current tree; powers the picker shown
  // when the user hits ⌘V at the root level (no slot selected).
  const emptySlots: EmptyOptionSlot[] = useMemo(
    () => (tree ? getEmptyOptionSlots(tree) : []),
    [tree],
  );

  // Keep the keyboard-shortcut ref in sync with the current closures
  // and selected-id every render. Cheap pointer assignment — no React
  // re-render cost. The ref is read by the window-level keydown
  // listener installed in the ⌘F/⌘S effect above.
  copyPasteRef.current = {
    selectedId,
    hasClipboard: clipboard !== null,
    copy: handleCopySubTree,
    paste: (parentId, optionIndex) => {
      performPaste(parentId, optionIndex);
    },
    openPicker: () => setPastePickerOpen(true),
    autoSlot: () => {
      // If the currently selected node has exactly one empty option
      // slot, return it so ⌘V can fast-path straight into the paste.
      // Otherwise return null and let the picker open.
      if (!tree || !selectedId) return null;
      const node = tree.nodes.find((n) => n.id === selectedId);
      if (!node) return null;
      const empties: Array<{ parentId: string; optionIndex: number }> = [];
      node.options.forEach((o, i) => {
        if (!o.childId && !o.outcomeType) {
          empties.push({ parentId: node.id, optionIndex: i });
        }
      });
      return empties.length === 1 ? empties[0] : null;
    },
  };
  // Task #818 — right-click context menu actions. The canvas only
  // surfaces user intent; all tree mutation, persistence, and toast
  // surfaces still live here so the inspector / outline / canvas stay
  // in lock-step. Sub-tree copy writes JSON to the system clipboard
  // for now; when the cross-SOP paste task lands it will swap this
  // out for a shared in-memory clipboard store.
  const handleCanvasContextAction = useCallback(
    (
      action: "add" | "delete" | "save" | "copy_tree" | "copy_id",
      target: { id: string; kind: "question" | "outcome" },
    ) => {
      if (!tree) return;
      const nodeId = target.id;
      if (action === "add") {
        const { tree: next, newId } = addChildQuestion(tree, nodeId);
        if (!newId) return;
        setTree(next);
        setSelectedId(newId);
        setDirty(true);
        return;
      }
      if (action === "delete") {
        const res = deleteNode(tree, nodeId);
        if (!res.ok) {
          toast({
            title: "Couldn't delete",
            description:
              res.reason === "root"
                ? "Root step can't be deleted."
                : res.reason === "no_parent"
                  ? "Step has no parent to re-parent onto."
                  : "Delete failed.",
            variant: "destructive",
          });
          return;
        }
        setTree(res.tree);
        setSelectedId(res.tree.rootId);
        setDirty(true);
        return;
      }
      if (action === "save") {
        handleSaveSubTreeToLibrary(nodeId);
        return;
      }
      if (action === "copy_tree") {
        const subTree = extractSubTreeFromEditor(tree, nodeId);
        const json = JSON.stringify(subTree);
        void navigator.clipboard?.writeText(json).then(
          () => toast({ title: "Sub-tree copied", description: "JSON copied to clipboard." }),
          () => toast({ title: "Copy failed", variant: "destructive" }),
        );
        return;
      }
      if (action === "copy_id") {
        void navigator.clipboard?.writeText(nodeId).then(
          () => toast({ title: "Node id copied" }),
          () => toast({ title: "Copy failed", variant: "destructive" }),
        );
        return;
      }
    },
    [tree, handleSaveSubTreeToLibrary, toast, setSelectedId],
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
      <div className="h-full w-full flex flex-col bg-background" data-testid="sop-editor-loading">
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
    <div className="h-full w-full flex flex-col bg-background" data-testid="sop-full-page-editor">
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
        {clipboard && (
          <div
            className="h-7 inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-2 text-[10px] text-muted-foreground"
            data-testid="sop-editor-clipboard-chip"
            title={`Copied from "${clipboard.sourceSopTitle}" — paste onto any empty branch (⌘V)`}
          >
            <ClipboardPaste className="w-3 h-3" aria-hidden="true" />
            <span>
              Clipboard: 1 sub-tree ({clipboard.nodeCount} node{clipboard.nodeCount === 1 ? "" : "s"})
            </span>
            <button
              type="button"
              onClick={() => clearClipboard()}
              className="ml-0.5 inline-flex items-center justify-center rounded-full hover:bg-muted/80 p-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              data-testid="sop-editor-clipboard-chip-clear"
              aria-label="Clear sub-tree clipboard"
              title="Clear clipboard"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        )}
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
                  className={`flex-1 inline-flex items-center justify-center gap-1.5 px-2 py-1 rounded-full text-[10px] uppercase tracking-wider font-semibold border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset ${
                    active
                      ? ""
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
                  }`}
                  style={
                    active
                      ? {
                          color: "hsl(var(--cc-blue-fg))",
                          background: "hsl(var(--cc-blue-bg))",
                          borderColor: "hsl(var(--cc-blue-border))",
                        }
                      : {
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
              errorTypeId={errorType.id}
              errorTypeName={errorType.name}
              initialText={settings.sourceSopText}
              onTextChange={(next) => updateSettings({ sourceSopText: next })}
              onReplace={(next) => {
                setTree(next);
                setSelectedId(next.rootId);
                setDirty(true);
                setLeftTab("outline");
              }}
              onApplyRewrite={(nodeId, nextQuestion) => {
                setTree((prev) => (prev ? updateNode(prev, nodeId, { question: nextQuestion }) : prev));
                setSelectedId(nodeId);
                setDirty(true);
              }}
              onSelectNode={(nodeId) => {
                setSelectedId(nodeId);
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
          <ReactFlowProvider>
            <SopCanvas
              flow={flow}
              selectedIds={selectedIds}
              selectedId={selectedId}
              setSelectedId={setSelectedId}
              toggleSelectedId={toggleSelectedId}
              tree={tree}
              onContextAction={handleCanvasContextAction}
            />
          </ReactFlowProvider>

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

        {/* Task #816 — Paste-target picker. Opened by ⌘V when the
            current selection has no obvious single empty slot. Lists
            every empty option in the tree so the user can pick where
            the copied sub-tree should land. */}
        {pastePickerOpen && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 backdrop-blur-sm"
            data-testid="paste-picker-overlay"
            onClick={() => setPastePickerOpen(false)}
          >
            <div
              className="w-[420px] max-h-[70vh] flex flex-col rounded-lg border border-border bg-card shadow-xl"
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-label="Choose paste target"
            >
              <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <div className="flex flex-col">
                  <span className="text-sm font-semibold">Paste sub-tree</span>
                  <span className="text-[11px] text-muted-foreground">
                    Choose an empty branch in this SOP.
                  </span>
                </div>
                <button
                  type="button"
                  className="rounded-full p-1 hover:bg-muted/60"
                  aria-label="Close paste picker"
                  onClick={() => setPastePickerOpen(false)}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="flex-1 overflow-auto p-2">
                {emptySlots.length === 0 ? (
                  <div className="p-4 text-xs text-muted-foreground">
                    No empty branches in this SOP. Every option already has a child or a terminal outcome — clear a slot first, then paste.
                  </div>
                ) : (
                  <ul className="space-y-1" data-testid="paste-picker-list">
                    {emptySlots.map((slot, i) => (
                      <li key={`${slot.parentId}-${slot.optionIndex}-${i}`}>
                        <button
                          type="button"
                          className="w-full text-left rounded-md border border-border hover:bg-muted/40 px-2.5 py-2"
                          data-testid={`paste-picker-slot-${i}`}
                          onClick={() => {
                            const ok = performPaste(slot.parentId, slot.optionIndex);
                            if (ok) setPastePickerOpen(false);
                          }}
                        >
                          <div className="text-[12px] font-medium truncate">{slot.parentQuestion}</div>
                          <div className="text-[10px] text-muted-foreground truncate">
                            → {slot.label}
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Right inspector — hidden during multi-select so the bulk
            action bar is the only edit affordance on screen. */}
        {selectedIds.size <= 1 && (
          <div className="w-80 border-l border-border bg-card flex flex-col shrink-0" data-testid="inspector-pane">
            <Inspector
              tree={tree}
              nodeId={selectedId}
              onChange={onTreeChange}
              onSelectNode={setSelectedId}
              onSaveEvidenceToLibrary={handleSaveEvidenceToLibrary}
              onSaveSubTreeToLibrary={handleSaveSubTreeToLibrary}
              onCopySubTree={handleCopySubTree}
              onPasteSubTree={handlePasteSubTree}
              clipboardNodeCount={clipboard?.nodeCount ?? null}
              errorTypeName={errorType.name}
              sourceSopText={settings.sourceSopText}
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


// Test-only export. Exposes file-local components so the canvas
// component test file can render them in isolation without spinning
// up the full page (which pulls in React Query, wouter, etc).
export const __test = { QuestionNodeView, OutcomeNodeView, InsertableEdge, SopCanvas };
