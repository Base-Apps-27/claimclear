import { useState, useRef, useCallback, useEffect } from "react";
import { ALLOWED_EVIDENCE_TYPES, MAX_EVIDENCE_SIZE, SPREADSHEET_EVIDENCE_TYPES, extractClipboardFiles } from "./evidence-paste";
import { EvidencePasteUpload } from "./evidence-paste-upload";
import { EMAIL_MESSAGE_MAX_BYTES } from "@workspace/api-zod";
import {
  type DecisionTree,
  type TreeNode,
  type TreeOption,
  type OutcomeType,
  type EvidenceReq,
  type OrphanedChild,
  type AppliesPerInvoiceViolation,
  OUTCOME_LABELS,
  OUTCOME_COLORS,
  OUTCOME_AUTHOR_OPTIONS,
  LEGACY_OUTCOME_TYPES,
  generateNodeId,
  createEmptyTree,
  getMaxDepth,
  countPaths,
  findParent,
  removeSubtree,
  getOrphanedChildren,
  findReceivableSlots,
  deleteNodeWithReparent,
  validateAppliesPerInvoice,
  TEMPLATES,
} from "./types";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { toast, successToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Plus, X, HelpCircle, ChevronDown,
  FileText, Play, GitBranch, ArrowRight, Layers,
  Send, Ban, PauseCircle, Mail, Info, Image as ImageIcon,
  Settings, Trash2, GripVertical, Maximize, ZoomIn, ZoomOut, RotateCcw,
  ExternalLink, Loader2,
  XCircle, FileX,
} from "lucide-react";
import {
  CLOSURE_CATEGORIES,
  ROOT_CAUSES_BY_CATEGORY,
} from "@/components/closure/closure-options";

const ZOOM_LEVELS = [0.25, 0.5, 0.75, 1.0];
const DEFAULT_ZOOM = 0.75;

const OUTCOME_ICONS: Record<OutcomeType, typeof Send> = {
  portal_dispute: Send,
  internal: Ban,
  hold: PauseCircle,
  dispute: Mail,
  cannot_dispute: XCircle,
  non_issue: FileX,
};

// Per-author-option visual metadata for the editor's outcome dropdown.
// Tinted icons are author-time chrome only — runtime label/color comes
// from `OUTCOME_LABELS` / `OUTCOME_COLORS`. Keeping this co-located
// with the dropdown JSX (rather than inlining tone classes per item)
// makes it trivial to add a new author option later: extend
// `OUTCOME_AUTHOR_OPTIONS` and add an entry here.
const OUTCOME_AUTHOR_META: Record<OutcomeType, { icon: typeof Send; iconClass: string }> = {
  portal_dispute: { icon: Send, iconClass: "text-green-600" },
  dispute: { icon: Mail, iconClass: "text-blue-600" },
  internal: { icon: Ban, iconClass: "text-red-600" },
  hold: { icon: PauseCircle, iconClass: "text-amber-600" },
  cannot_dispute: { icon: XCircle, iconClass: "text-orange-600" },
  non_issue: { icon: FileX, iconClass: "text-slate-600" },
};

interface TreeEditorProps {
  tree: DecisionTree | null;
  onChange: (tree: DecisionTree | null) => void;
  onTest?: (tree: DecisionTree) => void;
}

export interface ReparentRequest {
  nodeId: string;
  question: string;
  orphans: OrphanedChild[];
  parent: TreeNode | null;
  receivableSlots: number[];
  blockReason: "no_parent" | "no_available_slot" | null;
}

export function TreeEditor({ tree, onChange, onTest }: TreeEditorProps) {
  const [showTemplates, setShowTemplates] = useState(false);
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [reparentReq, setReparentReq] = useState<ReparentRequest | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const treeIdRef = useRef<string | null>(null);

  // Restore the editor's "selection" after an undo by scrolling the
  // previously-deleted node back into view (the editor doesn't track a
  // selected-node concept, so this is the closest equivalent).
  const focusNodeAfterUndo = useCallback((nodeId: string) => {
    requestAnimationFrame(() => {
      const el = scrollRef.current?.querySelector(`[data-node-id="${nodeId}"]`);
      if (el && "scrollIntoView" in el) {
        (el as HTMLElement).scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
      }
    });
  }, []);

  const showUndoToast = useCallback(
    (prevTree: DecisionTree, deletedNodeId: string, reparentedCount: number) => {
      const description = reparentedCount > 0
        ? `Re-attached ${reparentedCount} ${reparentedCount === 1 ? "branch" : "branches"} to the parent question.`
        : "The empty question was removed from the tree.";
      const t = successToast({
        title: "__VERB__",
        description,
        duration: 15000,
        action: (
          <ToastAction
            altText="Undo delete"
            data-testid="sop-delete-undo-btn"
            onClick={() => {
              onChange(prevTree);
              focusNodeAfterUndo(deletedNodeId);
              t.dismiss();
            }}
          >
            Undo
          </ToastAction>
        ),
      });
    },
    [onChange, focusNodeAfterUndo],
  );

  const requestDelete = useCallback(
    (nodeId: string) => {
      if (!tree) return;
      if (nodeId === tree.rootId) {
        toast({
          title: "Can't delete the root question",
          description:
            'The root question is the entry point of the tree. Use the "Clear" button above to remove the entire tree.',
          variant: "destructive",
        });
        return;
      }
      const orphans = getOrphanedChildren(tree, nodeId);
      if (orphans.length === 0) {
        // Leaf delete — apply immediately and offer undo.
        const result = deleteNodeWithReparent(tree, nodeId);
        if (!result.ok) return;
        const prev = tree;
        onChange(result.tree);
        showUndoToast(prev, nodeId, 0);
        return;
      }
      // Has orphans — open the re-parent dialog.
      const parentInfo = findParent(tree, nodeId);
      const parent = parentInfo?.parentNode ?? null;
      const slots = parent ? findReceivableSlots(parent, nodeId) : [];
      const node = tree.nodes.find(n => n.id === nodeId);
      const blockReason: ReparentRequest["blockReason"] = !parent
        ? "no_parent"
        : slots.length < orphans.length
          ? "no_available_slot"
          : null;
      setReparentReq({
        nodeId,
        question: node?.question || "(empty question)",
        orphans,
        parent,
        receivableSlots: slots,
        blockReason,
      });
    },
    [tree, onChange, showUndoToast],
  );

  const confirmReparent = useCallback(() => {
    if (!tree || !reparentReq || reparentReq.blockReason) return;
    const result = deleteNodeWithReparent(tree, reparentReq.nodeId);
    if (!result.ok) return;
    const prev = tree;
    const reparentedCount = reparentReq.orphans.length;
    const deletedId = reparentReq.nodeId;
    setReparentReq(null);
    onChange(result.tree);
    showUndoToast(prev, deletedId, reparentedCount);
  }, [tree, reparentReq, onChange, showUndoToast]);

  const centerTree = useCallback((instant?: boolean) => {
    const container = scrollRef.current;
    if (!container) return;
    const inner = container.firstElementChild as HTMLElement;
    if (!inner) return;
    container.scrollTo({
      left: (inner.scrollWidth - container.clientWidth) / 2,
      top: 0,
      behavior: instant ? "instant" : "smooth",
    });
  }, []);

  useEffect(() => {
    if (tree && tree.rootId !== treeIdRef.current) {
      treeIdRef.current = tree.rootId;
      requestAnimationFrame(() => centerTree(true));
    }
  }, [tree, centerTree]);

  const zoomIn = () => {
    const idx = ZOOM_LEVELS.indexOf(zoom);
    if (idx < ZOOM_LEVELS.length - 1) setZoom(ZOOM_LEVELS[idx + 1]);
  };
  const zoomOut = () => {
    const idx = ZOOM_LEVELS.indexOf(zoom);
    if (idx > 0) setZoom(ZOOM_LEVELS[idx - 1]);
  };
  const resetZoom = () => setZoom(DEFAULT_ZOOM);

  if (!tree) {
    return (
      <div className="space-y-4">
        <div className="border-2 border-dashed rounded-lg p-6 text-center space-y-4">
          <GitBranch className="h-10 w-10 text-muted-foreground mx-auto" />
          <div>
            <p className="text-sm font-medium">No decision tree configured</p>
            <p className="text-xs text-muted-foreground mt-1">Build a guided workflow for staff to follow when handling this error type</p>
          </div>
          <div className="flex flex-col items-center gap-2">
            <Button onClick={() => onChange(createEmptyTree())} className="gap-2">
              <Plus className="h-4 w-4" />Build from Scratch
            </Button>
            <Button variant="outline" onClick={() => setShowTemplates(!showTemplates)} className="gap-2">
              <Layers className="h-4 w-4" />Start from Template
            </Button>
          </div>
        </div>
        {showTemplates && (
          <div className="grid grid-cols-2 gap-2">
            {Object.entries(TEMPLATES).map(([key, tmpl]) => (
              <Button
                key={key}
                variant="outline"
                className="h-auto py-3 px-4 text-left justify-start"
                onClick={() => { onChange(tmpl.tree); setShowTemplates(false); }}
              >
                <div>
                  <p className="text-sm font-medium">{tmpl.name}</p>
                  <p className="text-xs text-muted-foreground">{countPaths(tmpl.tree)} paths, {getMaxDepth(tmpl.tree)} levels</p>
                </div>
              </Button>
            ))}
          </div>
        )}
      </div>
    );
  }

  const stats = { paths: countPaths(tree), depth: getMaxDepth(tree), nodes: tree.nodes.length };
  const zoomPct = Math.round(zoom * 100);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className="gap-1 text-xs"><GitBranch className="h-3 w-3" />{stats.nodes} nodes</Badge>
          <Badge variant="outline" className="gap-1 text-xs"><ArrowRight className="h-3 w-3" />{stats.paths} paths</Badge>
          <Badge variant="outline" className="gap-1 text-xs"><Layers className="h-3 w-3" />{stats.depth} levels</Badge>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="sm" onClick={() => centerTree()} className="gap-1" title="Center tree">
            <Maximize className="h-3 w-3" />Center
          </Button>
          {onTest && (
            <Button variant="outline" size="sm" onClick={() => onTest(tree)} className="gap-1">
              <Play className="h-3 w-3" />Test
            </Button>
          )}
          <Button variant="ghost" size="sm" className="text-destructive" onClick={() => onChange(null)}>
            <X className="h-3 w-3 mr-1" />Clear
          </Button>
        </div>
      </div>

      <div className="relative rounded-lg border border-slate-200 bg-slate-50/50 overflow-hidden" style={{ height: "50vh" }}>
        <div
          ref={scrollRef}
          className="absolute inset-0 overflow-auto"
        >
          <div
            className="inline-flex min-w-full justify-center py-6 px-8 pb-16"
            style={{ transform: `scale(${zoom})`, transformOrigin: "top center", minWidth: "max-content" }}
          >
            <FlowNode tree={tree} nodeId={tree.rootId} onChange={onChange} onRequestDelete={requestDelete} isRoot />
          </div>
        </div>

        <div className="absolute bottom-3 right-3 flex items-center gap-1 bg-white/90 backdrop-blur-sm border border-slate-200 rounded-lg p-1 shadow-sm z-10">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={zoomOut} disabled={zoom <= ZOOM_LEVELS[0]} title="Zoom out">
            <ZoomOut className="h-3.5 w-3.5" />
          </Button>
          <button onClick={resetZoom} className="text-[11px] font-mono text-slate-500 hover:text-slate-700 w-10 text-center" title="Reset zoom">
            {zoomPct}%
          </button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={zoomIn} disabled={zoom >= ZOOM_LEVELS[ZOOM_LEVELS.length - 1]} title="Zoom in">
            <ZoomIn className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <ReparentDialog
        request={reparentReq}
        onCancel={() => setReparentReq(null)}
        onConfirm={confirmReparent}
      />
    </div>
  );
}

// Exported for editor.test.tsx — tests render `ReparentDialogBody`
// directly with a constructed `request` to assert the dialog content
// + Confirm gating without going through Radix Portal (the project's
// test pattern uses renderToStaticMarkup, which doesn't materialize
// portaled content).
export function ReparentDialogBody({
  request,
  onCancel,
  onConfirm,
}: {
  request: ReparentRequest;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const blocked = request.blockReason !== null;
  return (
    <div data-testid="sop-reparent-dialog" className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-col space-y-1.5 text-center sm:text-left">
        <h2 className="text-lg font-semibold leading-none tracking-tight">Re-parent children before deleting?</h2>
        <p className="text-sm text-muted-foreground break-words">
          {`"${request.question}" has ${request.orphans.length} ${request.orphans.length === 1 ? "branch" : "branches"} underneath it.`}
          {" "}The rest of the tree below stays intact — we'll just attach those branches to the parent question.
        </p>
      </div>

      <div className="-mx-1 mt-3 flex-1 min-h-0 space-y-3 overflow-y-auto px-1 py-1">
        <div className="rounded-md border bg-slate-50 p-3 space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Branches that will move</p>
          <ul className="space-y-1.5" data-testid="sop-reparent-orphan-list">
            {request.orphans.map((o) => (
              <li key={o.childId} className="flex items-start justify-between gap-3 text-xs">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-slate-700 break-words [overflow-wrap:anywhere] line-clamp-3">
                    <span className="text-slate-400">{o.optionLabel} →</span> {o.childQuestion || "(empty question)"}
                  </p>
                </div>
                <Badge variant="outline" className="shrink-0 text-[10px]">
                  {o.descendantCount} {o.descendantCount === 1 ? "node" : "nodes"}
                </Badge>
              </li>
            ))}
          </ul>
        </div>

        {blocked && request.blockReason === "no_parent" && (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 break-words" data-testid="sop-reparent-blocked-no-parent">
            This question has no parent in the tree, so its children have nowhere to attach. To remove it, first add an alternate path or use Clear to remove the whole tree.
          </div>
        )}

        {blocked && request.blockReason === "no_available_slot" && (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 break-words" data-testid="sop-reparent-blocked-no-slot">
            The parent question doesn't have enough open option slots to receive {request.orphans.length} {request.orphans.length === 1 ? "branch" : "branches"} ({request.receivableSlots.length} available). Add more options to the parent first, or remove one of the branches before deleting.
          </div>
        )}

        {!blocked && request.parent && (
          <div className="rounded-md border bg-white p-3 space-y-1.5">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">New parent</p>
            <p className="text-xs font-medium text-slate-700 break-words [overflow-wrap:anywhere] line-clamp-4">{request.parent.question || "(empty question)"}</p>
            <p className="text-[11px] text-slate-500 break-words">
              Filling option {request.receivableSlots.slice(0, request.orphans.length).map(i => `"${request.parent!.options[i]?.label ?? `#${i + 1}`}"`).join(", ")}
            </p>
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-col-reverse gap-2 border-t pt-3 sm:flex-row sm:justify-end sm:gap-0 sm:space-x-2">
        <Button variant="outline" onClick={onCancel} data-testid="sop-reparent-cancel-btn">
          Cancel
        </Button>
        <Button
          onClick={onConfirm}
          disabled={blocked}
          data-testid="sop-reparent-confirm-btn"
        >
          Attach to parent &amp; delete
        </Button>
      </div>
    </div>
  );
}

// Editor-facing wrapper: gates the body behind a Radix Dialog and
// wires open-state to the presence of a `request`. Tests render
// `ReparentDialogBody` directly to avoid the Radix Portal (which
// renderToStaticMarkup doesn't materialize).
function ReparentDialog({
  request,
  onCancel,
  onConfirm,
}: {
  request: ReparentRequest | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={request !== null} onOpenChange={(next) => { if (!next) onCancel(); }}>
      <DialogContent className="flex max-h-[85vh] w-[calc(100vw-2rem)] max-w-lg flex-col gap-0 overflow-hidden p-4 sm:p-6">
        {request && (
          <ReparentDialogBody request={request} onCancel={onCancel} onConfirm={onConfirm} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function FlowNode({
  tree,
  nodeId,
  onChange,
  onRequestDelete,
  isRoot,
}: {
  tree: DecisionTree;
  nodeId: string;
  onChange: (tree: DecisionTree) => void;
  onRequestDelete: (nodeId: string) => void;
  isRoot?: boolean;
}) {
  const node = tree.nodes.find(n => n.id === nodeId);
  if (!node) return null;

  const updateNode = (updates: Partial<TreeNode>) => {
    onChange({
      ...tree,
      nodes: tree.nodes.map(n => n.id === nodeId ? { ...n, ...updates } : n),
    });
  };

  const updateOption = (optIdx: number, updates: Partial<TreeOption>) => {
    const newOptions = [...node.options];
    newOptions[optIdx] = { ...newOptions[optIdx], ...updates };
    updateNode({ options: newOptions });
  };

  const addOption = () => {
    updateNode({
      options: [...node.options, { label: `Option ${node.options.length + 1}` }],
    });
  };

  const removeOption = (optIdx: number) => {
    const opt = node.options[optIdx];
    let newNodes = tree.nodes;
    if (opt.childId) {
      newNodes = removeSubtree(newNodes, opt.childId);
    }
    const newOptions = node.options.filter((_, i) => i !== optIdx);
    onChange({
      ...tree,
      nodes: newNodes.map(n => n.id === nodeId ? { ...n, options: newOptions } : n),
    });
  };

  const addChildNode = (optIdx: number) => {
    const childId = generateNodeId();
    const newNode: TreeNode = {
      id: childId,
      question: "",
      options: [{ label: "Yes" }, { label: "No" }],
    };
    onChange({
      ...tree,
      nodes: [...tree.nodes.map(n =>
        n.id === nodeId
          ? { ...n, options: n.options.map((o, i) => i === optIdx ? { ...o, childId, outcomeType: undefined, outcomeLabel: undefined } : o) }
          : n
      ), newNode],
    });
  };

  const convertToLeaf = (optIdx: number) => {
    const opt = node.options[optIdx];
    let newNodes = tree.nodes;
    if (opt.childId) {
      newNodes = removeSubtree(newNodes, opt.childId);
    }
    onChange({
      ...tree,
      nodes: newNodes.map(n =>
        n.id === nodeId
          ? { ...n, options: n.options.map((o, i) => i === optIdx ? { ...o, childId: undefined, outcomeType: "portal_dispute" as OutcomeType, outcomeLabel: OUTCOME_LABELS["portal_dispute"] } : o) }
          : n
      ),
    });
  };

  const deleteNode = () => {
    onRequestDelete(nodeId);
  };

  const addEvidenceReq = () => {
    const reqs = node.evidenceRequirements || [];
    updateNode({
      evidenceRequirements: [...reqs, { key: `ev_${Date.now()}`, label: "", required: true }],
    });
  };

  const updateEvidenceReq = (idx: number, updates: Partial<EvidenceReq>) => {
    const reqs = [...(node.evidenceRequirements || [])];
    reqs[idx] = { ...reqs[idx], ...updates };
    updateNode({ evidenceRequirements: reqs });
  };

  const removeEvidenceReq = (idx: number) => {
    updateNode({
      evidenceRequirements: (node.evidenceRequirements || []).filter((_, i) => i !== idx),
    });
  };

  const nodeNumber = tree.nodes.findIndex(n => n.id === nodeId) + 1;

  return (
    <div className="flex flex-col items-center">
      <div className="relative z-10 w-[340px]" data-node-id={nodeId}>
        <Card className="border-slate-200 shadow-sm hover:shadow-md transition-shadow bg-white">
          <CardContent className="p-0">
            <div className="bg-slate-50 border-b border-slate-100 p-2.5 rounded-t-xl flex justify-between items-center">
              <Badge variant="outline" className="bg-white text-slate-500 font-medium font-mono text-[10px] tracking-wider uppercase">
                Q{nodeNumber}
              </Badge>
              <div className="flex items-center gap-0.5">
                <NodeSettingsPopover
                  node={node}
                  tree={tree}
                  updateNode={updateNode}
                  addEvidenceReq={addEvidenceReq}
                  updateEvidenceReq={updateEvidenceReq}
                  removeEvidenceReq={removeEvidenceReq}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-slate-400 hover:text-red-500 hover:bg-red-50"
                  onClick={deleteNode}
                  data-testid={`sop-delete-node-btn-${nodeId}`}
                  title={isRoot ? "Cannot delete root question" : "Delete this question"}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            <div className="p-4 space-y-3">
              <Textarea
                value={node.question}
                onChange={e => updateNode({ question: e.target.value })}
                className="text-sm font-medium text-slate-800 resize-none min-h-[50px] border-transparent hover:border-slate-200 focus-visible:border-slate-300 focus-visible:ring-0 p-1 -m-1 shadow-none"
                placeholder="Enter question here..."
              />

              {(node.helpText || (node.evidenceRequirements && node.evidenceRequirements.length > 0)) && (
                <div className="flex flex-wrap gap-1.5">
                  {node.helpText && (
                    <Badge variant="secondary" className="bg-slate-100 text-slate-600 font-normal text-[10px] cursor-help">
                      <HelpCircle className="h-2.5 w-2.5 mr-1" /> Help text
                    </Badge>
                  )}
                  {node.evidenceRequirements && node.evidenceRequirements.length > 0 && (
                    <Badge variant="secondary" className="bg-violet-50 text-violet-700 border-violet-200 font-normal text-[10px]">
                      <FileText className="h-2.5 w-2.5 mr-1" /> {node.evidenceRequirements.length} evidence
                    </Badge>
                  )}
                  {(node.instructionText || node.instructionImageUrl || node.instructionImagePath || node.instructionLinkUrl) && (
                    <Badge variant="secondary" className="bg-indigo-50 text-indigo-700 border-indigo-200 font-normal text-[10px]">
                      <Info className="h-2.5 w-2.5 mr-1" /> Instructions
                    </Badge>
                  )}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="w-px h-6 bg-slate-300" />

      <div className="flex justify-center relative">
        {node.options.length > 1 && (
          <div
            className="absolute top-0 h-px bg-slate-300"
            style={{
              left: `${100 / (node.options.length * 2)}%`,
              right: `${100 / (node.options.length * 2)}%`,
            }}
          />
        )}

        {node.options.map((opt, i) => {
          const isFirst = i === 0;
          const isLast = i === node.options.length - 1;

          return (
            <div key={i} className="flex flex-col items-center relative px-4">
              {node.options.length > 1 && (
                <div
                  className="absolute top-0 h-px bg-slate-300"
                  style={{
                    left: isFirst ? '50%' : 0,
                    width: isFirst || isLast ? '50%' : '100%',
                  }}
                />
              )}

              <div className="relative z-10 flex flex-col items-center">
                <div className="w-px h-4 bg-slate-300" />

                <OptionPill
                  opt={opt}
                  node={node}
                  optionIndex={i}
                  canRemove={node.options.length > 2}
                  onChange={onChange}
                  tree={tree}
                  updateOption={(updates) => updateOption(i, updates)}
                  removeOption={() => removeOption(i)}
                  addChildNode={() => addChildNode(i)}
                  convertToLeaf={() => convertToLeaf(i)}
                  setOutcome={(ot: OutcomeType) => {
                    const isClosure = ot === "cannot_dispute" || ot === "non_issue";
                    updateOption(i, {
                      outcomeType: ot,
                      outcomeLabel: OUTCOME_LABELS[ot],
                      childId: undefined,
                      // Clear closure fields when switching away from closure outcomes
                      closureCategory: isClosure ? opt.closureCategory : undefined,
                      closureRootCause: isClosure ? opt.closureRootCause : undefined,
                    });
                  }}
                />

                <div className="w-px h-4 bg-slate-300" />

                {opt.childId ? (
                  <FlowNode tree={tree} nodeId={opt.childId} onChange={onChange} onRequestDelete={onRequestDelete} />
                ) : opt.outcomeType ? (
                  <OutcomeTerminal outcomeType={opt.outcomeType} outcomeLabel={opt.outcomeLabel} />
                ) : (
                  <button
                    className="border-2 border-dashed border-slate-200 text-slate-400 hover:text-slate-600 hover:border-slate-300 rounded-lg px-3 py-2 text-xs flex items-center gap-1 bg-slate-50/50 transition-colors"
                    onClick={() => addChildNode(i)}
                  >
                    <Plus className="h-3 w-3" /> Add Step
                  </button>
                )}
              </div>
            </div>
          );
        })}

        <div className="flex flex-col items-center justify-start pl-3 pt-0">
          <div className="w-px h-4 bg-transparent" />
          <Button
            variant="outline"
            size="sm"
            className="h-6 text-[10px] rounded-full border-dashed bg-white text-slate-400 hover:text-slate-700 hover:border-slate-400 shadow-sm px-2"
            onClick={addOption}
          >
            <Plus className="h-2.5 w-2.5 mr-0.5" /> Option
          </Button>
        </div>
      </div>
    </div>
  );
}

function OptionPill({
  opt,
  node,
  optionIndex,
  canRemove,
  tree,
  onChange,
  updateOption,
  removeOption,
  addChildNode,
  convertToLeaf,
  setOutcome,
}: {
  opt: TreeOption;
  node: TreeNode;
  optionIndex: number;
  canRemove: boolean;
  tree: DecisionTree;
  onChange: (tree: DecisionTree) => void;
  updateOption: (updates: Partial<TreeOption>) => void;
  removeOption: () => void;
  addChildNode: () => void;
  convertToLeaf: () => void;
  setOutcome: (ot: OutcomeType) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="group flex items-center bg-white border border-slate-200 hover:border-blue-400 shadow-sm rounded-full pl-3 pr-2 py-1 text-xs font-medium text-slate-700 transition-colors max-w-[200px]">
          <span className="truncate">{opt.label}</span>
          <ChevronDown className="h-3 w-3 ml-1.5 text-slate-400 group-hover:text-blue-500 shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-60 p-3" align="center">
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-slate-500">Option Label</Label>
            <Input
              value={opt.label}
              onChange={e => updateOption({ label: e.target.value })}
              className="h-7 text-xs"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-slate-500">Action / Next Step</Label>
            <Select
              value={opt.childId ? "sub_question" : opt.outcomeType || ""}
              onValueChange={(val) => {
                if (val === "sub_question") {
                  if (!opt.childId) addChildNode();
                } else {
                  setOutcome(val as OutcomeType);
                }
              }}
            >
              <SelectTrigger className="h-7 text-xs">
                <SelectValue placeholder="Select action..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sub_question">
                  <span className="flex items-center gap-1.5"><GitBranch className="h-3 w-3" />Ask sub-question</span>
                </SelectItem>
                {OUTCOME_AUTHOR_OPTIONS.map((ot) => {
                  const meta = OUTCOME_AUTHOR_META[ot];
                  const Icon = meta.icon;
                  return (
                    <SelectItem key={ot} value={ot} data-testid={`option-outcome-${ot}`}>
                      <span className="flex items-center gap-1.5"><Icon className={`h-3 w-3 ${meta.iconClass}`} />{OUTCOME_LABELS[ot]}</span>
                    </SelectItem>
                  );
                })}
                {/*
                  Legacy compat (Task #309): when this option already
                  stores a legacy `outcomeType`, surface it tagged
                  "(legacy)" so the editor can display the current value.
                  Once the operator switches to a non-legacy value, this
                  item disappears on the next render — that's the
                  "switch away, never into" rule from the task spec.
                */}
                {opt.outcomeType && LEGACY_OUTCOME_TYPES.has(opt.outcomeType) && (() => {
                  const meta = OUTCOME_AUTHOR_META[opt.outcomeType] ?? OUTCOME_AUTHOR_META.portal_dispute;
                  const Icon = meta.icon;
                  return (
                    <SelectItem
                      key={`legacy-${opt.outcomeType}`}
                      value={opt.outcomeType}
                      data-testid={`option-outcome-legacy-${opt.outcomeType}`}
                    >
                      <span className="flex items-center gap-1.5">
                        <Icon className={`h-3 w-3 ${meta.iconClass}`} />
                        {OUTCOME_LABELS[opt.outcomeType]}
                        <span className="text-[10px] text-muted-foreground ml-1">(legacy)</span>
                      </span>
                    </SelectItem>
                  );
                })()}
              </SelectContent>
            </Select>
          </div>
          {(opt.outcomeType === "cannot_dispute" || opt.outcomeType === "non_issue") && (
            <>
              <div className="space-y-1.5">
                <Label className="text-xs text-slate-500">Default Closure Category</Label>
                <Select
                  value={opt.closureCategory ?? ""}
                  onValueChange={(val) =>
                    updateOption({ closureCategory: val, closureRootCause: undefined })
                  }
                >
                  <SelectTrigger className="h-7 text-xs">
                    <SelectValue placeholder="(Ask user at runtime)" />
                  </SelectTrigger>
                  <SelectContent>
                    {CLOSURE_CATEGORIES.map((c) => (
                      <SelectItem key={c.value} value={c.value} className="text-xs">
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-slate-500">Default Root Cause</Label>
                <Select
                  value={opt.closureRootCause ?? ""}
                  onValueChange={(val) => updateOption({ closureRootCause: val })}
                  disabled={!opt.closureCategory}
                >
                  <SelectTrigger className="h-7 text-xs">
                    <SelectValue placeholder={opt.closureCategory ? "(Ask user at runtime)" : "Pick category first"} />
                  </SelectTrigger>
                  <SelectContent>
                    {(opt.closureCategory ? ROOT_CAUSES_BY_CATEGORY[opt.closureCategory] ?? [] : []).map((rc) => (
                      <SelectItem key={rc.value} value={rc.value} className="text-xs">
                        {rc.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </>
          )}
          {opt.childId && (
            <Button variant="ghost" size="sm" className="w-full h-7 text-xs text-slate-500 hover:text-red-600 justify-start" onClick={convertToLeaf}>
              Convert to outcome
            </Button>
          )}
          {canRemove && (
            <Button variant="ghost" size="sm" className="w-full h-7 text-xs text-red-600 hover:text-red-700 hover:bg-red-50 justify-start" onClick={removeOption}>
              <Trash2 className="h-3 w-3 mr-1.5" /> Remove Option
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function OutcomeTerminal({ outcomeType, outcomeLabel }: { outcomeType: OutcomeType; outcomeLabel?: string }) {
  const colors = OUTCOME_COLORS[outcomeType];
  const Icon = OUTCOME_ICONS[outcomeType];

  return (
    <div className="flex flex-col items-center">
      <div className="h-1.5 w-1.5 rounded-full border-2 border-slate-300 bg-white mb-1.5" />
      <div className={`px-3 py-2.5 rounded-xl border flex flex-col items-center text-center w-[170px] shadow-sm ${colors.bg} ${colors.border}`}>
        <div className={`h-8 w-8 rounded-full flex items-center justify-center mb-1.5 ${colors.bg} border ${colors.border}`}>
          <Icon className={`h-4 w-4 ${colors.text}`} />
        </div>
        <span className={`text-[9px] font-bold ${colors.text} uppercase tracking-wider mb-0.5`}>
          {outcomeType.replace('_', ' ')}
        </span>
        <span className="text-[11px] text-slate-700 font-medium leading-snug">
          {outcomeLabel || OUTCOME_LABELS[outcomeType]}
        </span>
      </div>
    </div>
  );
}

function NodeSettingsPopover({
  node,
  tree,
  updateNode,
  addEvidenceReq,
  updateEvidenceReq,
  removeEvidenceReq,
}: {
  node: TreeNode;
  tree: DecisionTree;
  updateNode: (updates: Partial<TreeNode>) => void;
  addEvidenceReq: () => void;
  updateEvidenceReq: (idx: number, updates: Partial<EvidenceReq>) => void;
  removeEvidenceReq: (idx: number) => void;
}) {
  const hasContent = !!(node.helpText || node.instructionText || node.instructionImageUrl || node.instructionImagePath || node.instructionLinkUrl || (node.evidenceRequirements && node.evidenceRequirements.length > 0));

  // Task #470 — derive author-time violations for THIS node only. The
  // shared `validateAppliesPerInvoice` walks the whole tree; we filter
  // its output to the popover's node so the inline error matches what
  // the operator sees on screen. The error-types save handler runs the
  // same validator across the whole tree before persisting.
  const violations: AppliesPerInvoiceViolation[] = validateAppliesPerInvoice(tree).filter(
    (v) => v.nodeId === node.id,
  );

  // Task #470 (review follow-up) — independently compute whether this node
  // has any disqualifying conflict regardless of the current toggle value,
  // so the switch is *visibly disabled* before the operator tries to
  // enable it. `validateAppliesPerInvoice` only returns rows when
  // `appliesPerInvoice === true`, so we mirror its rules here against the
  // raw node + immediate children.
  const hasBulkConflict = (() => {
    if ((node.evidenceRequirements?.length ?? 0) > 0) return true;
    if (node.requiresPerLegContext === true) return true;
    for (const opt of node.options) {
      if (!opt.childId) continue;
      const child = tree.nodes.find((n) => n.id === opt.childId);
      if (!child) continue;
      if ((child.evidenceRequirements?.length ?? 0) > 0) return true;
      if (child.requiresPerLegContext === true) return true;
    }
    return false;
  })();
  // Allow turning the switch OFF when it's already on (so authors can
  // recover from a tree imported with conflicts), but disable enabling.
  const appliesPerInvoiceDisabled = hasBulkConflict && !node.appliesPerInvoice;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={`h-7 w-7 ${hasContent ? "text-blue-500 bg-blue-50 hover:bg-blue-100" : "text-slate-400 hover:text-slate-600"}`}
        >
          <Settings className="h-3.5 w-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0 max-h-[400px] overflow-y-auto" align="end">
        <div className="p-3 border-b border-slate-100 bg-slate-50">
          <p className="text-xs font-semibold text-slate-700">Node Settings</p>
        </div>

        <div className="p-3 border-b border-slate-100 space-y-2">
          <div className="flex items-center gap-1.5">
            <HelpCircle className="h-3.5 w-3.5 text-slate-400" />
            <Label className="text-xs font-medium text-slate-600">Help Text</Label>
          </div>
          <Textarea
            value={node.helpText || ""}
            onChange={e => updateNode({ helpText: e.target.value || undefined })}
            placeholder="Help text shown to staff as a tooltip..."
            rows={2}
            className="text-xs"
          />
        </div>

        <div className="p-3 border-b border-slate-100 space-y-2">
          <div className="flex items-center gap-1.5">
            <Info className="h-3.5 w-3.5 text-slate-400" />
            <Label className="text-xs font-medium text-slate-600">Instructions</Label>
          </div>
          <Textarea
            value={node.instructionText || ""}
            onChange={e => updateNode({ instructionText: e.target.value || undefined })}
            placeholder="Step-by-step instructions for staff..."
            rows={3}
            className="text-xs"
          />

          <div className="space-y-1.5">
            <Label className="text-[10px] text-slate-500 flex items-center gap-1">
              <ImageIcon className="h-3 w-3" /> Reference Image
            </Label>
            <InstructionImageUploader
              imagePath={node.instructionImagePath}
              imageUrl={node.instructionImageUrl}
              onUploaded={(path) => updateNode({ instructionImagePath: path, instructionImageUrl: undefined })}
              onRemove={() => updateNode({ instructionImagePath: undefined, instructionImageUrl: undefined })}
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-[10px] text-slate-500 flex items-center gap-1">
              <ExternalLink className="h-3 w-3" /> Reference Link
            </Label>
            <Input
              value={node.instructionLinkUrl || ""}
              onChange={e => updateNode({ instructionLinkUrl: e.target.value || undefined })}
              placeholder="https://example.com/reference-page"
              className="text-xs h-7"
            />
            <Input
              value={node.instructionLinkLabel || ""}
              onChange={e => updateNode({ instructionLinkLabel: e.target.value || undefined })}
              placeholder="Link label (e.g. View MAS Portal Guide)"
              className="text-xs h-7"
            />
          </div>
        </div>

        <div className="p-3 border-b border-slate-100 space-y-2" data-testid="sop-bulk-eligibility-section">
          <div className="flex items-center gap-1.5">
            <Layers className="h-3.5 w-3.5 text-slate-400" />
            <Label className="text-xs font-medium text-slate-600">Per-invoice behavior</Label>
          </div>
          <div className="flex items-start gap-2">
            <Switch
              checked={!!node.appliesPerInvoice}
              onCheckedChange={(checked) => updateNode({ appliesPerInvoice: checked || undefined })}
              disabled={appliesPerInvoiceDisabled}
              className="scale-[0.7] mt-0.5"
              data-testid="sop-applies-per-invoice-toggle"
              aria-disabled={appliesPerInvoiceDisabled || undefined}
              title={appliesPerInvoiceDisabled
                ? "Disabled: this step or its immediate next step requires evidence or per-leg context."
                : undefined}
            />
            <div className="space-y-0.5">
              <p className="text-[11px] font-medium text-slate-700">Same answer for every leg</p>
              <p className="text-[10px] text-slate-500">
                When checked, the operator can apply this answer to every matching leg in the
                invoice in one click. Cannot be combined with evidence or per-leg context — on
                this step or the immediate next step.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <Switch
              checked={!!node.requiresPerLegContext}
              onCheckedChange={(checked) => updateNode({ requiresPerLegContext: checked || undefined })}
              className="scale-[0.7] mt-0.5"
              data-testid="sop-requires-per-leg-context-toggle"
            />
            <div className="space-y-0.5">
              <p className="text-[11px] font-medium text-slate-700">Needs per-leg context</p>
              <p className="text-[10px] text-slate-500">
                Marks this step as requiring unique per-leg input (a note, attestation, etc.).
                Blocks bulk advance from any parent step that points here.
              </p>
            </div>
          </div>
          {violations.length > 0 && (
            <div
              className="rounded-md border border-red-200 bg-red-50 p-2 text-[10px] text-red-700"
              data-testid="sop-applies-per-invoice-error"
            >
              <p className="font-medium mb-0.5">"Same answer for every leg" can't be enabled here:</p>
              <ul className="list-disc pl-4 space-y-0.5">
                {violations.map((v, i) => (
                  <li key={`${v.reason}-${i}`}>
                    {v.reason === "node_has_evidence" && "This step collects evidence."}
                    {v.reason === "node_requires_per_leg_context" && "This step requires per-leg context."}
                    {v.reason === "child_has_evidence" && "The next step collects evidence."}
                    {v.reason === "child_requires_per_leg_context" && "The next step requires per-leg context."}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <FileText className="h-3.5 w-3.5 text-slate-400" />
              <Label className="text-xs font-medium text-slate-600">Evidence Requirements</Label>
            </div>
            <Button variant="ghost" size="sm" className="h-6 text-xs text-blue-600" onClick={addEvidenceReq}>
              <Plus className="h-3 w-3 mr-1" />Add
            </Button>
          </div>

          {(node.evidenceRequirements || []).length === 0 && (
            <p className="text-[10px] text-slate-400 text-center py-2">No evidence required at this step</p>
          )}

          {(node.evidenceRequirements || []).map((req, i) => {
            // Task #706 — block save when label is empty. The label is the
            // human-readable name persisted as `claim_evidence.evidence_type_name`
            // for every row collected against this requirement; an empty
            // label would silently regress to the opaque `ev_<digits>` key.
            const labelEmpty = !req.label || !req.label.trim();
            return (
            <div key={req.key} className="border border-slate-200 rounded-md p-2 bg-white space-y-2">
              <div className="flex items-center gap-1.5">
                <GripVertical className="h-3 w-3 text-slate-300 cursor-grab shrink-0" />
                <Input
                  value={req.label}
                  onChange={e => updateEvidenceReq(i, { label: e.target.value })}
                  placeholder="Evidence item..."
                  className={`text-xs h-6 flex-1 ${labelEmpty ? "border-red-400 focus-visible:ring-red-300" : ""}`}
                  data-node-id={node.id}
                  data-evidence-index={i}
                  data-testid={`sop-evidence-label-${node.id}-${i}`}
                  aria-invalid={labelEmpty || undefined}
                />
                <Button variant="ghost" size="icon" className="h-5 w-5 text-slate-400 hover:text-red-500 shrink-0" onClick={() => removeEvidenceReq(i)}>
                  <X className="h-3 w-3" />
                </Button>
              </div>
              {labelEmpty && (
                <p
                  className="text-[10px] text-red-600 pl-4"
                  data-testid={`sop-evidence-label-error-${node.id}-${i}`}
                >
                  Give this evidence a name — staff will see it on the claim.
                </p>
              )}
              <div className="flex items-center gap-3 text-[10px] pl-4">
                <div className="flex items-center gap-1">
                  <Switch
                    checked={req.required}
                    onCheckedChange={checked => updateEvidenceReq(i, { required: checked })}
                    className="scale-[0.6]"
                  />
                  <span className="text-slate-500">Required</span>
                </div>
                <div className="flex items-center gap-1">
                  <Switch
                    checked={req.acceptsImage !== false}
                    onCheckedChange={checked => updateEvidenceReq(i, { acceptsImage: checked })}
                    className="scale-[0.6]"
                  />
                  <ImageIcon className="h-2.5 w-2.5 text-slate-400" />
                </div>
                <div className="flex items-center gap-1">
                  <Switch
                    checked={!!req.acceptsText}
                    onCheckedChange={checked => updateEvidenceReq(i, { acceptsText: checked })}
                    className="scale-[0.6]"
                  />
                  <FileText className="h-2.5 w-2.5 text-slate-400" />
                </div>
              </div>
            </div>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// Exported for editor.test.tsx.
export function InstructionImageUploader({
  imagePath,
  imageUrl,
  onUploaded,
  onRemove,
}: {
  imagePath?: string;
  imageUrl?: string;
  onUploaded: (path: string) => void;
  onRemove: () => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  const MAX_IMG_SIZE = EMAIL_MESSAGE_MAX_BYTES;
  const handleFile = useCallback(async (file: File) => {
    if (!ALLOWED_EVIDENCE_TYPES.has(file.type) || file.type === "application/pdf") return;
    if (SPREADSHEET_EVIDENCE_TYPES.has(file.type)) return;
    if (file.size > MAX_IMG_SIZE) return;
    setPreview(URL.createObjectURL(file));
    setUploading(true);
    try {
      const uploadRes = await fetch("/api/storage/uploads", {
        method: "PUT",
        headers: {
          "Content-Type": file.type,
          "x-upload-name": file.name,
        },
        credentials: "include",
        body: file,
      });
      if (!uploadRes.ok) throw new Error("Upload failed");
      const { objectPath } = await uploadRes.json();
      onUploaded(objectPath);
    } catch {
      setPreview(null);
    } finally {
      setUploading(false);
    }
  }, [onUploaded]);

  const currentSrc = preview
    || (imagePath?.startsWith("/objects/") ? `/api/storage${imagePath}` : imagePath)
    || (imageUrl?.startsWith("/objects/") ? `/api/storage${imageUrl}` : imageUrl)
    || null;

  if (currentSrc) {
    return (
      <div className="relative group">
        <img src={currentSrc} alt="Instruction reference" className="rounded border max-h-28 w-auto" />
        {uploading && (
          <div className="absolute inset-0 bg-white/60 flex items-center justify-center rounded">
            <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
          </div>
        )}
        {!uploading && (
          <button
            onClick={() => { setPreview(null); onRemove(); }}
            className="absolute top-1 right-1 bg-red-500 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      className="flex gap-2"
      tabIndex={0}
      onPaste={(e) =>
        extractClipboardFiles(e.clipboardData, { acceptPdf: false }).forEach(handleFile)
      }
      data-testid="instruction-image-paste-zone"
    >
      <EvidencePasteUpload
        onFile={handleFile}
        acceptPdf={false}
        testIdPrefix="instruction-image"
        uploadLabels={{ empty: "Upload", more: "Replace" }}
      />
    </div>
  );
}

export function TreePreview({ tree }: { tree: DecisionTree }) {
  return (
    <div className="bg-muted/30 rounded-lg p-3 space-y-1">
      <p className="text-xs font-medium text-muted-foreground mb-2">Tree Preview</p>
      <PreviewNode tree={tree} nodeId={tree.rootId} depth={0} />
    </div>
  );
}

function PreviewNode({ tree, nodeId, depth }: { tree: DecisionTree; nodeId: string; depth: number }) {
  const node = tree.nodes.find(n => n.id === nodeId);
  if (!node) return null;

  return (
    <div className="space-y-0.5" style={{ marginLeft: depth * 16 }}>
      <p className="text-xs font-medium truncate">
        {node.question || "(empty question)"}
      </p>
      {node.options.map((opt, i) => (
        <div key={i}>
          {opt.childId ? (
            <div>
              <p className="text-[10px] text-muted-foreground">
                {opt.label} <ArrowRight className="h-2.5 w-2.5 inline" />
              </p>
              <PreviewNode tree={tree} nodeId={opt.childId} depth={depth + 1} />
            </div>
          ) : opt.outcomeType ? (
            <p className="text-[10px]">
              <span className="text-muted-foreground">{opt.label} <ArrowRight className="h-2.5 w-2.5 inline" /></span>{" "}
              <span className={OUTCOME_COLORS[opt.outcomeType].text}>{OUTCOME_LABELS[opt.outcomeType]}</span>
            </p>
          ) : (
            <p className="text-[10px] text-muted-foreground">{opt.label} <ArrowRight className="h-2.5 w-2.5 inline" /> (not configured)</p>
          )}
        </div>
      ))}
    </div>
  );
}

export { type TreeEditorProps };
