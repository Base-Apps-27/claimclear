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
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Plus, X, HelpCircle, ChevronDown, ChevronRight,
  FileText, Copy, Play, GitBranch, ArrowRight, Layers,
  Send, Ban, PauseCircle, Mail, Info, Image as ImageIcon,
  Camera, Upload,
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
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Badge variant="outline" className="gap-1"><GitBranch className="h-3 w-3" />{stats.nodes} nodes</Badge>
          <Badge variant="outline" className="gap-1"><ArrowRight className="h-3 w-3" />{stats.paths} paths</Badge>
          <Badge variant="outline" className="gap-1"><Layers className="h-3 w-3" />{stats.depth} levels deep</Badge>
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
      <NodeEditor tree={tree} nodeId={tree.rootId} onChange={onChange} depth={0} />
    </div>
  );
}

function NodeEditor({
  tree,
  nodeId,
  onChange,
  depth,
}: {
  tree: DecisionTree;
  nodeId: string;
  onChange: (tree: DecisionTree) => void;
  depth: number;
}) {
  const [expanded, setExpanded] = useState(depth < 2);
  const [showHelp, setShowHelp] = useState(false);
  const [showEvidence, setShowEvidence] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);
  const node = tree.nodes.find(n => n.id === nodeId);
  if (!node) return null;

  const depthColors = [
    "border-l-blue-400",
    "border-l-green-400",
    "border-l-amber-400",
    "border-l-purple-400",
    "border-l-pink-400",
  ];

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
    updateOption(optIdx, { childId, outcomeType: undefined, outcomeLabel: undefined });
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

  return (
    <Card className={`border-l-4 ${depthColors[depth % depthColors.length]} shadow-sm`}>
      <CardContent className="p-3 space-y-3">
        <div className="flex items-start gap-2">
          <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0 mt-0.5" onClick={() => setExpanded(!expanded)}>
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </Button>
          <div className="flex-1 space-y-1">
            <Input
              value={node.question}
              onChange={e => updateNode({ question: e.target.value })}
              placeholder="What question should staff answer at this step?"
              className="text-sm font-medium"
            />
          </div>
          <div className="flex gap-1 shrink-0">
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setShowHelp(!showHelp)} title="Add help text">
              <HelpCircle className={`h-3.5 w-3.5 ${node.helpText ? "text-blue-500" : ""}`} />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setShowInstructions(!showInstructions)} title="Add instructions & reference image">
              <Info className={`h-3.5 w-3.5 ${node.instructionText || node.instructionImageUrl ? "text-indigo-500" : ""}`} />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setShowEvidence(!showEvidence)} title="Per-node evidence">
              <FileText className={`h-3.5 w-3.5 ${node.evidenceRequirements?.length ? "text-violet-500" : ""}`} />
            </Button>
          </div>
        </div>

        {showHelp && (
          <Textarea
            value={node.helpText || ""}
            onChange={e => updateNode({ helpText: e.target.value || undefined })}
            placeholder="Help text for staff (e.g., 'Check the GPS tab in RouteMaster for breadcrumb data')"
            rows={2}
            className="text-xs"
          />
        )}

        {showInstructions && (
          <div className="bg-indigo-50 dark:bg-indigo-950/20 rounded-md p-2 space-y-2">
            <Label className="text-xs font-medium text-indigo-700">Step-by-step instructions</Label>
            <Textarea
              value={node.instructionText || ""}
              onChange={e => updateNode({ instructionText: e.target.value || undefined })}
              placeholder="Detailed instructions for this step (e.g., 'Navigate to MAS portal > Manage Trips > Search Trip by Invoice...')"
              rows={3}
              className="text-xs"
            />
            <Label className="text-xs font-medium text-indigo-700">Reference image URL (optional)</Label>
            <Input
              value={node.instructionImageUrl || ""}
              onChange={e => updateNode({ instructionImageUrl: e.target.value || undefined })}
              placeholder="/objects/uploads/abc123 or https://..."
              className="text-xs h-7"
            />
          </div>
        )}

        {showEvidence && (
          <div className="bg-violet-50 dark:bg-violet-950/20 rounded-md p-2 space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-medium text-violet-700">Evidence required at this step</Label>
              <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={addEvidenceReq}>
                <Plus className="h-3 w-3 mr-1" />Add
              </Button>
            </div>
            {(node.evidenceRequirements || []).map((req, i) => (
              <div key={req.key} className="space-y-1">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={req.required}
                    onChange={e => updateEvidenceReq(i, { required: e.target.checked })}
                    className="rounded"
                    title="Required?"
                  />
                  <Input
                    value={req.label}
                    onChange={e => updateEvidenceReq(i, { label: e.target.value })}
                    placeholder="Evidence item..."
                    className="text-xs h-7 flex-1"
                  />
                  <label className="flex items-center gap-1 text-[10px] text-muted-foreground cursor-pointer" title="Accepts image upload">
                    <input
                      type="checkbox"
                      checked={req.acceptsImage !== false}
                      onChange={e => updateEvidenceReq(i, { acceptsImage: e.target.checked })}
                      className="rounded h-3 w-3"
                    />
                    <ImageIcon className="h-3 w-3" />
                  </label>
                  <label className="flex items-center gap-1 text-[10px] text-muted-foreground cursor-pointer" title="Accepts text notes">
                    <input
                      type="checkbox"
                      checked={!!req.acceptsText}
                      onChange={e => updateEvidenceReq(i, { acceptsText: e.target.checked })}
                      className="rounded h-3 w-3"
                    />
                    <FileText className="h-3 w-3" />
                  </label>
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => removeEvidenceReq(i)}>
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {expanded && (
          <div className="space-y-2 ml-4">
            {node.options.map((opt, i) => (
              <div key={i} className="space-y-2">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="text-xs shrink-0 min-w-[40px] justify-center">
                    {i + 1}
                  </Badge>
                  <Input
                    value={opt.label}
                    onChange={e => updateOption(i, { label: e.target.value })}
                    placeholder="Answer label"
                    className="text-xs h-7 w-36"
                  />

                  {!opt.childId ? (
                    <div className="flex items-center gap-2 flex-1">
                      <Select
                        value={opt.outcomeType || ""}
                        onValueChange={(val) => {
                          if (val === "sub_question") {
                            addChildNode(i);
                          } else {
                            const ot = val as OutcomeType;
                            updateOption(i, { outcomeType: ot, outcomeLabel: OUTCOME_LABELS[ot] });
                          }
                        }}
                      >
                        <SelectTrigger className="h-7 text-xs w-48">
                          <SelectValue placeholder="Select action..." />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="sub_question">
                            <span className="flex items-center gap-1"><GitBranch className="h-3 w-3" />Add sub-question</span>
                          </SelectItem>
                          <SelectItem value="portal_dispute">
                            <span className="flex items-center gap-1"><Send className="h-3 w-3 text-green-600" />Portal Dispute</span>
                          </SelectItem>
                          <SelectItem value="dispute">
                            <span className="flex items-center gap-1"><Mail className="h-3 w-3 text-blue-600" />Email Dispute</span>
                          </SelectItem>
                          <SelectItem value="internal">
                            <span className="flex items-center gap-1"><Ban className="h-3 w-3 text-red-600" />Resolve Internally</span>
                          </SelectItem>
                          <SelectItem value="hold">
                            <span className="flex items-center gap-1"><PauseCircle className="h-3 w-3 text-amber-600" />Place on Hold</span>
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      {opt.outcomeType && (() => {
                        const colors = OUTCOME_COLORS[opt.outcomeType];
                        const Icon = OUTCOME_ICONS[opt.outcomeType];
                        return (
                          <Badge className={`${colors.bg} ${colors.text} border ${colors.border} text-[10px] gap-1`}>
                            <Icon className="h-3 w-3" />{OUTCOME_LABELS[opt.outcomeType]}
                          </Badge>
                        );
                      })()}
                    </div>
                  ) : (
                    <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" onClick={() => convertToLeaf(i)}>
                      Convert to outcome
                    </Button>
                  )}

                  {node.options.length > 2 && (
                    <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0 text-destructive" onClick={() => removeOption(i)}>
                      <X className="h-3 w-3" />
                    </Button>
                  )}
                </div>

                {opt.childId && (
                  <div className="ml-6">
                    <NodeEditor tree={tree} nodeId={opt.childId} onChange={onChange} depth={depth + 1} />
                  </div>
                )}
              </div>
            ))}

            <Button variant="ghost" size="sm" className="text-xs gap-1 ml-10" onClick={addOption}>
              <Plus className="h-3 w-3" />Add another option
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
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
