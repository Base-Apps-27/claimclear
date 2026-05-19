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
} from "lucide-react";
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
  return (
    <div className="flex flex-col h-full" data-testid="inspector">
      <div className="h-10 px-3 flex items-center gap-2 border-b border-border bg-card">
        <HelpCircle className="w-3.5 h-3.5 text-blue-600" />
        <span className="text-xs font-medium">Question node</span>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto h-6 px-2 text-[10px]"
          onClick={() => onSaveSubTreeToLibrary(node.id)}
          data-testid="inspector-save-sub-tree-to-library"
          title="Save this node and its descendants to the SOP library"
        >
          <Bookmark className="w-3 h-3 mr-1" /> Save sub-tree
        </Button>
        <span className="text-[10px] text-muted-foreground font-mono">{node.id.slice(0, 12)}</span>
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
                  onClick={() => onSaveEvidenceToLibrary(node.id, idx)}
                  title="Save to library"
                  data-testid={`inspector-save-evidence-to-library-${idx}`}
                >
                  <Bookmark className="w-3 h-3 text-muted-foreground" />
                </button>
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

  const handleSave = async () => {
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
          variant="outline"
          size="sm"
          onClick={() => setHistoryDrawerOpen(true)}
          data-testid="open-history-drawer"
        >
          <History className="w-3.5 h-3.5 mr-1" /> History
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setLibraryDrawerOpen(true)}
          data-testid="open-library-drawer"
        >
          <Library className="w-3.5 h-3.5 mr-1" /> Library
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setFindReplaceOpen(true)}
          data-testid="open-find-replace"
        >
          <Replace className="w-3.5 h-3.5 mr-1" /> Find & Replace
        </Button>
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
              onClick={() => setLeftTab("plaintext")}
              className={`flex-1 flex items-center justify-center gap-1 py-2 text-[11px] font-medium border-b-2 ${
                leftTab === "plaintext" ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
              data-testid="left-tab-plaintext"
            >
              <Type className="w-3.5 h-3.5" /> Plain Text
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
              className="absolute left-1/2 -translate-x-1/2 bottom-4 z-10 px-3 py-2 flex items-center gap-2 shadow-lg border-border"
              data-testid="bulk-action-bar"
            >
              <span className="text-xs font-medium">
                {selectedIds.size} nodes selected
              </span>
              <div className="h-4 w-px bg-border mx-1" />
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
            {selectedNode && (
              <div className="border-t border-border p-2 text-[10px] text-muted-foreground bg-muted/30">
                Last edit pending save. Press Save in the top bar to persist.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
