import React from "react";
import { 
  Plus, X, HelpCircle, ChevronDown, ChevronRight, 
  FileText, Copy, Play, GitBranch, ArrowRight, Layers, 
  Send, Ban, PauseCircle, Mail, Info, Image as ImageIcon, 
  Camera, Upload, Save, Settings, ZoomIn, ZoomOut, Maximize, MousePointer2, Hand, GripHorizontal, 
  Check, Trash2, Link as LinkIcon, Type
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export default function CanvasNodeDetail() {
  return (
    <div className="h-[100dvh] w-full flex flex-col bg-[#f8fafc] overflow-hidden font-sans text-slate-900 relative">
      {/* Background Grid Pattern */}
      <div 
        className="absolute inset-0 pointer-events-none opacity-30"
        style={{
          backgroundImage: 'radial-gradient(#94a3b8 1px, transparent 1px)',
          backgroundSize: '24px 24px',
          backgroundPosition: '12px 12px',
        }}
      />

      {/* SVG Connections Layer */}
      <svg className="absolute inset-0 overflow-visible pointer-events-none z-0">
        <defs>
          <marker id="arrowhead-gray" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
            <polygon points="0 0, 10 3.5, 0 7" fill="#94a3b8" />
          </marker>
          <marker id="arrowhead-blue" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
            <polygon points="0 0, 10 3.5, 0 7" fill="#3b82f6" />
          </marker>
        </defs>

        {/* Q1 to Q2 */}
        <path 
          d="M 400 180 C 450 180, 480 220, 520 220" 
          fill="none" 
          stroke="#94a3b8" 
          strokeWidth="3" 
          className="opacity-60"
          markerEnd="url(#arrowhead-gray)"
        />
        
        {/* Q2 to Q3 */}
        <path 
          d="M 880 320 C 940 320, 960 200, 1040 200" 
          fill="none" 
          stroke="#3b82f6" 
          strokeWidth="4" 
          className="opacity-90 drop-shadow-md"
          markerEnd="url(#arrowhead-blue)"
        />
      </svg>

      {/* Scaled/Panned Container */}
      <div className="absolute inset-0 z-10">
        {/* Node 1: Unselected Context */}
        <div 
          className="absolute bg-white rounded-xl border border-slate-200 shadow-sm opacity-60 hover:opacity-100 transition-opacity"
          style={{ left: 80, top: 80, width: 320 }}
        >
          <div className="absolute -top-3 left-4 bg-[#E85D3A] text-white text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">
            Root
          </div>
          <div className="p-4 border-b border-slate-100 bg-slate-50/50 rounded-t-xl">
            <Label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Question 1</Label>
            <p className="text-sm font-medium mt-1">Was the trip completed before MAS cancelled it?</p>
          </div>
          <div className="p-3 space-y-2">
            <div className="flex items-center gap-2">
              <div className="h-8 text-xs flex-1 border border-slate-200 bg-slate-50 rounded-md px-3 flex items-center">
                Yes, trip was completed
              </div>
              <div className="w-[100px] flex-none h-8 border border-slate-200 bg-slate-50 rounded-md px-2 flex items-center justify-between text-xs text-slate-500">
                <span>Sub-Q</span>
                <ChevronDown className="h-3 w-3" />
              </div>
            </div>
            {/* Output Port */}
            <div className="absolute right-[-6px] top-[180px] w-3 h-3 bg-slate-100 border-2 border-slate-400 rounded-full" />
          </div>
        </div>

        {/* Node 2: SELECTED - Fully Expanded */}
        <div 
          className="absolute bg-white rounded-xl border-2 border-[#3478F6] shadow-xl ring-4 ring-[#3478F6]/20 z-20"
          style={{ left: 520, top: 120, width: 360 }}
        >
          {/* Input Port */}
          <div className="absolute top-[100px] -left-2 w-4 h-4 bg-white border-2 border-[#3478F6] rounded-full z-10" />
          
          {/* Output Ports */}
          <div className="absolute right-[-6px] top-[320px] w-3 h-3 bg-[#3478F6] border-2 border-white rounded-full z-10 shadow-sm" />
          <div className="absolute right-[-6px] top-[376px] w-3 h-3 bg-slate-100 border-2 border-slate-400 rounded-full z-10" />

          {/* Header */}
          <div className="p-4 border-b border-slate-100 bg-slate-50/80 rounded-t-xl">
            <div className="flex justify-between items-center mb-3">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-[#3478F6]"></div>
                <Label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Edit Node</Label>
              </div>
              <div className="flex gap-1">
                <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-400 hover:text-slate-600">
                  <Copy className="h-3.5 w-3.5" />
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-400 hover:text-rose-600">
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
            
            <div className="space-y-4">
              <div>
                <Label className="text-xs text-slate-500 mb-1.5 block">Question Text</Label>
                <Textarea 
                  defaultValue="Can completion be verified by GPS, signature, and timestamps?"
                  className="min-h-[70px] resize-none text-sm font-medium border-slate-200 focus-visible:ring-1 focus-visible:ring-[#3478F6] shadow-inner bg-white leading-relaxed"
                />
              </div>

              <div>
                <Label className="text-xs text-slate-500 mb-1.5 block">Help Text (Optional)</Label>
                <Textarea 
                  defaultValue="All three pieces of evidence required"
                  className="min-h-[40px] resize-y text-xs bg-white border-slate-200 focus-visible:ring-1 focus-visible:ring-[#3478F6] shadow-inner font-medium text-slate-700 leading-relaxed"
                />
              </div>

              <div>
                <Label className="text-xs text-slate-500 mb-1.5 block">Step-by-Step Instructions</Label>
                <Textarea 
                  defaultValue="1. Log into MAS portal and navigate to Manage Trips.&#10;2. Search for the invoice number.&#10;3. Take a full-screen screenshot showing the status and timestamps.&#10;4. Ensure the screenshot captures the entire page including the URL."
                  className="min-h-[80px] resize-none text-xs bg-white border-slate-200 focus-visible:ring-1 focus-visible:ring-[#3478F6] shadow-inner font-medium text-slate-700 leading-relaxed"
                />
              </div>
            </div>
          </div>

          <div className="p-4 space-y-5">
            {/* Evidence Requirements */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label className="text-xs font-bold text-slate-700">Evidence Requirements</Label>
                <Button variant="ghost" size="sm" className="h-6 text-[10px] text-[#3478F6] px-2 hover:bg-blue-50">
                  <Plus className="h-3 w-3 mr-1" /> Add Evidence
                </Button>
              </div>
              
              <div className="space-y-2">
                <div className="flex items-start gap-2 bg-slate-50 border border-slate-200 p-2.5 rounded-lg relative group">
                  <GripHorizontal className="h-4 w-4 text-slate-300 mt-1 cursor-grab" />
                  <div className="flex-1 space-y-2">
                    <Input defaultValue="GPS Screenshot" className="h-7 text-xs bg-white font-medium" />
                    <div className="flex items-center justify-between">
                      <div className="flex gap-2">
                        <Badge variant="outline" className="text-[9px] h-5 bg-white border-slate-200 text-slate-500 gap-1 rounded-sm">
                          <ImageIcon className="h-2.5 w-2.5" /> Image
                        </Badge>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Label className="text-[10px] text-slate-500">Required</Label>
                        <Switch defaultChecked className="scale-75 data-[state=checked]:bg-[#3478F6]" />
                      </div>
                    </div>
                  </div>
                  <Button variant="ghost" size="icon" className="h-5 w-5 absolute top-2 right-2 opacity-0 group-hover:opacity-100 text-slate-400 hover:text-rose-500 transition-opacity">
                    <X className="h-3 w-3" />
                  </Button>
                </div>

                <div className="flex items-start gap-2 bg-slate-50 border border-slate-200 p-2.5 rounded-lg relative group">
                  <GripHorizontal className="h-4 w-4 text-slate-300 mt-1 cursor-grab" />
                  <div className="flex-1 space-y-2">
                    <Input defaultValue="Signed Member Receipt" className="h-7 text-xs bg-white font-medium" />
                    <div className="flex items-center justify-between">
                      <div className="flex gap-2">
                        <Badge variant="outline" className="text-[9px] h-5 bg-white border-slate-200 text-slate-500 gap-1 rounded-sm">
                          <ImageIcon className="h-2.5 w-2.5" /> Image
                        </Badge>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Label className="text-[10px] text-slate-500">Required</Label>
                        <Switch defaultChecked className="scale-75 data-[state=checked]:bg-[#3478F6]" />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex items-start gap-2 bg-slate-50 border border-slate-200 p-2.5 rounded-lg relative group">
                  <GripHorizontal className="h-4 w-4 text-slate-300 mt-1 cursor-grab" />
                  <div className="flex-1 space-y-2">
                    <Input defaultValue="MAS Portal Screenshot" className="h-7 text-xs bg-white font-medium" />
                    <div className="flex items-center justify-between">
                      <div className="flex gap-2">
                        <Badge variant="outline" className="text-[9px] h-5 bg-white border-slate-200 text-slate-500 gap-1 rounded-sm">
                          <ImageIcon className="h-2.5 w-2.5" /> Image
                        </Badge>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Label className="text-[10px] text-slate-500">Required</Label>
                        <Switch defaultChecked className="scale-75 data-[state=checked]:bg-[#3478F6]" />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <Separator className="bg-slate-100" />

            {/* Options */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label className="text-xs font-bold text-slate-700">Options</Label>
                <Button variant="ghost" size="sm" className="h-6 text-[10px] text-[#3478F6] px-2 hover:bg-blue-50">
                  <Plus className="h-3 w-3 mr-1" /> Add Option
                </Button>
              </div>

              <div className="space-y-3">
                {/* Option 1: Linked to Sub-Question */}
                <div className="flex gap-2 items-start">
                  <div className="flex-1 space-y-1.5">
                    <Input defaultValue="Yes, all evidence available" className="h-8 text-xs border-slate-200 bg-white" />
                    <div className="flex items-center gap-1.5">
                      <div className="h-7 flex-1 border border-slate-200 bg-slate-50 rounded-md px-2 flex items-center justify-between text-xs text-slate-600">
                        <div className="flex items-center gap-1.5">
                          <LinkIcon className="h-3 w-3 text-slate-400" />
                          <span>Link to Sub-Question</span>
                        </div>
                        <ChevronDown className="h-3 w-3 text-slate-400" />
                      </div>
                    </div>
                  </div>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-rose-500 mt-0">
                    <X className="h-4 w-4" />
                  </Button>
                </div>

                {/* Option 2: Outcome Dropdown Open */}
                <div className="flex gap-2 items-start">
                  <div className="flex-1 space-y-1.5">
                    <Input defaultValue="No, missing documentation" className="h-8 text-xs border-slate-200 bg-white" />
                    
                    {/* Fake Open Dropdown */}
                    <div className="relative">
                      <div className="h-7 w-full border border-blue-400 ring-1 ring-blue-400 ring-offset-1 bg-white rounded-md px-2 flex items-center justify-between text-xs text-slate-700 shadow-sm z-30">
                        <div className="flex items-center gap-1.5">
                          <div className="w-2 h-2 rounded-full bg-amber-500"></div>
                          <span className="font-medium">Place on Hold</span>
                        </div>
                        <ChevronDown className="h-3 w-3 text-blue-500" />
                      </div>
                      
                      {/* Dropdown Menu */}
                      <div className="absolute top-full left-0 w-[240px] mt-1 bg-white border border-slate-200 rounded-md shadow-lg overflow-hidden z-50">
                        <div className="px-2 py-1.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wider bg-slate-50 border-b border-slate-100">
                          Select Action
                        </div>
                        <div className="p-1 space-y-0.5">
                          <div className="flex items-center gap-2 px-2 py-1.5 hover:bg-slate-50 rounded text-xs cursor-pointer text-slate-700">
                            <LinkIcon className="h-3.5 w-3.5 text-slate-400" />
                            <span>Link to Sub-Question</span>
                          </div>
                          <div className="h-px bg-slate-100 my-1 mx-2" />
                          <div className="flex items-center gap-2 px-2 py-1.5 hover:bg-emerald-50 rounded text-xs cursor-pointer text-slate-700 group">
                            <div className="w-2 h-2 rounded-full bg-emerald-500 group-hover:scale-110 transition-transform"></div>
                            <span>Submit Portal Dispute</span>
                          </div>
                          <div className="flex items-center gap-2 px-2 py-1.5 hover:bg-blue-50 rounded text-xs cursor-pointer text-slate-700 group">
                            <div className="w-2 h-2 rounded-full bg-blue-500 group-hover:scale-110 transition-transform"></div>
                            <span>Send Dispute Email</span>
                          </div>
                          <div className="flex items-center gap-2 px-2 py-1.5 bg-amber-50 rounded text-xs cursor-pointer text-slate-900 font-medium group">
                            <div className="w-2 h-2 rounded-full bg-amber-500 group-hover:scale-110 transition-transform"></div>
                            <span>Place on Hold</span>
                            <Check className="h-3 w-3 ml-auto text-amber-600" />
                          </div>
                          <div className="flex items-center gap-2 px-2 py-1.5 hover:bg-rose-50 rounded text-xs cursor-pointer text-slate-700 group">
                            <div className="w-2 h-2 rounded-full bg-rose-500 group-hover:scale-110 transition-transform"></div>
                            <span>Resolve Internally</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-rose-500 mt-0">
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Node 3: Unselected Context */}
        <div 
          className="absolute bg-white rounded-xl border border-slate-200 shadow-sm opacity-70 hover:opacity-100 transition-opacity"
          style={{ left: 1040, top: 120, width: 320 }}
        >
          <div className="absolute top-10 -left-2 w-4 h-4 bg-white border-2 border-slate-300 rounded-full" />
          <div className="p-4 border-b border-slate-100 bg-slate-50/50 rounded-t-xl">
            <Label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Question 3</Label>
            <p className="text-sm font-medium mt-1">Did MAS cancel after drop-off was finalized?</p>
          </div>
          <div className="p-3 space-y-2">
            <div className="flex items-center gap-2">
              <div className="h-8 text-xs flex-1 border border-slate-200 bg-slate-50 rounded-md px-3 flex items-center">
                Yes, cancelled after completion
              </div>
              <div className="w-[100px] flex-none h-8 border border-slate-200 bg-slate-50 rounded-md px-2 flex items-center justify-between text-xs text-slate-500">
                <span>Sub-Q</span>
                <ChevronDown className="h-3 w-3" />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-8 text-xs flex-1 border border-slate-200 bg-slate-50 rounded-md px-3 flex items-center">
                No, cancelled before
              </div>
              <div className="w-[100px] flex-none h-8 border border-rose-200 bg-rose-50 rounded-md px-2 flex items-center justify-start gap-1.5 text-xs text-rose-700 font-medium">
                <div className="w-1.5 h-1.5 rounded-full bg-rose-500"></div>
                Internal
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Floating Zoom Controls */}
      <div className="absolute bottom-6 right-6 flex items-center bg-white border border-slate-200 rounded-lg shadow-md overflow-hidden z-40">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-9 w-9 rounded-none text-slate-500 hover:text-slate-900 hover:bg-slate-50">
                <ZoomOut className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Zoom Out</TooltipContent>
          </Tooltip>
          <div className="w-px h-5 bg-slate-200 mx-0.5" />
          <div className="px-3 text-xs font-medium text-slate-600 select-none">100%</div>
          <div className="w-px h-5 bg-slate-200 mx-0.5" />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-9 w-9 rounded-none text-slate-500 hover:text-slate-900 hover:bg-slate-50">
                <ZoomIn className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Zoom In</TooltipContent>
          </Tooltip>
          <div className="w-px h-5 bg-slate-200 mx-0.5" />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-9 w-9 rounded-none text-slate-500 hover:text-slate-900 hover:bg-slate-50">
                <Maximize className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Fit to Screen</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </div>
  );
}
