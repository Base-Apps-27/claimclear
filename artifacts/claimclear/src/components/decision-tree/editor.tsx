import { useState } from "react";
import {
  type DecisionTree,
  type TreeNode,
  type TreeOption,
  type OutcomeType,
  type EvidenceReq,
  OUTCOME_LABELS,
  OUTCOME_COLORS,
  generateNodeId,
  createEmptyTree,
  getMaxDepth,
  countPaths,
  TEMPLATES,
} from "./types";
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
  Settings, Trash2, GripVertical,
} from "lucide-react";

const OUTCOME_ICONS: Record<OutcomeType, typeof Send> = {
  portal_dispute: Send,
  internal: Ban,
  hold: PauseCircle,
  dispute: Mail,
};

interface TreeEditorProps {
  tree: DecisionTree | null;
  onChange: (tree: DecisionTree | null) => void;
  onTest?: (tree: DecisionTree) => void;
}

export function TreeEditor({ tree, onChange, onTest }: TreeEditorProps) {
  const [showTemplates, setShowTemplates] = useState(false);

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

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between shrink-0 pb-3 border-b border-slate-100">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className="gap-1 text-xs"><GitBranch className="h-3 w-3" />{stats.nodes} nodes</Badge>
          <Badge variant="outline" className="gap-1 text-xs"><ArrowRight className="h-3 w-3" />{stats.paths} paths</Badge>
          <Badge variant="outline" className="gap-1 text-xs"><Layers className="h-3 w-3" />{stats.depth} levels</Badge>
        </div>
        <div className="flex gap-2">
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

      <div className="flex-1 min-h-0 overflow-auto pt-4 -mx-2">
        <div className="inline-flex justify-center w-full min-w-max py-4 px-4 pb-12">
          <FlowNode tree={tree} nodeId={tree.rootId} onChange={onChange} isRoot />
        </div>
      </div>
    </div>
  );
}

function FlowNode({
  tree,
  nodeId,
  onChange,
  isRoot,
}: {
  tree: DecisionTree;
  nodeId: string;
  onChange: (tree: DecisionTree) => void;
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
          ? { ...n, options: n.options.map((o, i) => i === optIdx ? { ...o, childId: undefined, outcomeType: "portal_dispute" as OutcomeType, outcomeLabel: "Submit Portal Dispute" } : o) }
          : n
      ),
    });
  };

  const deleteNode = () => {
    if (isRoot) {
      onChange({ ...tree, nodes: [], rootId: "" });
      return;
    }
    const parentInfo = findParent(tree, nodeId);
    if (!parentInfo) return;
    const { parentNode, optionIndex } = parentInfo;
    let newNodes = removeSubtree(tree.nodes, nodeId);
    newNodes = newNodes.map(n =>
      n.id === parentNode.id
        ? { ...n, options: n.options.map((o, i) => i === optionIndex ? { ...o, childId: undefined } : o) }
        : n
    );
    onChange({ ...tree, nodes: newNodes });
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
      <div className="relative z-10 w-[340px]">
        <Card className="border-slate-200 shadow-sm hover:shadow-md transition-shadow bg-white">
          <CardContent className="p-0">
            <div className="bg-slate-50 border-b border-slate-100 p-2.5 rounded-t-xl flex justify-between items-center">
              <Badge variant="outline" className="bg-white text-slate-500 font-medium font-mono text-[10px] tracking-wider uppercase">
                Q{nodeNumber}
              </Badge>
              <div className="flex items-center gap-0.5">
                <NodeSettingsPopover
                  node={node}
                  updateNode={updateNode}
                  addEvidenceReq={addEvidenceReq}
                  updateEvidenceReq={updateEvidenceReq}
                  removeEvidenceReq={removeEvidenceReq}
                />
                <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-400 hover:text-red-500 hover:bg-red-50" onClick={deleteNode}>
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
                  {(node.instructionText || node.instructionImageUrl) && (
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
                    updateOption(i, { outcomeType: ot, outcomeLabel: OUTCOME_LABELS[ot], childId: undefined });
                  }}
                />

                <div className="w-px h-4 bg-slate-300" />

                {opt.childId ? (
                  <FlowNode tree={tree} nodeId={opt.childId} onChange={onChange} />
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
                <SelectItem value="portal_dispute">
                  <span className="flex items-center gap-1.5"><Send className="h-3 w-3 text-green-600" />Portal Dispute</span>
                </SelectItem>
                <SelectItem value="dispute">
                  <span className="flex items-center gap-1.5"><Mail className="h-3 w-3 text-blue-600" />Email Dispute</span>
                </SelectItem>
                <SelectItem value="internal">
                  <span className="flex items-center gap-1.5"><Ban className="h-3 w-3 text-red-600" />Resolve Internally</span>
                </SelectItem>
                <SelectItem value="hold">
                  <span className="flex items-center gap-1.5"><PauseCircle className="h-3 w-3 text-amber-600" />Place on Hold</span>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
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
  updateNode,
  addEvidenceReq,
  updateEvidenceReq,
  removeEvidenceReq,
}: {
  node: TreeNode;
  updateNode: (updates: Partial<TreeNode>) => void;
  addEvidenceReq: () => void;
  updateEvidenceReq: (idx: number, updates: Partial<EvidenceReq>) => void;
  removeEvidenceReq: (idx: number) => void;
}) {
  const hasContent = !!(node.helpText || node.instructionText || node.instructionImageUrl || (node.evidenceRequirements && node.evidenceRequirements.length > 0));

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
          <Input
            value={node.instructionImageUrl || ""}
            onChange={e => updateNode({ instructionImageUrl: e.target.value || undefined })}
            placeholder="Reference image URL (optional)"
            className="text-xs h-7"
          />
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

          {(node.evidenceRequirements || []).map((req, i) => (
            <div key={req.key} className="border border-slate-200 rounded-md p-2 bg-white space-y-2">
              <div className="flex items-center gap-1.5">
                <GripVertical className="h-3 w-3 text-slate-300 cursor-grab shrink-0" />
                <Input
                  value={req.label}
                  onChange={e => updateEvidenceReq(i, { label: e.target.value })}
                  placeholder="Evidence item..."
                  className="text-xs h-6 flex-1"
                />
                <Button variant="ghost" size="icon" className="h-5 w-5 text-slate-400 hover:text-red-500 shrink-0" onClick={() => removeEvidenceReq(i)}>
                  <X className="h-3 w-3" />
                </Button>
              </div>
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
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function findParent(tree: DecisionTree, nodeId: string): { parentNode: TreeNode; optionIndex: number } | null {
  for (const n of tree.nodes) {
    for (let i = 0; i < n.options.length; i++) {
      if (n.options[i].childId === nodeId) {
        return { parentNode: n, optionIndex: i };
      }
    }
  }
  return null;
}

function removeSubtree(nodes: TreeNode[], rootId: string): TreeNode[] {
  const node = nodes.find(n => n.id === rootId);
  if (!node) return nodes;
  let result = nodes.filter(n => n.id !== rootId);
  for (const opt of node.options) {
    if (opt.childId) {
      result = removeSubtree(result, opt.childId);
    }
  }
  return result;
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
