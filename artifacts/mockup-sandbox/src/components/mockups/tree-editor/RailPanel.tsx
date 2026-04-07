import React, { useState } from "react";
import {
  ChevronRight,
  ChevronDown,
  GitBranch,
  Circle,
  FileText,
  HelpCircle,
  Plus,
  Trash2,
  Image as ImageIcon,
  Send,
  Ban,
  PauseCircle,
  Mail,
  ArrowRight,
  Settings,
  LayoutTemplate
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";

type OutcomeType = "portal_dispute" | "internal" | "hold" | "dispute";

interface EvidenceReq {
  key: string;
  label: string;
  required: boolean;
  acceptsImage?: boolean;
  acceptsText?: boolean;
}

interface TreeOption {
  label: string;
  childId?: string;
  outcomeType?: OutcomeType;
  outcomeLabel?: string;
}

interface TreeNode {
  id: string;
  question: string;
  helpText?: string;
  instructionText?: string;
  instructionImageUrl?: string;
  options: TreeOption[];
  evidenceRequirements?: EvidenceReq[];
}

interface DecisionTree {
  nodes: TreeNode[];
  rootId: string;
}

const OUTCOME_LABELS: Record<OutcomeType, string> = {
  portal_dispute: "Submit Portal Dispute",
  dispute: "Send Dispute Email",
  internal: "Resolve Internally",
  hold: "Place on Hold",
};

const OUTCOME_COLORS: Record<OutcomeType, { bg: string; text: string; border: string }> = {
  portal_dispute: { bg: "bg-emerald-50 dark:bg-emerald-500/10", text: "text-emerald-700 dark:text-emerald-400", border: "border-emerald-200 dark:border-emerald-800" },
  dispute: { bg: "bg-[#3478F6]/10 dark:bg-[#3478F6]/20", text: "text-[#3478F6] dark:text-[#3478F6]", border: "border-[#3478F6]/20 dark:border-[#3478F6]/30" },
  internal: { bg: "bg-red-50 dark:bg-red-500/10", text: "text-red-700 dark:text-red-400", border: "border-red-200 dark:border-red-800" },
  hold: { bg: "bg-[#E85D3A]/10 dark:bg-[#E85D3A]/20", text: "text-[#E85D3A] dark:text-[#E85D3A]", border: "border-[#E85D3A]/20 dark:border-[#E85D3A]/30" },
};

const OUTCOME_ICONS: Record<OutcomeType, React.ElementType> = {
  portal_dispute: Send,
  internal: Ban,
  hold: PauseCircle,
  dispute: Mail,
};

const SAMPLE_TREE: DecisionTree = {
  rootId: "q1",
  nodes: [
    {
      id: "q1",
      question: "Was the trip completed before MAS cancelled it?",
      helpText: "Check dispatch history for cancellation timestamp vs completion time",
      options: [
        { label: "Yes, trip was completed", childId: "q2" },
        { label: "No, trip was not completed", outcomeType: "internal", outcomeLabel: "No basis for correction" },
      ],
    },
    {
      id: "q2",
      question: "Can completion be verified by GPS, signature, and timestamps?",
      helpText: "All three pieces of evidence required",
      evidenceRequirements: [
        { key: "gps", label: "GPS Screenshot", required: true, acceptsImage: true },
        { key: "receipt", label: "Signed Member Receipt", required: true, acceptsImage: true },
        { key: "portal", label: "MAS Portal Screenshot", required: true, acceptsImage: true },
      ],
      options: [
        { label: "Yes, all evidence available", childId: "q3" },
        { label: "No, missing documentation", outcomeType: "hold", outcomeLabel: "Request additional docs" },
      ],
    },
    {
      id: "q3",
      question: "Did MAS cancel after drop-off was finalized?",
      options: [
        { label: "Yes, cancelled after completion", childId: "q4" },
        { label: "No, cancelled before completion", outcomeType: "internal", outcomeLabel: "Not correctable" },
      ],
    },
    {
      id: "q4",
      question: "Is Correction Request available in MAS portal?",
      helpText: "Check Manage Trips > Search by Invoice. Ensure within 30-day deadline.",
      options: [
        { label: "Yes, available", outcomeType: "portal_dispute", outcomeLabel: "Submit correction via MAS portal" },
        { label: "No, not available", outcomeType: "dispute", outcomeLabel: "Email correction request with evidence" },
      ],
    },
  ],
};

function countPaths(tree: DecisionTree, nodeId?: string): number {
  const node = tree.nodes.find(n => n.id === (nodeId || tree.rootId));
  if (!node) return 0;
  let count = 0;
  for (const opt of node.options) {
    if (opt.childId) {
      count += countPaths(tree, opt.childId);
    } else {
      count += 1;
    }
  }
  return count;
}

function getMaxDepth(tree: DecisionTree, nodeId?: string, depth = 0): number {
  const node = tree.nodes.find(n => n.id === (nodeId || tree.rootId));
  if (!node) return depth;
  let max = depth;
  for (const opt of node.options) {
    if (opt.childId) {
      max = Math.max(max, getMaxDepth(tree, opt.childId, depth + 1));
    } else {
      max = Math.max(max, depth + 1);
    }
  }
  return max;
}

export function RailPanel() {
  const [tree, setTree] = useState<DecisionTree>(SAMPLE_TREE);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(SAMPLE_TREE.rootId);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set(["q1", "q2", "q3", "q4"]));

  const stats = { paths: countPaths(tree), depth: getMaxDepth(tree), nodes: tree.nodes.length };

  const toggleExpand = (id: string) => {
    setExpandedNodes(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const updateNode = (id: string, updates: Partial<TreeNode>) => {
    setTree({
      ...tree,
      nodes: tree.nodes.map(n => n.id === id ? { ...n, ...updates } : n),
    });
  };

  const selectedNode = tree.nodes.find(n => n.id === selectedNodeId);

  // Get path from root to selected node
  const getBreadcrumbs = (targetId: string | null): { id: string, label: string }[] => {
    if (!targetId) return [];
    
    const findPath = (currentId: string, path: { id: string, label: string }[]): { id: string, label: string }[] | null => {
      const node = tree.nodes.find(n => n.id === currentId);
      if (!node) return null;
      
      const newPath = [...path, { id: currentId, label: node.question || "New Question" }];
      if (currentId === targetId) return newPath;
      
      for (const opt of node.options) {
        if (opt.childId) {
          const result = findPath(opt.childId, newPath);
          if (result) return result;
        }
      }
      return null;
    };
    
    return findPath(tree.rootId, []) || [];
  };

  const breadcrumbs = getBreadcrumbs(selectedNodeId);

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden text-foreground antialiased font-sans">
      {/* Left Rail */}
      <div className="w-[320px] shrink-0 border-r border-border bg-muted/20 flex flex-col">
        <div className="h-14 border-b border-border flex items-center px-4 justify-between bg-background">
          <div className="flex items-center gap-2">
            <LayoutTemplate className="h-4 w-4 text-[#3478F6]" />
            <h2 className="font-semibold text-sm">Decision Tree</h2>
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <Plus className="h-4 w-4" />
          </Button>
        </div>
        
        <ScrollArea className="flex-1">
          <div className="p-3">
            <RailNode 
              tree={tree} 
              nodeId={tree.rootId} 
              selectedNodeId={selectedNodeId} 
              onSelect={setSelectedNodeId}
              expandedNodes={expandedNodes}
              onToggleExpand={toggleExpand}
              depth={0}
            />
          </div>
        </ScrollArea>

        {/* Stats Footer */}
        <div className="p-3 border-t border-border bg-background/50 text-xs text-muted-foreground flex justify-between items-center">
          <span className="flex items-center gap-1"><GitBranch className="h-3 w-3" /> {stats.nodes} Nodes</span>
          <span className="flex items-center gap-1"><ArrowRight className="h-3 w-3" /> {stats.paths} Paths</span>
        </div>
      </div>

      {/* Right Panel */}
      <div className="flex-1 flex flex-col bg-background h-full overflow-hidden">
        {selectedNode ? (
          <>
            {/* Breadcrumb Header */}
            <div className="h-14 border-b border-border flex items-center px-6 gap-2 text-sm bg-background">
              {breadcrumbs.map((crumb, idx) => (
                <React.Fragment key={crumb.id}>
                  <button 
                    onClick={() => setSelectedNodeId(crumb.id)}
                    className={`max-w-[200px] truncate hover:underline ${idx === breadcrumbs.length - 1 ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}
                  >
                    {crumb.label}
                  </button>
                  {idx < breadcrumbs.length - 1 && <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />}
                </React.Fragment>
              ))}
            </div>

            <ScrollArea className="flex-1 px-8 py-8">
              <div className="max-w-3xl mx-auto space-y-8 pb-20">
                
                {/* Node Configuration */}
                <div className="space-y-6 bg-card rounded-xl border border-border shadow-sm overflow-hidden">
                  <div className="p-6 border-b border-border bg-muted/10 flex items-center justify-between">
                    <div>
                      <h3 className="text-lg font-semibold text-foreground">Question Settings</h3>
                      <p className="text-sm text-muted-foreground">Configure the text and help content for this step.</p>
                    </div>
                    <Button variant="outline" size="sm" className="gap-2 text-destructive hover:bg-destructive/10 hover:text-destructive border-destructive/20">
                      <Trash2 className="h-4 w-4" /> Delete Node
                    </Button>
                  </div>

                  <div className="p-6 space-y-6">
                    <div className="space-y-2">
                      <Label className="text-sm font-semibold text-foreground">Question Text</Label>
                      <Textarea 
                        value={selectedNode.question} 
                        onChange={(e) => updateNode(selectedNode.id, { question: e.target.value })}
                        className="text-base font-medium resize-none border-border focus-visible:ring-[#3478F6]"
                        rows={2}
                      />
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label className="text-sm font-semibold text-foreground">Help Text (Optional)</Label>
                        <Badge variant="secondary" className="bg-[#3478F6]/10 text-[#3478F6] border-[#3478F6]/20 font-normal">Staff see this in a tooltip</Badge>
                      </div>
                      <Textarea 
                        value={selectedNode.helpText || ""} 
                        onChange={(e) => updateNode(selectedNode.id, { helpText: e.target.value })}
                        placeholder="e.g., Check dispatch history for cancellation timestamp..."
                        className="text-sm resize-none border-border"
                        rows={2}
                      />
                    </div>
                  </div>
                </div>

                {/* Evidence Requirements */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
                        Evidence Requirements 
                        <Badge variant="outline" className="bg-muted text-muted-foreground font-normal rounded-full h-5 px-2">
                          {selectedNode.evidenceRequirements?.length || 0}
                        </Badge>
                      </h3>
                      <p className="text-sm text-muted-foreground">Documents staff must upload at this step.</p>
                    </div>
                    <Button variant="outline" size="sm" className="gap-2">
                      <Plus className="h-4 w-4" /> Add Evidence
                    </Button>
                  </div>

                  {selectedNode.evidenceRequirements && selectedNode.evidenceRequirements.length > 0 ? (
                    <div className="border border-border rounded-xl divide-y divide-border overflow-hidden bg-card shadow-sm">
                      {selectedNode.evidenceRequirements.map((req, idx) => (
                        <div key={idx} className="p-4 flex items-center gap-4 hover:bg-muted/30 transition-colors">
                          <Checkbox id={`req-${idx}`} checked={req.required} />
                          <div className="flex-1">
                            <Input 
                              value={req.label} 
                              className="h-8 text-sm font-medium border-transparent hover:border-border focus-visible:border-border focus-visible:ring-[#3478F6] bg-transparent"
                              readOnly
                            />
                          </div>
                          <div className="flex items-center gap-4 text-sm text-muted-foreground">
                            <label className="flex items-center gap-1.5 cursor-pointer hover:text-foreground transition-colors">
                              <Checkbox checked={req.acceptsImage !== false} className="h-3.5 w-3.5" />
                              <ImageIcon className="h-4 w-4" />
                            </label>
                            <label className="flex items-center gap-1.5 cursor-pointer hover:text-foreground transition-colors">
                              <Checkbox checked={!!req.acceptsText} className="h-3.5 w-3.5" />
                              <FileText className="h-4 w-4" />
                            </label>
                          </div>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="border border-dashed border-border rounded-xl p-8 text-center bg-muted/10">
                      <FileText className="h-8 w-8 mx-auto text-muted-foreground/50 mb-3" />
                      <p className="text-sm text-muted-foreground">No evidence required for this step.</p>
                    </div>
                  )}
                </div>

                {/* Options / Logic */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
                        Options & Routing
                      </h3>
                      <p className="text-sm text-muted-foreground">Define possible answers and where they lead.</p>
                    </div>
                  </div>

                  <div className="space-y-4">
                    {selectedNode.options.map((opt, idx) => (
                      <div key={idx} className="border border-border rounded-xl p-5 space-y-4 bg-card shadow-sm relative group transition-all hover:border-muted-foreground/30">
                        <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-[#1B2A4A] rounded-l-xl opacity-20 group-hover:opacity-100 transition-opacity" />
                        
                        <div className="flex items-start gap-4">
                          <div className="flex-1 space-y-1.5">
                            <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Answer Label</Label>
                            <Input 
                              value={opt.label} 
                              className="font-medium h-9 border-border focus-visible:ring-[#3478F6]"
                              readOnly
                            />
                          </div>
                          <Button variant="ghost" size="icon" className="mt-6 h-9 w-9 text-muted-foreground hover:text-destructive">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>

                        <Separator className="bg-border" />

                        <div className="flex items-center gap-4">
                          <div className="shrink-0 flex items-center gap-2">
                            <ArrowRight className="h-4 w-4 text-muted-foreground" />
                            <span className="text-sm font-medium text-foreground">Leads to:</span>
                          </div>

                          <div className="flex-1 flex items-center gap-3">
                            {!opt.childId ? (
                              <Select value={opt.outcomeType || ""}>
                                <SelectTrigger className="h-9">
                                  <SelectValue placeholder="Select outcome..." />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="sub_question">
                                    <div className="flex items-center gap-2">
                                      <GitBranch className="h-4 w-4" />
                                      <span>Next Question...</span>
                                    </div>
                                  </SelectItem>
                                  <Separator className="my-1" />
                                  <SelectItem value="portal_dispute">
                                    <div className="flex items-center gap-2 text-emerald-600">
                                      <Send className="h-4 w-4" />
                                      <span>Portal Dispute</span>
                                    </div>
                                  </SelectItem>
                                  <SelectItem value="dispute">
                                    <div className="flex items-center gap-2 text-[#3478F6]">
                                      <Mail className="h-4 w-4" />
                                      <span>Email Dispute</span>
                                    </div>
                                  </SelectItem>
                                  <SelectItem value="internal">
                                    <div className="flex items-center gap-2 text-red-600">
                                      <Ban className="h-4 w-4" />
                                      <span>Resolve Internally</span>
                                    </div>
                                  </SelectItem>
                                  <SelectItem value="hold">
                                    <div className="flex items-center gap-2 text-[#E85D3A]">
                                      <PauseCircle className="h-4 w-4" />
                                      <span>Place on Hold</span>
                                    </div>
                                  </SelectItem>
                                </SelectContent>
                              </Select>
                            ) : (
                              <div className="flex-1 flex items-center justify-between border border-border rounded-md px-3 h-9 bg-muted/30">
                                <div className="flex items-center gap-2 truncate">
                                  <GitBranch className="h-4 w-4 text-muted-foreground shrink-0" />
                                  <span className="text-sm font-medium truncate">
                                    {tree.nodes.find(n => n.id === opt.childId)?.question || "Next Question"}
                                  </span>
                                </div>
                                <Button variant="ghost" size="sm" className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground">
                                  Go to node
                                </Button>
                              </div>
                            )}

                            {opt.outcomeType && (
                              <Badge className={`${OUTCOME_COLORS[opt.outcomeType].bg} ${OUTCOME_COLORS[opt.outcomeType].text} ${OUTCOME_COLORS[opt.outcomeType].border} border shadow-none font-medium h-9 px-3 gap-1.5 whitespace-nowrap`}>
                                {React.createElement(OUTCOME_ICONS[opt.outcomeType], { className: "h-3.5 w-3.5" })}
                                {OUTCOME_LABELS[opt.outcomeType]}
                              </Badge>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                    <Button variant="outline" className="w-full border-dashed border-2 gap-2 h-12 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors">
                      <Plus className="h-4 w-4" /> Add Option
                    </Button>
                  </div>
                </div>

              </div>
            </ScrollArea>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center bg-muted/10">
            <div className="text-center space-y-4">
              <div className="w-16 h-16 bg-muted rounded-2xl flex items-center justify-center mx-auto shadow-sm">
                <GitBranch className="h-8 w-8 text-muted-foreground" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-foreground">No Node Selected</h3>
                <p className="text-sm text-muted-foreground">Select a node from the rail to edit its properties.</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Left Rail Node Component (Recursive)
function RailNode({ 
  tree, 
  nodeId, 
  selectedNodeId, 
  onSelect, 
  expandedNodes,
  onToggleExpand,
  depth,
  isLast = true
}: { 
  tree: DecisionTree; 
  nodeId: string; 
  selectedNodeId: string | null; 
  onSelect: (id: string) => void;
  expandedNodes: Set<string>;
  onToggleExpand: (id: string) => void;
  depth: number;
  isLast?: boolean;
}) {
  const node = tree.nodes.find(n => n.id === nodeId);
  if (!node) return null;

  const isSelected = selectedNodeId === nodeId;
  const isExpanded = expandedNodes.has(nodeId);
  const hasChildren = node.options.some(opt => opt.childId);

  return (
    <div className="relative">
      {/* Indentation Lines */}
      {depth > 0 && (
        <div 
          className="absolute border-l border-border" 
          style={{ 
            left: `${(depth - 1) * 20 + 24}px`, 
            top: 0, 
            bottom: isLast && !isExpanded ? '50%' : '-16px' 
          }} 
        />
      )}

      {/* Node Row */}
      <div 
        className={`group flex items-center gap-1.5 py-1.5 px-2 rounded-md cursor-pointer transition-colors ${
          isSelected 
            ? "bg-[#3478F6]/10 text-[#3478F6]" 
            : "hover:bg-muted text-foreground"
        }`}
        style={{ paddingLeft: `${depth * 20 + 8}px` }}
        onClick={() => onSelect(node.id)}
      >
        <button 
          className={`h-5 w-5 shrink-0 flex items-center justify-center rounded hover:bg-muted-foreground/20 transition-colors ${!hasChildren && 'invisible'}`}
          onClick={(e) => { e.stopPropagation(); onToggleExpand(node.id); }}
        >
          {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </button>

        <div className="relative flex items-center justify-center h-4 w-4 shrink-0">
          <Circle className={`h-2.5 w-2.5 fill-current ${isSelected ? 'text-[#3478F6]' : 'text-muted-foreground'}`} />
        </div>

        <div className="truncate flex-1 text-sm font-medium">
          {node.question || <span className="text-muted-foreground italic">Empty Question</span>}
        </div>

        {node.evidenceRequirements && node.evidenceRequirements.length > 0 && (
          <FileText className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
        )}
      </div>

      {/* Children & Outcomes */}
      {isExpanded && (
        <div className="mt-1">
          {node.options.map((opt, idx) => {
            const isLastOpt = idx === node.options.length - 1;
            
            return (
              <div key={idx}>
                {opt.childId ? (
                  <RailNode 
                    tree={tree} 
                    nodeId={opt.childId} 
                    selectedNodeId={selectedNodeId} 
                    onSelect={onSelect}
                    expandedNodes={expandedNodes}
                    onToggleExpand={onToggleExpand}
                    depth={depth + 1}
                    isLast={isLastOpt}
                  />
                ) : (
                  <div className="relative group">
                    <div 
                      className="absolute border-l border-border" 
                      style={{ 
                        left: `${depth * 20 + 24}px`, 
                        top: '-4px', 
                        bottom: isLastOpt ? '50%' : '-4px' 
                      }} 
                    />
                    <div 
                      className="absolute border-t border-border w-3" 
                      style={{ 
                        left: `${depth * 20 + 24}px`, 
                        top: '50%'
                      }} 
                    />
                    <div 
                      className="flex items-center gap-2 py-1.5 pr-2 truncate text-xs text-muted-foreground"
                      style={{ paddingLeft: `${depth * 20 + 40}px` }}
                    >
                      <span className="truncate max-w-[120px]">{opt.label}</span>
                      <ArrowRight className="h-3 w-3 shrink-0 opacity-50" />
                      {opt.outcomeType ? (
                        <div className="flex items-center gap-1.5 truncate">
                          <div className={`h-2 w-2 rounded-full shrink-0 ${
                            opt.outcomeType === 'portal_dispute' ? 'bg-emerald-500' :
                            opt.outcomeType === 'dispute' ? 'bg-[#3478F6]' :
                            opt.outcomeType === 'internal' ? 'bg-red-500' :
                            'bg-[#E85D3A]'
                          }`} />
                          <span className="font-medium truncate text-foreground">{OUTCOME_LABELS[opt.outcomeType]}</span>
                        </div>
                      ) : (
                        <span className="italic">Unassigned</span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
