import React from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { 
  Settings, Trash2, HelpCircle, FileText, Image as ImageIcon, 
  Plus, X, ChevronDown, GitBranch, Send, Mail, Ban, PauseCircle,
  GripVertical, Info, Type
} from "lucide-react";

export function FlowNodeDetail() {
  return (
    <div className="min-h-screen bg-[#F8FAFC] py-12 px-6 flex flex-col items-center font-sans selection:bg-blue-100 selection:text-blue-900">
      <div className="w-full max-w-2xl flex flex-col items-center">
        
        {/* Top Connector */}
        <div className="w-px h-8 bg-slate-300"></div>

        {/* Main Node Card */}
        <Card className="w-full bg-white shadow-sm border-slate-200 overflow-visible relative">
          
          {/* Header */}
          <div className="bg-slate-50 border-b border-slate-100 p-3 rounded-t-xl flex justify-between items-center">
            <Badge variant="outline" className="bg-white text-slate-500 font-medium font-mono text-[10px] tracking-wider uppercase shadow-sm">
              Q2
            </Badge>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon" className="h-7 w-7 text-[#3478F6] bg-blue-50 hover:bg-blue-100 hover:text-blue-700 rounded-md">
                <Settings className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-md">
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <CardContent className="p-0">
            {/* Question Section */}
            <div className="p-5 border-b border-slate-100">
              <Label className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 block">Member Prompt / Question</Label>
              <Textarea 
                defaultValue="Can completion be verified by GPS, signature, and timestamps?"
                className="text-base font-medium text-slate-800 resize-none min-h-[60px] border-slate-200 focus-visible:ring-1 focus-visible:ring-[#3478F6] focus-visible:border-[#3478F6] bg-white shadow-sm"
              />
            </div>

            {/* Help Text Panel */}
            <div className="p-5 border-b border-slate-100 bg-slate-50/50">
              <div className="flex items-center gap-2 mb-2">
                <HelpCircle className="h-4 w-4 text-slate-400" />
                <Label className="text-xs font-semibold text-slate-700 uppercase tracking-wider">Help Text</Label>
              </div>
              <Textarea 
                defaultValue="All three pieces of evidence required"
                className="text-sm text-slate-700 resize-none min-h-[60px] border-slate-200 bg-white mb-2"
              />
              <div className="flex items-start gap-2 text-xs text-slate-500 bg-blue-50/50 p-2 rounded-md border border-blue-100">
                <Info className="h-3.5 w-3.5 text-blue-500 mt-0.5 shrink-0" />
                <p>Staff see this in a tooltip during the workflow. Use this for quick hints or definitions.</p>
              </div>
            </div>

            {/* Evidence Requirements Panel */}
            <div className="p-5 border-b border-slate-100">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-slate-400" />
                  <Label className="text-xs font-semibold text-slate-700 uppercase tracking-wider">Evidence Requirements</Label>
                </div>
                <Badge variant="secondary" className="bg-violet-50 text-violet-700 border-violet-200 font-normal">
                  3 Items
                </Badge>
              </div>

              <div className="space-y-3 mb-4">
                {/* Evidence Item 1 */}
                <div className="border border-slate-200 rounded-lg p-3 bg-white shadow-sm flex items-start gap-3 group">
                  <GripVertical className="h-4 w-4 text-slate-300 mt-2 cursor-grab" />
                  <div className="flex-1 space-y-3">
                    <div className="flex items-center justify-between">
                      <Input defaultValue="GPS Screenshot" className="h-8 text-sm font-medium border-transparent hover:border-slate-200 focus-visible:border-slate-300 focus-visible:ring-0 shadow-none px-2 -ml-2" />
                      <Button variant="ghost" size="icon" className="h-6 w-6 text-slate-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity">
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    <div className="flex items-center gap-4 text-xs">
                      <div className="flex items-center space-x-2">
                        <Switch id="req-1" defaultChecked />
                        <Label htmlFor="req-1" className="text-xs cursor-pointer text-slate-600">Required</Label>
                      </div>
                      <div className="w-px h-4 bg-slate-200"></div>
                      <div className="flex items-center gap-3">
                        <span className="text-slate-500">Accepts:</span>
                        <div className="flex items-center space-x-1.5">
                          <Switch id="img-1" defaultChecked className="scale-75 data-[state=checked]:bg-[#3478F6]" />
                          <Label htmlFor="img-1" className="text-xs cursor-pointer flex items-center gap-1 text-slate-600"><ImageIcon className="h-3 w-3" /> Image</Label>
                        </div>
                        <div className="flex items-center space-x-1.5">
                          <Switch id="txt-1" className="scale-75" />
                          <Label htmlFor="txt-1" className="text-xs cursor-pointer flex items-center gap-1 text-slate-600"><Type className="h-3 w-3" /> Text</Label>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Evidence Item 2 */}
                <div className="border border-slate-200 rounded-lg p-3 bg-white shadow-sm flex items-start gap-3 group">
                  <GripVertical className="h-4 w-4 text-slate-300 mt-2 cursor-grab" />
                  <div className="flex-1 space-y-3">
                    <div className="flex items-center justify-between">
                      <Input defaultValue="Signed Member Receipt" className="h-8 text-sm font-medium border-transparent hover:border-slate-200 focus-visible:border-slate-300 focus-visible:ring-0 shadow-none px-2 -ml-2" />
                      <Button variant="ghost" size="icon" className="h-6 w-6 text-slate-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity">
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    <div className="flex items-center gap-4 text-xs">
                      <div className="flex items-center space-x-2">
                        <Switch id="req-2" defaultChecked />
                        <Label htmlFor="req-2" className="text-xs cursor-pointer text-slate-600">Required</Label>
                      </div>
                      <div className="w-px h-4 bg-slate-200"></div>
                      <div className="flex items-center gap-3">
                        <span className="text-slate-500">Accepts:</span>
                        <div className="flex items-center space-x-1.5">
                          <Switch id="img-2" defaultChecked className="scale-75 data-[state=checked]:bg-[#3478F6]" />
                          <Label htmlFor="img-2" className="text-xs cursor-pointer flex items-center gap-1 text-slate-600"><ImageIcon className="h-3 w-3" /> Image</Label>
                        </div>
                        <div className="flex items-center space-x-1.5">
                          <Switch id="txt-2" className="scale-75" />
                          <Label htmlFor="txt-2" className="text-xs cursor-pointer flex items-center gap-1 text-slate-600"><Type className="h-3 w-3" /> Text</Label>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Evidence Item 3 */}
                <div className="border border-slate-200 rounded-lg p-3 bg-white shadow-sm flex items-start gap-3 group">
                  <GripVertical className="h-4 w-4 text-slate-300 mt-2 cursor-grab" />
                  <div className="flex-1 space-y-3">
                    <div className="flex items-center justify-between">
                      <Input defaultValue="MAS Portal Screenshot" className="h-8 text-sm font-medium border-transparent hover:border-slate-200 focus-visible:border-slate-300 focus-visible:ring-0 shadow-none px-2 -ml-2" />
                      <Button variant="ghost" size="icon" className="h-6 w-6 text-slate-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity">
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    <div className="flex items-center gap-4 text-xs">
                      <div className="flex items-center space-x-2">
                        <Switch id="req-3" defaultChecked />
                        <Label htmlFor="req-3" className="text-xs cursor-pointer text-slate-600">Required</Label>
                      </div>
                      <div className="w-px h-4 bg-slate-200"></div>
                      <div className="flex items-center gap-3">
                        <span className="text-slate-500">Accepts:</span>
                        <div className="flex items-center space-x-1.5">
                          <Switch id="img-3" defaultChecked className="scale-75 data-[state=checked]:bg-[#3478F6]" />
                          <Label htmlFor="img-3" className="text-xs cursor-pointer flex items-center gap-1 text-slate-600"><ImageIcon className="h-3 w-3" /> Image</Label>
                        </div>
                        <div className="flex items-center space-x-1.5">
                          <Switch id="txt-3" className="scale-75" />
                          <Label htmlFor="txt-3" className="text-xs cursor-pointer flex items-center gap-1 text-slate-600"><Type className="h-3 w-3" /> Text</Label>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              
              <Button variant="outline" className="w-full border-dashed border-2 text-slate-500 hover:text-slate-700 hover:border-slate-400 bg-slate-50 h-9 text-xs">
                <Plus className="h-3.5 w-3.5 mr-2" /> Add Evidence Requirement
              </Button>
            </div>

            {/* Instructions Panel */}
            <div className="p-5 bg-slate-50/50 rounded-b-xl">
              <div className="flex items-center gap-2 mb-3">
                <Info className="h-4 w-4 text-slate-400" />
                <Label className="text-xs font-semibold text-slate-700 uppercase tracking-wider">Detailed Instructions & SOP</Label>
              </div>
              
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label className="text-xs text-slate-500">Step-by-step Instructions</Label>
                  <Textarea 
                    defaultValue="1. Log into MAS portal and navigate to Manage Trips.&#10;2. Search by Invoice number provided in dispatch history.&#10;3. Verify status shows 'Cancelled' but notes indicate 'Completed'.&#10;4. Check for GPS breadcrumbs matching destination."
                    className="text-sm text-slate-700 resize-none min-h-[100px] border-slate-200 bg-white leading-relaxed"
                  />
                </div>
                
                <div className="space-y-1.5">
                  <Label className="text-xs text-slate-500">Reference Image URL</Label>
                  <div className="flex gap-2">
                    <Input defaultValue="https://agape-nemt.com/assets/sop/mas-portal-search.jpg" className="text-sm bg-white" />
                    <Button variant="outline" size="icon" className="shrink-0">
                      <ImageIcon className="h-4 w-4 text-slate-500" />
                    </Button>
                  </div>
                </div>
              </div>
            </div>

          </CardContent>
        </Card>

        {/* Bottom Stem & Branches */}
        <div className="flex flex-col items-center w-full">
          <div className="w-px h-8 bg-slate-300"></div>
          
          <div className="relative w-[120%] max-w-[800px] flex justify-between px-10">
            {/* Horizontal Line connecting branches */}
            <div className="absolute top-0 left-[25%] right-[25%] h-px bg-slate-300"></div>

            {/* Option 1 Branch */}
            <div className="flex flex-col items-center relative w-1/2">
              <div className="w-px h-6 bg-slate-300"></div>
              
              <div className="relative z-10 w-full max-w-[280px]">
                <div className="bg-white border border-slate-200 hover:border-[#3478F6] shadow-sm rounded-lg p-3 cursor-pointer group transition-all duration-200 hover:shadow-md">
                  <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Option Label</div>
                  <div className="flex items-center justify-between mb-3">
                    <div className="text-sm font-medium text-slate-800">Yes, all evidence available</div>
                    <ChevronDown className="h-4 w-4 text-slate-400 group-hover:text-[#3478F6]" />
                  </div>
                  <div className="flex items-center gap-2 text-xs font-medium text-slate-600 bg-slate-50 p-2 rounded border border-slate-100">
                    <GitBranch className="h-3.5 w-3.5 text-slate-400" /> Ask Sub-question
                  </div>
                </div>
                {/* Visual indicator of flow continuing */}
                <div className="flex justify-center mt-2">
                  <div className="h-2 w-2 rounded-full border-2 border-slate-300 bg-white"></div>
                </div>
              </div>
            </div>

            {/* Option 2 Branch with Open Dropdown */}
            <div className="flex flex-col items-center relative w-1/2">
              <div className="w-px h-6 bg-slate-300"></div>
              
              <div className="relative z-10 w-full max-w-[280px]">
                <div className="bg-white border border-[#3478F6] shadow-md rounded-lg rounded-b-none p-3 relative z-20">
                  <div className="text-xs font-semibold text-[#3478F6] uppercase tracking-wider mb-1">Option Label</div>
                  <div className="flex items-center justify-between mb-3">
                    <Input defaultValue="No, missing documentation" className="h-7 text-sm font-medium border-transparent bg-slate-50 px-2 -ml-2 w-[90%]" />
                    <ChevronDown className="h-4 w-4 text-[#3478F6] rotate-180 transition-transform" />
                  </div>
                  <div className="flex items-center gap-2 text-xs font-medium text-amber-700 bg-amber-50 p-2 rounded border border-amber-200">
                    <PauseCircle className="h-3.5 w-3.5" /> Place on Hold
                  </div>
                </div>
                
                {/* Mock Dropdown Menu */}
                <div className="absolute top-full left-0 w-full bg-white border border-slate-200 rounded-b-lg shadow-xl z-30 overflow-hidden flex flex-col py-1">
                  <div className="px-3 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wider bg-slate-50 border-b border-slate-100 mb-1">Next Step / Outcome</div>
                  
                  <button className="flex items-center gap-3 px-3 py-2 hover:bg-slate-50 w-full text-left">
                    <GitBranch className="h-4 w-4 text-slate-400" />
                    <span className="text-sm font-medium text-slate-700">Ask Sub-question</span>
                  </button>
                  
                  <div className="h-px bg-slate-100 my-1 mx-3"></div>
                  
                  <button className="flex items-center gap-3 px-3 py-2 hover:bg-slate-50 w-full text-left">
                    <Send className="h-4 w-4 text-green-600" />
                    <span className="text-sm font-medium text-slate-700">Submit Portal Dispute</span>
                  </button>
                  
                  <button className="flex items-center gap-3 px-3 py-2 hover:bg-slate-50 w-full text-left">
                    <Mail className="h-4 w-4 text-blue-600" />
                    <span className="text-sm font-medium text-slate-700">Email Dispute</span>
                  </button>
                  
                  <button className="flex items-center gap-3 px-3 py-2 hover:bg-slate-50 w-full text-left">
                    <Ban className="h-4 w-4 text-red-600" />
                    <span className="text-sm font-medium text-slate-700">Resolve Internally</span>
                  </button>
                  
                  <button className="flex items-center gap-3 px-3 py-2 bg-amber-50 w-full text-left border-l-2 border-amber-500 relative">
                    <PauseCircle className="h-4 w-4 text-amber-600" />
                    <span className="text-sm font-medium text-amber-800">Place on Hold</span>
                  </button>
                </div>
              </div>
            </div>

          </div>
        </div>

      </div>
    </div>
  );
}

export default FlowNodeDetail;
