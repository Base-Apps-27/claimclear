import React, { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { 
  Plus, X, HelpCircle, Settings, Trash2, ChevronDown, 
  Send, Ban, PauseCircle, Mail, Info, FileText, Image as ImageIcon,
  MoreVertical, Edit2, GitBranch
} from "lucide-react";

export type OutcomeType = "portal_dispute" | "internal" | "hold" | "dispute";

export interface EvidenceReq {
  key: string;
  label: string;
  required: boolean;
  acceptsImage?: boolean;
  acceptsText?: boolean;
}

export interface TreeOption {
  label: string;
  childId?: string;
  outcomeType?: OutcomeType;
  outcomeLabel?: string;
}

export interface TreeNode {
  id: string;
  question: string;
  helpText?: string;
  instructionText?: string;
  instructionImageUrl?: string;
  options: TreeOption[];
  evidenceRequirements?: EvidenceReq[];
}

export interface DecisionTree {
  nodes: TreeNode[];
  rootId: string;
}

const OUTCOME_LABELS: Record<OutcomeType, string> = {
  portal_dispute: "Submit Portal Dispute",
  dispute: "Send Dispute Email",
  internal: "Resolve Internally",
  hold: "Place on Hold",
};

const OUTCOME_COLORS: Record<OutcomeType, { bg: string; text: string; border: string; icon: React.ElementType }> = {
  portal_dispute: { bg: "bg-green-50", text: "text-green-700", border: "border-green-300", icon: Send },
  dispute: { bg: "bg-blue-50", text: "text-blue-700", border: "border-blue-300", icon: Mail },
  internal: { bg: "bg-red-50", text: "text-red-700", border: "border-red-300", icon: Ban },
  hold: { bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-300", icon: PauseCircle },
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

function generateId() {
  return Math.random().toString(36).substr(2, 9);
}

export function VerticalFlow() {
  const [tree, setTree] = useState<DecisionTree>(SAMPLE_TREE);

  const updateNode = (nodeId: string, updates: Partial<TreeNode>) => {
    setTree(prev => ({
      ...prev,
      nodes: prev.nodes.map(n => n.id === nodeId ? { ...n, ...updates } : n)
    }));
  };

  const addSubQuestion = (nodeId: string, optionIndex: number) => {
    const newChildId = "q" + generateId();
    const newNode: TreeNode = {
      id: newChildId,
      question: "New Question?",
      options: [
        { label: "Yes" },
        { label: "No" }
      ]
    };

    setTree(prev => {
      const parentNode = prev.nodes.find(n => n.id === nodeId);
      if (!parentNode) return prev;
      
      const newOptions = [...parentNode.options];
      newOptions[optionIndex] = { ...newOptions[optionIndex], childId: newChildId, outcomeType: undefined, outcomeLabel: undefined };
      
      return {
        ...prev,
        nodes: [...prev.nodes.map(n => n.id === nodeId ? { ...n, options: newOptions } : n), newNode]
      };
    });
  };

  const setOutcome = (nodeId: string, optionIndex: number, outcomeType: OutcomeType) => {
    setTree(prev => {
      const parentNode = prev.nodes.find(n => n.id === nodeId);
      if (!parentNode) return prev;
      
      const newOptions = [...parentNode.options];
      newOptions[optionIndex] = { 
        ...newOptions[optionIndex], 
        childId: undefined, 
        outcomeType, 
        outcomeLabel: OUTCOME_LABELS[outcomeType] 
      };
      
      return {
        ...prev,
        nodes: prev.nodes.map(n => n.id === nodeId ? { ...n, options: newOptions } : n)
      };
    });
  };

  const renderNode = (nodeId: string, parentOptionLabel?: string) => {
    const node = tree.nodes.find(n => n.id === nodeId);
    if (!node) return null;

    const hasMultipleOptions = node.options.length > 1;

    return (
      <div key={node.id} className="flex flex-col items-center">
        {/* The Node Card */}
        <div className="relative z-10 w-[400px]">
          <Card className="border-slate-200 shadow-sm hover:shadow-md transition-shadow duration-200 bg-white">
            <CardContent className="p-0">
              <div className="bg-slate-50 border-b border-slate-100 p-3 rounded-t-xl flex justify-between items-center">
                <Badge variant="outline" className="bg-white text-slate-500 font-medium font-mono text-[10px] tracking-wider uppercase">
                  {node.id}
                </Badge>
                <div className="flex items-center gap-1">
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-400 hover:text-slate-600">
                        <Settings className="h-4 w-4" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-64 p-3" align="end">
                      <div className="space-y-4">
                        <div className="space-y-2">
                          <Label className="text-xs text-slate-500">Help Text</Label>
                          <Textarea 
                            className="text-xs min-h-[60px]" 
                            placeholder="Add contextual help for this step..."
                            value={node.helpText || ""}
                            onChange={e => updateNode(node.id, { helpText: e.target.value })}
                          />
                        </div>
                        <Button variant="outline" className="w-full text-xs h-8 justify-start text-indigo-600 border-indigo-200 bg-indigo-50 hover:bg-indigo-100">
                          <FileText className="h-3.5 w-3.5 mr-2" />
                          Manage Evidence Requirements
                        </Button>
                      </div>
                    </PopoverContent>
                  </Popover>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-400 hover:text-red-500">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              
              <div className="p-5 space-y-4">
                <Textarea 
                  value={node.question}
                  onChange={(e) => updateNode(node.id, { question: e.target.value })}
                  className="text-base font-medium text-slate-800 resize-none min-h-[60px] border-transparent hover:border-slate-200 focus-visible:border-slate-300 focus-visible:ring-0 p-1 -m-1 shadow-none"
                  placeholder="Enter question here..."
                />

                {(node.helpText || (node.evidenceRequirements && node.evidenceRequirements.length > 0)) && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {node.helpText && (
                      <Badge variant="secondary" className="bg-slate-100 text-slate-600 font-normal hover:bg-slate-200 cursor-help">
                        <HelpCircle className="h-3 w-3 mr-1" /> Help text attached
                      </Badge>
                    )}
                    {node.evidenceRequirements && node.evidenceRequirements.length > 0 && (
                      <Badge variant="secondary" className="bg-violet-50 text-violet-700 border-violet-200 font-normal hover:bg-violet-100">
                        <FileText className="h-3 w-3 mr-1" /> {node.evidenceRequirements.length} evidence reqs
                      </Badge>
                    )}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Vertical stem from the node */}
        <div className="w-px h-8 bg-slate-300"></div>

        {/* Options Branching */}
        <div className="flex justify-center relative">
          {hasMultipleOptions && (
            <div className="absolute top-0 h-px bg-slate-300 w-full" style={{ width: `calc(100% - ${100 / node.options.length}%)` }}></div>
          )}
          
          {node.options.map((opt, i) => {
            const isFirst = i === 0;
            const isLast = i === node.options.length - 1;
            
            return (
              <div key={i} className="flex flex-col items-center relative px-6">
                {/* Horizontal connector top */}
                {hasMultipleOptions && (
                  <div className="absolute top-0 h-px bg-slate-300 w-full" style={{
                    left: isFirst ? '50%' : 0,
                    width: isFirst || isLast ? '50%' : '100%',
                    display: node.options.length === 1 ? 'none' : 'block'
                  }}></div>
                )}
                
                {/* Option Pill */}
                <div className="relative z-10 flex flex-col items-center">
                  <div className="w-px h-4 bg-slate-300"></div>
                  
                  <Popover>
                    <PopoverTrigger asChild>
                      <button className="group flex items-center bg-white border border-slate-200 hover:border-[#3478F6] shadow-sm rounded-full pl-4 pr-3 py-1.5 text-sm font-medium text-slate-700 transition-colors">
                        {opt.label}
                        <ChevronDown className="h-3.5 w-3.5 ml-2 text-slate-400 group-hover:text-[#3478F6]" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-64 p-3" align="center">
                      <div className="space-y-4">
                        <div className="space-y-2">
                          <Label className="text-xs">Option Label</Label>
                          <Input 
                            value={opt.label}
                            onChange={(e) => {
                              const newOpts = [...node.options];
                              newOpts[i] = { ...opt, label: e.target.value };
                              updateNode(node.id, { options: newOpts });
                            }}
                            className="h-8 text-sm"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label className="text-xs">Action / Next Step</Label>
                          <Select 
                            value={opt.childId ? "sub_question" : opt.outcomeType || ""}
                            onValueChange={(val) => {
                              if (val === "sub_question") {
                                addSubQuestion(node.id, i);
                              } else {
                                setOutcome(node.id, i, val as OutcomeType);
                              }
                            }}
                          >
                            <SelectTrigger className="h-8 text-sm">
                              <SelectValue placeholder="Select action..." />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="sub_question">
                                <span className="flex items-center gap-2"><GitBranch className="h-4 w-4" />Ask sub-question</span>
                              </SelectItem>
                              <SelectItem value="portal_dispute">
                                <span className="flex items-center gap-2"><Send className="h-4 w-4 text-green-600" />Portal Dispute</span>
                              </SelectItem>
                              <SelectItem value="dispute">
                                <span className="flex items-center gap-2"><Mail className="h-4 w-4 text-blue-600" />Email Dispute</span>
                              </SelectItem>
                              <SelectItem value="internal">
                                <span className="flex items-center gap-2"><Ban className="h-4 w-4 text-red-600" />Resolve Internally</span>
                              </SelectItem>
                              <SelectItem value="hold">
                                <span className="flex items-center gap-2"><PauseCircle className="h-4 w-4 text-amber-600" />Place on Hold</span>
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <Button 
                          variant="ghost" 
                          className="w-full text-xs h-8 text-red-600 hover:text-red-700 hover:bg-red-50 justify-start"
                          onClick={() => {
                            const newOpts = node.options.filter((_, idx) => idx !== i);
                            updateNode(node.id, { options: newOpts });
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5 mr-2" /> Remove Option
                        </Button>
                      </div>
                    </PopoverContent>
                  </Popover>

                  <div className="w-px h-6 bg-slate-300"></div>

                  {/* Child Node or Outcome */}
                  {opt.childId ? (
                    renderNode(opt.childId, opt.label)
                  ) : opt.outcomeType ? (
                    <div className="flex flex-col items-center">
                      <div className="h-2 w-2 rounded-full border-2 border-slate-300 bg-white mb-2"></div>
                      <div className={`px-4 py-3 rounded-lg border flex flex-col items-center text-center w-48 shadow-sm ${OUTCOME_COLORS[opt.outcomeType].bg} ${OUTCOME_COLORS[opt.outcomeType].border}`}>
                        {React.createElement(OUTCOME_COLORS[opt.outcomeType].icon, { className: `h-5 w-5 mb-1.5 ${OUTCOME_COLORS[opt.outcomeType].text}` })}
                        <span className={`text-xs font-semibold ${OUTCOME_COLORS[opt.outcomeType].text} uppercase tracking-wide mb-1`}>
                          {opt.outcomeType.replace('_', ' ')}
                        </span>
                        <span className="text-sm text-slate-700 font-medium leading-snug">
                          {opt.outcomeLabel || OUTCOME_LABELS[opt.outcomeType]}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center">
                      <Button variant="outline" className="border-dashed border-2 text-slate-500 h-10 px-4 rounded-lg bg-slate-50 hover:bg-slate-100 hover:border-slate-300">
                        <Plus className="h-4 w-4 mr-2" /> Add Next Step
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          
          {/* Add Option Button */}
          <div className="absolute top-0 right-0 translate-x-full h-full flex flex-col items-start pl-6">
            <div className="absolute top-0 left-0 w-6 h-px bg-slate-300 border-dashed"></div>
            <div className="relative pt-[16px]">
              <Button 
                variant="outline" 
                size="sm" 
                className="h-7 text-xs rounded-full border-dashed bg-white text-slate-500 hover:text-slate-800 shadow-sm"
                onClick={() => {
                  updateNode(node.id, { options: [...node.options, { label: "New Option" }] });
                }}
              >
                <Plus className="h-3 w-3 mr-1" /> Option
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900 font-sans selection:bg-blue-100 selection:text-blue-900">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-slate-200 px-6 py-4 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-4">
          <div className="h-8 w-8 bg-[#1B2A4A] rounded-md flex items-center justify-center">
            <GitBranch className="h-4 w-4 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-[#1B2A4A] leading-tight">Invoice Number Not in System</h1>
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span className="flex items-center gap-1"><Badge variant="secondary" className="h-5 px-1.5 font-normal">MAS Cancelled Trip</Badge></span>
              <span>•</span>
              <span>Last edited 2h ago</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" className="border-slate-200 text-slate-600 hover:bg-slate-50">
            Preview Flow
          </Button>
          <Button className="bg-[#3478F6] hover:bg-blue-600 text-white shadow-sm">
            Publish Changes
          </Button>
        </div>
      </header>

      {/* Canvas */}
      <main className="p-12 overflow-auto h-[calc(100vh-73px)]">
        <div className="flex justify-center min-w-max pb-32">
          {renderNode(tree.rootId)}
        </div>
      </main>
    </div>
  );
}

export default VerticalFlow;
