import React, { useState, useRef, useEffect } from "react";
import {
  MousePointer2, Hand, ZoomIn, ZoomOut, Maximize, Settings, FileText, Send, Ban, PauseCircle, Mail, HelpCircle, AlertCircle
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type OutcomeType = "portal_dispute" | "dispute" | "internal" | "hold";

const OUTCOME_COLORS: Record<OutcomeType, { bg: string; text: string; border: string; icon: React.ReactNode }> = {
  portal_dispute: { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-300", icon: <Send className="h-4 w-4" /> },
  dispute: { bg: "bg-blue-50", text: "text-blue-700", border: "border-blue-300", icon: <Mail className="h-4 w-4" /> },
  internal: { bg: "bg-rose-50", text: "text-rose-700", border: "border-rose-300", icon: <Ban className="h-4 w-4" /> },
  hold: { bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-300", icon: <PauseCircle className="h-4 w-4" /> },
};

// Hardcoded layout for the perfect mockup
const NODES = [
  { id: "q1", x: 100, y: 150, width: 280, height: 120, type: "question", question: "Was the trip completed before MAS cancelled it?", options: 2, isRoot: true },
  { id: "q2", x: 550, y: 300, width: 280, height: 120, type: "question", question: "Can completion be verified by GPS, signature, and timestamps?", options: 2, evidence: 3 },
  { id: "q3", x: 1000, y: 450, width: 280, height: 120, type: "question", question: "Did MAS cancel after drop-off was finalized?", options: 2 },
  { id: "q4", x: 1450, y: 600, width: 280, height: 120, type: "question", question: "Is Correction Request available in MAS portal?", options: 2 },
  
  { id: "o1", x: 550, y: 150, width: 220, height: 60, type: "outcome", outcomeType: "internal", label: "Resolve Internally" },
  { id: "o2", x: 1000, y: 300, width: 220, height: 60, type: "outcome", outcomeType: "hold", label: "Place on Hold" },
  { id: "o3", x: 1450, y: 450, width: 220, height: 60, type: "outcome", outcomeType: "internal", label: "Not correctable" },
  { id: "o4", x: 1900, y: 550, width: 220, height: 60, type: "outcome", outcomeType: "portal_dispute", label: "Submit Portal Dispute" },
  { id: "o5", x: 1900, y: 650, width: 220, height: 60, type: "outcome", outcomeType: "dispute", label: "Send Dispute Email" },
];

const CONNECTIONS = [
  { id: "c1", from: "q1", to: "q2", label: "Yes, trip was completed", fromOffset: 40, toOffset: 60, color: "#94a3b8" },
  { id: "c2", from: "q1", to: "o1", label: "No, trip was not completed", fromOffset: 80, toOffset: 30, color: "#f43f5e" },
  
  { id: "c3", from: "q2", to: "q3", label: "Yes, all evidence available", fromOffset: 40, toOffset: 60, color: "#94a3b8" },
  { id: "c4", from: "q2", to: "o2", label: "No, missing documentation", fromOffset: 80, toOffset: 30, color: "#f59e0b" },
  
  { id: "c5", from: "q3", to: "q4", label: "Yes, cancelled after completion", fromOffset: 40, toOffset: 60, color: "#94a3b8" },
  { id: "c6", from: "q3", to: "o3", label: "No, cancelled before completion", fromOffset: 80, toOffset: 30, color: "#f43f5e" },
  
  { id: "c7", from: "q4", to: "o4", label: "Yes, available", fromOffset: 40, toOffset: 30, color: "#10b981" },
  { id: "c8", from: "q4", to: "o5", label: "No, not available", fromOffset: 80, toOffset: 30, color: "#3b82f6" },
];

export function CanvasFullTree() {
  const [zoom, setZoom] = useState(0.65);
  const [pan, setPan] = useState({ x: 50, y: 50 });
  const [tool, setTool] = useState<"select" | "pan">("pan");
  const containerRef = useRef<HTMLDivElement>(null);

  return (
    <div className="h-[100dvh] w-full flex flex-col bg-slate-50 overflow-hidden font-sans text-slate-900">
      {/* Top Bar */}
      <header className="flex-none h-14 bg-white border-b border-slate-200 flex items-center justify-between px-4 z-20 relative shadow-sm">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="font-semibold text-sm leading-tight text-slate-900">Decision Tree Overview</h1>
            <p className="text-xs text-slate-500 leading-tight">4 Question Nodes • 5 Outcome Paths • 4 Levels</p>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <div className="flex items-center bg-slate-100 p-1 rounded-md mr-2">
            <Button 
              variant={tool === "select" ? "secondary" : "ghost"} 
              size="icon" 
              className="h-7 w-7" 
              onClick={() => setTool("select")}
            >
              <MousePointer2 className="h-4 w-4" />
            </Button>
            <Button 
              variant={tool === "pan" ? "secondary" : "ghost"} 
              size="icon" 
              className="h-7 w-7"
              onClick={() => setTool("pan")}
            >
              <Hand className="h-4 w-4" />
            </Button>
          </div>

          <div className="flex items-center bg-slate-100 p-1 rounded-md mr-4">
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setZoom(z => Math.max(0.2, z - 0.1))}>
              <ZoomOut className="h-4 w-4" />
            </Button>
            <span className="text-xs font-medium w-12 text-center">{Math.round(zoom * 100)}%</span>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setZoom(z => Math.min(2, z + 0.1))}>
              <ZoomIn className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setZoom(0.65); setPan({x: 50, y: 50}); }}>
              <Maximize className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      {/* Canvas Area */}
      <div 
        ref={containerRef}
        className={`flex-1 relative overflow-hidden bg-[#f8fafc] ${tool === "pan" ? "cursor-grab" : ""}`}
      >
        {/* Dot Grid Background */}
        <div 
          className="absolute inset-0 pointer-events-none opacity-20"
          style={{
            backgroundImage: 'radial-gradient(#94a3b8 2px, transparent 2px)',
            backgroundSize: `${30 * zoom}px ${30 * zoom}px`,
            backgroundPosition: `${pan.x}px ${pan.y}px`,
          }}
        />

        {/* Scaled/Panned Container */}
        <div 
          className="absolute origin-top-left transition-transform duration-75"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          }}
        >
          {/* SVG Connections */}
          <svg className="absolute inset-0 overflow-visible pointer-events-none z-0">
            {CONNECTIONS.map(conn => {
              const fromNode = NODES.find(n => n.id === conn.from)!;
              const toNode = NODES.find(n => n.id === conn.to)!;
              
              const startX = fromNode.x + fromNode.width;
              const startY = fromNode.y + conn.fromOffset;
              
              const endX = toNode.x;
              const endY = toNode.y + conn.toOffset;
              
              const cpOffset = Math.max(Math.abs(endX - startX) * 0.4, 50);
              
              const pathD = `M ${startX} ${startY} C ${startX + cpOffset} ${startY}, ${endX - cpOffset} ${endY}, ${endX} ${endY}`;
              
              // Midpoint for label
              const midX = (startX + endX) / 2;
              const midY = (startY + endY) / 2;

              return (
                <g key={conn.id}>
                  <path 
                    d={pathD} 
                    fill="none" 
                    stroke={conn.color} 
                    strokeWidth="4" 
                    className="opacity-40"
                  />
                  {/* Target arrow */}
                  <path 
                    d={`M ${endX - 10} ${endY - 6} L ${endX} ${endY} L ${endX - 10} ${endY + 6}`}
                    fill="none"
                    stroke={conn.color}
                    strokeWidth="4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="opacity-60"
                  />
                  {/* Origin dot */}
                  <circle cx={startX} cy={startY} r="6" fill={conn.color} />
                  
                  {/* Connection Label */}
                  <foreignObject x={midX - 100} y={midY - 12} width="200" height="24" className="overflow-visible">
                    <div className="flex justify-center">
                      <span className="bg-white/90 backdrop-blur-sm px-2 py-0.5 rounded-md text-[11px] font-medium text-slate-600 border border-slate-200/50 shadow-sm whitespace-nowrap">
                        {conn.label}
                      </span>
                    </div>
                  </foreignObject>
                </g>
              );
            })}
          </svg>

          {/* Nodes */}
          {NODES.map(node => {
            if (node.type === "question") {
              return (
                <div 
                  key={node.id}
                  className="absolute bg-white rounded-xl border border-slate-200 shadow-sm z-10"
                  style={{ left: node.x, top: node.y, width: node.width, height: node.height }}
                >
                  {node.isRoot && (
                    <div className="absolute -top-3 left-4 bg-[#E85D3A] text-white text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider shadow-sm">
                      Root
                    </div>
                  )}
                  {node.evidence && (
                    <div className="absolute -top-3 right-4 bg-slate-800 text-white text-[10px] font-bold px-2 py-0.5 rounded-full shadow-sm flex items-center gap-1">
                      <FileText className="h-3 w-3" />
                      {node.evidence} evidence
                    </div>
                  )}
                  <div className="p-4 h-full flex flex-col">
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-slate-800 leading-snug">{node.question}</p>
                    </div>
                    <div className="flex items-center justify-between mt-auto pt-3 border-t border-slate-100">
                      <span className="text-xs text-slate-500 font-medium">{node.options} Options</span>
                      <div className="flex gap-1">
                        <div className="w-4 h-4 rounded-full bg-slate-100 flex items-center justify-center"><div className="w-1.5 h-1.5 rounded-full bg-slate-400"></div></div>
                        <div className="w-4 h-4 rounded-full bg-slate-100 flex items-center justify-center"><div className="w-1.5 h-1.5 rounded-full bg-rose-400"></div></div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            } else {
              const colors = OUTCOME_COLORS[node.outcomeType as OutcomeType];
              return (
                <div 
                  key={node.id}
                  className={`absolute rounded-full border shadow-sm z-10 flex items-center px-4 gap-3 ${colors.bg} ${colors.border}`}
                  style={{ left: node.x, top: node.y, width: node.width, height: node.height }}
                >
                  <div className={`w-8 h-8 rounded-full bg-white flex items-center justify-center shadow-sm ${colors.text}`}>
                    {colors.icon}
                  </div>
                  <span className={`text-sm font-semibold ${colors.text}`}>{node.label}</span>
                </div>
              );
            }
          })}
        </div>
      </div>

      {/* Minimap Overlay */}
      <div className="absolute bottom-6 right-6 w-48 h-32 bg-white rounded-lg border border-slate-200 shadow-lg z-30 overflow-hidden flex flex-col">
        <div className="bg-slate-50 border-b border-slate-100 px-3 py-1.5 flex justify-between items-center">
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">Minimap</span>
        </div>
        <div className="flex-1 relative bg-slate-50/50 p-2">
          {/* Mini-nodes mapping to layout */}
          <div className="absolute inset-2">
            {NODES.map(n => {
              const xRatio = n.x / 2000;
              const yRatio = n.y / 800;
              const wRatio = n.width / 2000;
              const hRatio = n.height / 800;
              
              const isQ = n.type === "question";
              let color = "#cbd5e1";
              if (!isQ) {
                if (n.outcomeType === "internal") color = "#fca5a5";
                if (n.outcomeType === "hold") color = "#fcd34d";
                if (n.outcomeType === "portal_dispute") color = "#6ee7b7";
                if (n.outcomeType === "dispute") color = "#93c5fd";
              }
              
              return (
                <div 
                  key={`mini-${n.id}`}
                  className="absolute rounded-sm"
                  style={{
                    left: `${xRatio * 100}%`,
                    top: `${yRatio * 100}%`,
                    width: `${wRatio * 100}%`,
                    height: `${hRatio * 100}%`,
                    backgroundColor: isQ ? "white" : color,
                    border: isQ ? "1px solid #cbd5e1" : "none"
                  }}
                />
              )
            })}
            {/* Viewport Box */}
            <div 
              className="absolute border border-blue-500 bg-blue-500/10 rounded-sm pointer-events-none"
              style={{
                left: '2%', top: '10%', width: '40%', height: '50%'
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
