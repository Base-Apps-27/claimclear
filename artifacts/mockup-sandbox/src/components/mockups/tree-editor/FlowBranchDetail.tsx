import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Send, Mail, Ban, Plus, MoreVertical, HelpCircle, FileText, ChevronDown, GitBranch } from "lucide-react";

export function FlowBranchDetail() {
  return (
    <div className="min-h-[100dvh] bg-[#F8FAFC] font-sans selection:bg-blue-100 selection:text-blue-900 overflow-auto pb-32">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-slate-200 px-6 py-4 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-4">
          <div className="h-8 w-8 bg-[#1B2A4A] rounded-md flex items-center justify-center">
            <GitBranch className="h-4 w-4 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-[#1B2A4A] leading-tight">Branch Detail View</h1>
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span className="flex items-center gap-1"><Badge variant="secondary" className="h-5 px-1.5 font-normal">MAS Cancelled Trip</Badge></span>
              <span>•</span>
              <span>Focus: Q3 Branching</span>
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

      <main className="p-12 flex flex-col items-center min-w-max">
        
        {/* Q3 Node */}
        <div className="flex flex-col items-center relative">
          <div className="relative z-10 w-[400px]">
            <Card className="border-slate-200 shadow-sm hover:shadow-md transition-shadow duration-200 bg-white ring-1 ring-slate-900/5">
              <CardContent className="p-0">
                <div className="bg-slate-50 border-b border-slate-100 p-3 rounded-t-xl flex justify-between items-center">
                  <Badge variant="outline" className="bg-white text-slate-500 font-medium font-mono text-[10px] tracking-wider uppercase">
                    Q3
                  </Badge>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-400 hover:text-slate-600">
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </div>
                
                <div className="p-5">
                  <h3 className="text-base font-medium text-slate-800 mb-2">Did MAS cancel after drop-off was finalized?</h3>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="secondary" className="bg-slate-100 text-slate-600 font-normal cursor-help">
                      <HelpCircle className="h-3 w-3 mr-1" /> Help text attached
                    </Badge>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Vertical stem from Q3 */}
          <div className="w-px h-8 bg-slate-300"></div>

          {/* Fork Container */}
          <div className="flex justify-center relative w-[800px]">
            {/* Horizontal Fork Line */}
            <div className="absolute top-0 h-px bg-slate-300 w-[400px]"></div>
            
            {/* Left Branch (Yes) */}
            <div className="flex flex-col items-center w-[400px] relative px-6">
              <div className="w-px h-4 bg-slate-300"></div>
              
              {/* Option Pill */}
              <div className="relative z-10 flex flex-col items-center group">
                <button className="flex items-center bg-white border border-slate-200 hover:border-[#3478F6] shadow-sm rounded-full pl-4 pr-3 py-1.5 text-sm font-medium text-slate-700 transition-colors">
                  Yes, cancelled after completion
                  <ChevronDown className="h-3.5 w-3.5 ml-2 text-slate-400 group-hover:text-[#3478F6]" />
                </button>
              </div>

              {/* Stem to + button */}
              <div className="w-px h-6 bg-slate-300"></div>
              
              {/* Add step button */}
              <div className="relative z-10 -my-3">
                <button className="h-6 w-6 rounded-full bg-white border border-slate-200 text-slate-400 hover:text-[#3478F6] hover:border-[#3478F6] flex items-center justify-center shadow-sm transition-colors group">
                  <Plus className="h-3.5 w-3.5 group-hover:scale-110 transition-transform" />
                </button>
              </div>

              {/* Stem from + button to Q4 */}
              <div className="w-px h-6 bg-slate-300"></div>

              {/* Q4 Node */}
              <div className="relative z-10 w-[360px]">
                <Card className="border-slate-200 shadow-sm hover:shadow-md transition-shadow duration-200 bg-white ring-1 ring-slate-900/5">
                  <CardContent className="p-0">
                    <div className="bg-slate-50 border-b border-slate-100 p-3 rounded-t-xl flex justify-between items-center">
                      <Badge variant="outline" className="bg-white text-slate-500 font-medium font-mono text-[10px] tracking-wider uppercase">
                        Q4
                      </Badge>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-400 hover:text-slate-600">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </div>
                    
                    <div className="p-5">
                      <h3 className="text-base font-medium text-slate-800 mb-2">Is Correction Request available in MAS portal?</h3>
                      <div className="flex flex-wrap gap-2">
                        <Badge variant="secondary" className="bg-violet-50 text-violet-700 border border-violet-100 font-normal">
                          <FileText className="h-3 w-3 mr-1" /> 1 evidence req
                        </Badge>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Stem from Q4 */}
              <div className="w-px h-8 bg-slate-300"></div>

              {/* Fork Container for Q4 */}
              <div className="flex justify-center relative w-full">
                {/* Horizontal Fork Line for Q4 */}
                <div className="absolute top-0 h-px bg-slate-300 w-[200px]"></div>
                
                {/* Left Branch of Q4 */}
                <div className="flex flex-col items-center w-[200px] relative px-2">
                  <div className="w-px h-4 bg-slate-300"></div>
                  <button className="flex items-center bg-white border border-slate-200 hover:border-[#3478F6] shadow-sm rounded-full pl-3 pr-2 py-1 text-xs font-medium text-slate-700 transition-colors mb-6 whitespace-nowrap group">
                    Yes, available
                    <ChevronDown className="h-3 w-3 ml-1 text-slate-400 group-hover:text-[#3478F6]" />
                  </button>

                  {/* Terminal Outcome Green */}
                  <div className="h-2 w-2 rounded-full border-2 border-slate-300 bg-white mb-2 relative z-10 -mt-2"></div>
                  <div className="px-4 py-4 rounded-2xl border flex flex-col items-center text-center w-48 shadow-sm bg-green-50 border-green-200 hover:border-green-300 transition-colors">
                    <div className="h-10 w-10 rounded-full bg-green-100 flex items-center justify-center mb-3 shadow-sm border border-green-200/50">
                      <Send className="h-5 w-5 text-green-600" />
                    </div>
                    <span className="text-[10px] font-bold text-green-700 uppercase tracking-wider mb-1.5">
                      Portal Dispute
                    </span>
                    <span className="text-xs text-slate-800 font-medium leading-snug">
                      Submit correction via MAS portal
                    </span>
                  </div>
                </div>

                {/* Right Branch of Q4 */}
                <div className="flex flex-col items-center w-[200px] relative px-2">
                  <div className="w-px h-4 bg-slate-300"></div>
                  <button className="flex items-center bg-white border border-slate-200 hover:border-[#3478F6] shadow-sm rounded-full pl-3 pr-2 py-1 text-xs font-medium text-slate-700 transition-colors mb-6 whitespace-nowrap group">
                    No, not available
                    <ChevronDown className="h-3 w-3 ml-1 text-slate-400 group-hover:text-[#3478F6]" />
                  </button>

                  {/* Terminal Outcome Blue */}
                  <div className="h-2 w-2 rounded-full border-2 border-slate-300 bg-white mb-2 relative z-10 -mt-2"></div>
                  <div className="px-4 py-4 rounded-2xl border flex flex-col items-center text-center w-48 shadow-sm bg-blue-50 border-blue-200 hover:border-blue-300 transition-colors">
                    <div className="h-10 w-10 rounded-full bg-blue-100 flex items-center justify-center mb-3 shadow-sm border border-blue-200/50">
                      <Mail className="h-5 w-5 text-blue-600" />
                    </div>
                    <span className="text-[10px] font-bold text-blue-700 uppercase tracking-wider mb-1.5">
                      Email Dispute
                    </span>
                    <span className="text-xs text-slate-800 font-medium leading-snug">
                      Email correction request with evidence
                    </span>
                  </div>
                </div>
              </div>

            </div>

            {/* Right Branch (No) */}
            <div className="flex flex-col items-center w-[400px] relative px-6">
              <div className="w-px h-4 bg-slate-300"></div>
              
              {/* Option Pill */}
              <div className="relative z-10 flex flex-col items-center group">
                <button className="flex items-center bg-white border border-slate-200 hover:border-[#3478F6] shadow-sm rounded-full pl-4 pr-3 py-1.5 text-sm font-medium text-slate-700 transition-colors">
                  No, cancelled before completion
                  <ChevronDown className="h-3.5 w-3.5 ml-2 text-slate-400 group-hover:text-[#3478F6]" />
                </button>
              </div>

              <div className="w-px h-16 bg-slate-300"></div>

              {/* Terminal Outcome Red */}
              <div className="h-2 w-2 rounded-full border-2 border-slate-300 bg-white mb-2 relative z-10 -mt-2"></div>
              <div className="px-5 py-5 rounded-2xl border flex flex-col items-center text-center w-56 shadow-sm bg-red-50 border-red-200 hover:border-red-300 transition-colors relative">
                <div className="h-12 w-12 rounded-full bg-red-100 flex items-center justify-center mb-3 shadow-sm border border-red-200/50">
                  <Ban className="h-6 w-6 text-red-600" />
                </div>
                <span className="text-[11px] font-bold text-red-700 uppercase tracking-wider mb-2">
                  Resolve Internally
                </span>
                <span className="text-sm text-slate-800 font-medium leading-snug">
                  Not correctable
                </span>
              </div>
            </div>

            {/* Add Option Button (below existing options of Q3) */}
            <div className="absolute top-0 right-0 h-full flex flex-col items-start translate-x-4">
               <div className="absolute top-0 left-0 w-8 h-px bg-slate-300 border-dashed"></div>
               <div className="relative pt-[16px]">
                 <Button 
                  variant="outline" 
                  size="sm" 
                  className="h-7 text-xs rounded-full border-dashed bg-white text-slate-500 hover:text-slate-800 shadow-sm hover:border-slate-400"
                >
                  <Plus className="h-3 w-3 mr-1" /> Add Option
                </Button>
               </div>
            </div>

          </div>
        </div>

      </main>

      {/* Footer Stats */}
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-slate-900/80 backdrop-blur-md text-white px-5 py-2.5 rounded-full text-xs font-medium shadow-lg flex items-center gap-3 border border-slate-700/50">
        <span>4 Nodes</span>
        <div className="w-1 h-1 rounded-full bg-slate-500"></div>
        <span>5 Paths</span>
        <div className="w-1 h-1 rounded-full bg-slate-500"></div>
        <span>4 Levels Deep</span>
      </div>
    </div>
  );
}

export default FlowBranchDetail;
