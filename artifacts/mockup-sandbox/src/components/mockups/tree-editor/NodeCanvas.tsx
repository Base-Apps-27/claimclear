import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import {
  Plus, X, HelpCircle, ChevronDown, ChevronRight,
  FileText, Copy, Play, GitBranch, ArrowRight, Layers,
  Send, Ban, PauseCircle, Mail, Info, Image as ImageIcon,
  Camera, Upload, Save, Settings, ZoomIn, ZoomOut, Maximize, MousePointer2, Hand, Focus
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
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
import { Popover, PopoverContent, SelectScrollUpButton, SelectScrollDownButton, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

type OutcomeType = "portal_dispute" | "internal" | "hold" | "dispute";

interface EvidenceReq {
  key: string;
  label: string;
  required: boolean;
  evidenceTypeId?: number;
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
  portal_dispute: { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-300" },
  dispute: { bg: "bg-blue-50", text: "text-blue-700", border: "border-blue-300" },
  internal: { bg: "bg-rose-50", text: "text-rose-700", border: "border-rose-300" },
  hold: { bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-300" },
};

const OUTCOME_ICONS: Record<OutcomeType, React.FC<any>> = {
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

function generateNodeId(): string {
  return `n_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
}

// Layout Engine
interface NodeLayout {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  type: "question" | "outcome";
  node?: TreeNode;
  outcome?: { type: OutcomeType; label: string; parentId: string; optionIndex: number };
}

interface PortLayout {
  id: string; // "nodeId-out-optIdx" or "nodeId-in"
  x: number;
  y: number;
  nodeId: string;
  type: "in" | "out";
  optIdx?: number;
}

interface ConnectionLayout {
  id: string;
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  color: string;
}

function calculateLayout(tree: DecisionTree) {
  const layouts: Record<string, NodeLayout> = {};
  const NODE_WIDTH = 320;
  const X_SPACING = 400;
  const Y_SPACING = 250;

  // Track max Y per X level to prevent overlaps
  const maxHeights: Record<number, number> = {};

  const processNode = (nodeId: string, level: number, preferY: number): number => {
    const node = tree.nodes.find(n => n.id === nodeId);
    if (!node) return preferY;

    if (layouts[nodeId]) return layouts[nodeId].y; // Already processed (cycles/re-entry should be rare but possible)

    const x = level * X_SPACING;
    // Find first available Y slot at this X level that is close to preferY
    let y = Math.max(preferY, (maxHeights[level] || 0));
    
    layouts[nodeId] = {
      id: nodeId,
      x,
      y,
      width: NODE_WIDTH,
      height: 140 + (node.options.length * 40) + (node.helpText ? 30 : 0) + (node.evidenceRequirements?.length ? 30 : 0),
      type: "question",
      node
    };

    maxHeights[level] = y + layouts[nodeId].height + 40;

    let currentY = y;
    
    node.options.forEach((opt, idx) => {
      if (opt.childId) {
        currentY = processNode(opt.childId, level + 1, currentY);
      } else if (opt.outcomeType) {
        const outId = `out_${nodeId}_${idx}`;
        const outX = (level + 1) * X_SPACING;
        let outY = Math.max(currentY, (maxHeights[level + 1] || 0));
        
        layouts[outId] = {
          id: outId,
          x: outX,
          y: outY,
          width: 240,
          height: 60,
          type: "outcome",
          outcome: { type: opt.outcomeType, label: opt.outcomeLabel || "", parentId: nodeId, optionIndex: idx }
        };
        maxHeights[level + 1] = outY + layouts[outId].height + 20;
        currentY = outY + layouts[outId].height + 20;
      }
    });

    return y + layouts[nodeId].height + Y_SPACING;
  };

  processNode(tree.rootId, 0, 100);
  
  return layouts;
}

export function NodeCanvas() {
  const [tree, setTree] = useState<DecisionTree>(SAMPLE_TREE);
  const [layouts, setLayouts] = useState<Record<string, NodeLayout>>({});
  
  // Viewport/Canvas state
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 100, y: 50 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [activeNode, setActiveNode] = useState<string | null>(null);
  
  // Selected tool
  const [tool, setTool] = useState<"select" | "pan">("select");

  const containerRef = useRef<HTMLDivElement>(null);

  // Recalculate layout when tree changes
  useEffect(() => {
    setLayouts(calculateLayout(tree));
  }, [tree]);

  const handleWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const zoomFactor = 0.05;
      const newZoom = e.deltaY > 0 ? Math.max(0.2, zoom - zoomFactor) : Math.min(2, zoom + zoomFactor);
      
      // Zoom towards mouse
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        
        const scaleChange = newZoom - zoom;
        const newPanX = pan.x - (mouseX - pan.x) * (scaleChange / zoom);
        const newPanY = pan.y - (mouseY - pan.y) * (scaleChange / zoom);
        
        setZoom(newZoom);
        setPan({ x: newPanX, y: newPanY });
      }
    } else {
      setPan({
        x: pan.x - e.deltaX,
        y: pan.y - e.deltaY
      });
    }
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    // If middle click or space+click or pan tool is active
    if (e.button === 1 || tool === "pan" || e.altKey) {
      setIsDragging(true);
      setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
      e.currentTarget.setPointerCapture(e.pointerId);
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (isDragging) {
      setPan({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y
      });
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    setIsDragging(false);
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const updateNodeData = (nodeId: string, updates: Partial<TreeNode>) => {
    setTree(prev => ({
      ...prev,
      nodes: prev.nodes.map(n => n.id === nodeId ? { ...n, ...updates } : n)
    }));
  };

  const updateOptionData = (nodeId: string, optIdx: number, updates: Partial<TreeOption>) => {
    setTree(prev => ({
      ...prev,
      nodes: prev.nodes.map(n => {
        if (n.id === nodeId) {
          const newOptions = [...n.options];
          newOptions[optIdx] = { ...newOptions[optIdx], ...updates };
          return { ...n, options: newOptions };
        }
        return n;
      })
    }));
  };

  const addOption = (nodeId: string) => {
    setTree(prev => ({
      ...prev,
      nodes: prev.nodes.map(n => {
        if (n.id === nodeId) {
          return { ...n, options: [...n.options, { label: `Option ${n.options.length + 1}` }] };
        }
        return n;
      })
    }));
  };

  const removeOption = (nodeId: string, optIdx: number) => {
    // Note: robust implementation would also clean up orphaned children
    setTree(prev => ({
      ...prev,
      nodes: prev.nodes.map(n => {
        if (n.id === nodeId) {
          return { ...n, options: n.options.filter((_, i) => i !== optIdx) };
        }
        return n;
      })
    }));
  };

  const addChildNode = (nodeId: string, optIdx: number) => {
    const newId = generateNodeId();
    const newNode: TreeNode = {
      id: newId,
      question: "New Question?",
      options: [{ label: "Yes" }, { label: "No" }]
    };
    
    setTree(prev => ({
      rootId: prev.rootId,
      nodes: [
        ...prev.nodes.map(n => {
          if (n.id === nodeId) {
            const newOptions = [...n.options];
            newOptions[optIdx] = { ...newOptions[optIdx], childId: newId, outcomeType: undefined, outcomeLabel: undefined };
            return { ...n, options: newOptions };
          }
          return n;
        }),
        newNode
      ]
    }));
  };

  // Generate connections based on current layout
  const connections: ConnectionLayout[] = [];
  Object.values(layouts).forEach(layout => {
    if (layout.type === "question" && layout.node) {
      layout.node.options.forEach((opt, idx) => {
        // Output port position
        const sourceX = layout.x + layout.width;
        // Approximation of option vertical center (offset from top of node + header height + option index)
        const headerHeight = layout.node!.helpText ? 100 : 70;
        const sourceY = layout.y + headerHeight + (idx * 40) + 20;

        if (opt.childId && layouts[opt.childId]) {
          const targetNode = layouts[opt.childId];
          const targetX = targetNode.x;
          const targetY = targetNode.y + 40; // Approx middle of header
          
          connections.push({
            id: `${layout.id}-${idx}-${opt.childId}`,
            sourceX, sourceY, targetX, targetY,
            color: "#94a3b8" // default connector color
          });
        } else if (opt.outcomeType) {
          const outId = `out_${layout.id}_${idx}`;
          if (layouts[outId]) {
            const targetNode = layouts[outId];
            const targetX = targetNode.x;
            const targetY = targetNode.y + 30;
            
            let color = "#94a3b8";
            if (opt.outcomeType === "portal_dispute") color = "#10b981"; // emerald-500
            else if (opt.outcomeType === "dispute") color = "#3b82f6"; // blue-500
            else if (opt.outcomeType === "internal") color = "#f43f5e"; // rose-500
            else if (opt.outcomeType === "hold") color = "#f59e0b"; // amber-500
            
            connections.push({
              id: `${layout.id}-${idx}-out`,
              sourceX, sourceY, targetX, targetY,
              color
            });
          }
        }
      });
    }
  });

  return (
    <div className="h-[100dvh] w-full flex flex-col bg-slate-50 overflow-hidden font-sans text-slate-900">
      {/* Top Bar */}
      <header className="flex-none h-14 bg-white border-b border-slate-200 flex items-center justify-between px-4 z-10 relative shadow-sm">
        <div className="flex items-center gap-3">
          <div className="bg-[#1B2A4A] p-1.5 rounded-md">
            <GitBranch className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="font-semibold text-sm leading-tight text-slate-900">Decision Tree Editor</h1>
            <p className="text-xs text-slate-500 leading-tight">ClaimClear • MAS Cancellation Dispute</p>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <div className="flex items-center bg-slate-100 p-1 rounded-md mr-4">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button 
                    variant={tool === "select" ? "secondary" : "ghost"} 
                    size="icon" 
                    className="h-7 w-7" 
                    onClick={() => setTool("select")}
                  >
                    <MousePointer2 className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Select (V)</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button 
                    variant={tool === "pan" ? "secondary" : "ghost"} 
                    size="icon" 
                    className="h-7 w-7"
                    onClick={() => setTool("pan")}
                  >
                    <Hand className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Pan (Space or Middle Click)</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          
          <Button variant="outline" size="sm" className="gap-2 h-8">
            <Settings className="h-4 w-4" />
            <span className="hidden sm:inline">Settings</span>
          </Button>
          <Button size="sm" className="gap-2 h-8 bg-[#3478F6] hover:bg-[#2563EB]">
            <Save className="h-4 w-4" />
            <span className="hidden sm:inline">Save Tree</span>
          </Button>
        </div>
      </header>

      {/* Canvas Area */}
      <div 
        ref={containerRef}
        className={`flex-1 relative overflow-hidden bg-[#f8fafc] ${tool === "pan" ? "cursor-grab active:cursor-grabbing" : isDragging ? "cursor-grabbing" : ""}`}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      >
        {/* Background Grid Pattern */}
        <div 
          className="absolute inset-0 pointer-events-none opacity-20"
          style={{
            backgroundImage: 'radial-gradient(#94a3b8 1px, transparent 1px)',
            backgroundSize: `${20 * zoom}px ${20 * zoom}px`,
            backgroundPosition: `${pan.x}px ${pan.y}px`,
          }}
        />

        {/* Scaled/Panned Container */}
        <div 
          className="absolute origin-top-left"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          }}
        >
          {/* SVG Connections Layer */}
          <svg className="absolute inset-0 overflow-visible pointer-events-none">
            {connections.map(conn => {
              // Bezier curve logic
              const dx = Math.abs(conn.targetX - conn.sourceX);
              const dy = Math.abs(conn.targetY - conn.sourceY);
              const cpOffset = Math.max(dx * 0.5, 50);
              
              const d = `M ${conn.sourceX} ${conn.sourceY} 
                         C ${conn.sourceX + cpOffset} ${conn.sourceY}, 
                           ${conn.targetX - cpOffset} ${conn.targetY}, 
                           ${conn.targetX} ${conn.targetY}`;
                           
              return (
                <g key={conn.id}>
                  <path 
                    d={d} 
                    fill="none" 
                    stroke={conn.color} 
                    strokeWidth="3" 
                    className="opacity-50"
                  />
                  {/* Arrowhead */}
                  <path 
                    d={`M ${conn.targetX - 8} ${conn.targetY - 5} L ${conn.targetX} ${conn.targetY} L ${conn.targetX - 8} ${conn.targetY + 5}`}
                    fill="none"
                    stroke={conn.color}
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="opacity-80"
                  />
                </g>
              );
            })}
          </svg>

          {/* HTML Nodes Layer */}
          {Object.values(layouts).map(layout => {
            if (layout.type === "question" && layout.node) {
              const isActive = activeNode === layout.id;
              
              return (
                <div 
                  key={layout.id}
                  className={`absolute bg-white rounded-xl border shadow-sm transition-shadow ${isActive ? 'border-[#3478F6] shadow-md ring-2 ring-[#3478F6]/20' : 'border-slate-200 hover:border-slate-300'}`}
                  style={{
                    left: layout.x,
                    top: layout.y,
                    width: layout.width,
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setActiveNode(layout.id);
                  }}
                >
                  {/* Input Port (if not root) */}
                  {layout.id !== tree.rootId && (
                    <div className="absolute top-10 -left-2 w-4 h-4 bg-white border-2 border-slate-300 rounded-full" />
                  )}
                  
                  {/* Root Badge */}
                  {layout.id === tree.rootId && (
                    <div className="absolute -top-3 left-4 bg-[#E85D3A] text-white text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">
                      Root
                    </div>
                  )}

                  {/* Header/Question */}
                  <div className="p-4 border-b border-slate-100 bg-slate-50/50 rounded-t-xl cursor-default">
                    <div className="flex justify-between items-start gap-2 mb-2">
                      <Label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Question</Label>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" className="h-6 w-6 text-slate-400 hover:text-slate-600">
                          <Copy className="h-3 w-3" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-6 w-6 text-slate-400 hover:text-rose-600">
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                    
                    <Textarea 
                      value={layout.node.question}
                      onChange={(e) => updateNodeData(layout.id, { question: e.target.value })}
                      className="min-h-[60px] resize-none text-sm font-medium border-slate-200 focus-visible:ring-1 focus-visible:ring-[#3478F6] focus-visible:border-[#3478F6] shadow-inner"
                      placeholder="Enter question here..."
                    />
                    
                    {layout.node.helpText && (
                      <div className="mt-3 flex items-start gap-2 bg-blue-50/50 text-blue-800 p-2 rounded-md border border-blue-100">
                        <Info className="h-3.5 w-3.5 mt-0.5 flex-none text-blue-500" />
                        <p className="text-xs">{layout.node.helpText}</p>
                      </div>
                    )}
                  </div>

                  {/* Options / Output Ports */}
                  <div className="p-3 space-y-2">
                    {layout.node.options.map((opt, idx) => (
                      <div key={idx} className="relative flex items-center gap-2 group">
                        <Input 
                          value={opt.label}
                          onChange={(e) => updateOptionData(layout.id, idx, { label: e.target.value })}
                          className="h-8 text-xs flex-1 border-slate-200 focus-visible:ring-1 focus-visible:ring-[#3478F6]"
                        />
                        
                        <div className="w-[120px] flex-none">
                          <Select 
                            value={opt.childId ? "sub" : (opt.outcomeType || "none")}
                            onValueChange={(v) => {
                              if (v === "sub") {
                                addChildNode(layout.id, idx);
                              } else if (v === "none") {
                                updateOptionData(layout.id, idx, { childId: undefined, outcomeType: undefined, outcomeLabel: undefined });
                              } else {
                                updateOptionData(layout.id, idx, { 
                                  childId: undefined, 
                                  outcomeType: v as OutcomeType, 
                                  outcomeLabel: OUTCOME_LABELS[v as OutcomeType] 
                                });
                              }
                            }}
                          >
                            <SelectTrigger className="h-8 text-xs bg-slate-50 border-slate-200">
                              <SelectValue placeholder="Action" />
                            </SelectTrigger>
                            <SelectContent className="text-xs">
                              <SelectItem value="none">No Action</SelectItem>
                              <SelectItem value="sub">
                                <span className="flex items-center gap-2"><GitBranch className="h-3 w-3 text-slate-500"/> Continue Flow</span>
                              </SelectItem>
                              <SelectItem value="portal_dispute">
                                <span className="flex items-center gap-2"><Send className="h-3 w-3 text-emerald-500"/> Portal Dispute</span>
                              </SelectItem>
                              <SelectItem value="dispute">
                                <span className="flex items-center gap-2"><Mail className="h-3 w-3 text-blue-500"/> Email Dispute</span>
                              </SelectItem>
                              <SelectItem value="hold">
                                <span className="flex items-center gap-2"><PauseCircle className="h-3 w-3 text-amber-500"/> Hold</span>
                              </SelectItem>
                              <SelectItem value="internal">
                                <span className="flex items-center gap-2"><Ban className="h-3 w-3 text-rose-500"/> Internal Deny</span>
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity text-slate-400 hover:text-rose-500"
                          onClick={() => removeOption(layout.id, idx)}
                        >
                          <X className="h-3 w-3" />
                        </Button>

                        {/* Connection Port Dot */}
                        <div 
                          className={`absolute -right-4 top-1/2 -translate-y-1/2 w-3 h-3 rounded-full border-2 ${opt.childId || opt.outcomeType ? 'bg-slate-400 border-slate-50' : 'bg-white border-slate-300'} z-10 shadow-sm`} 
                        />
                      </div>
                    ))}
                    
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="w-full mt-2 h-7 text-xs text-slate-500 hover:text-slate-700 bg-slate-50 hover:bg-slate-100 border border-dashed border-slate-200"
                      onClick={() => addOption(layout.id)}
                    >
                      <Plus className="h-3 w-3 mr-1" /> Add Option
                    </Button>
                  </div>
                  
                  {/* Footer Tools */}
                  <div className="border-t border-slate-100 p-2 bg-slate-50/50 rounded-b-xl flex gap-1">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-slate-500 gap-1">
                            <FileText className="h-3 w-3" />
                            {layout.node.evidenceRequirements?.length ? layout.node.evidenceRequirements.length : 'Evid'}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Manage Evidence Requirements</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-slate-500 gap-1">
                            <Info className="h-3 w-3" />
                            Instr
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Add Detailed Instructions</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                </div>
              );
            } else if (layout.type === "outcome" && layout.outcome) {
              const ot = layout.outcome.type;
              const colors = OUTCOME_COLORS[ot];
              const Icon = OUTCOME_ICONS[ot];
              
              return (
                <div 
                  key={layout.id}
                  className={`absolute rounded-full border ${colors.bg} ${colors.border} shadow-sm px-4 py-3 flex items-center gap-3 transition-transform hover:scale-105`}
                  style={{
                    left: layout.x,
                    top: layout.y,
                    width: layout.width,
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="absolute -left-[5px] top-1/2 -translate-y-1/2 w-2 h-2 bg-slate-400 rounded-full" />
                  
                  <div className={`p-1.5 rounded-full bg-white/60 ${colors.text}`}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-[10px] font-bold uppercase tracking-wider ${colors.text} opacity-80`}>Outcome</p>
                    <p className={`text-xs font-semibold ${colors.text} truncate`} title={layout.outcome.label}>
                      {layout.outcome.label}
                    </p>
                  </div>
                </div>
              );
            }
            return null;
          })}
        </div>
        
        {/* Minimap / Controls */}
        <div className="absolute bottom-6 right-6 flex flex-col gap-2">
          <div className="bg-white rounded-lg border border-slate-200 shadow-md p-1 flex flex-col gap-1">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-600" onClick={() => setZoom(z => Math.min(2, z + 0.1))}>
                    <ZoomIn className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="left">Zoom In</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-600" onClick={() => { setZoom(1); setPan({x: 100, y: 50}); }}>
                    <Focus className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="left">Reset View</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-600" onClick={() => setZoom(z => Math.max(0.2, z - 0.1))}>
                    <ZoomOut className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="left">Zoom Out</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          
          <div className="bg-white rounded-lg border border-slate-200 shadow-md p-2 w-32 h-24 relative opacity-80 hover:opacity-100 transition-opacity">
             <div className="text-[9px] font-semibold text-slate-400 mb-1 uppercase tracking-wider">Mini-map</div>
             <div className="absolute inset-0 m-2 border border-slate-100 bg-slate-50 rounded">
               {/* Extremely simplified minimap viz */}
               {Object.values(layouts).map(l => (
                 <div 
                   key={l.id} 
                   className={`absolute rounded-sm ${l.type === 'outcome' ? 'bg-[#E85D3A]/60 rounded-full' : 'bg-[#1B2A4A]/40'}`}
                   style={{
                     left: `${(l.x / 2000) * 100}%`,
                     top: `${(l.y / 1500) * 100}%`,
                     width: `${Math.max(2, (l.width / 2000) * 100)}%`,
                     height: `${Math.max(2, (l.height / 1500) * 100)}%`,
                   }}
                 />
               ))}
               <div 
                 className="absolute border border-[#3478F6] bg-[#3478F6]/10 pointer-events-none rounded"
                 style={{
                   left: `${Math.max(0, -pan.x / zoom / 20)}%`,
                   top: `${Math.max(0, -pan.y / zoom / 15)}%`,
                   width: `${(100 / zoom)}%`,
                   height: `${(100 / zoom)}%`,
                   maxWidth: '100%',
                   maxHeight: '100%',
                 }}
               />
             </div>
          </div>
        </div>
      </div>
    </div>
  );
}
