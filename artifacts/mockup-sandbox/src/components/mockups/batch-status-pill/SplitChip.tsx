import React from "react";
import { Clock, Package, Zap, AlertCircle, Menu, ChevronRight, CheckCircle2, ArrowRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";

export function SplitChip() {
  return (
    <div className="min-h-screen bg-[#f4f5f7] font-sans pb-20">
      <style dangerouslySetInnerHTML={{
        __html: `
          :root {
            --cc-blue-bg: 214 100% 96%;
            --cc-blue-border: 214 95% 85%;
            --cc-blue-fg: 221 83% 38%;
            
            --cc-amber-bg: 48 96% 95%;
            --cc-amber-border: 45 93% 80%;
            --cc-amber-fg: 28 78% 38%;
            
            --cc-green-bg: 141 78% 95%;
            --cc-green-border: 142 70% 80%;
            --cc-green-fg: 142 71% 30%;
            
            --cc-red-bg: 0 93% 96%;
            --cc-red-border: 0 90% 85%;
            --cc-red-fg: 0 74% 42%;
            
            --cc-muted-bg: 210 18% 94%;
            --cc-muted-border: 214 20% 90%;
            --cc-muted-fg: 215 14% 45%;
          }

          .split-chip {
            display: inline-flex;
            align-items: stretch;
            height: 1.75rem;
            border-radius: 0.375rem;
            border: 1px solid var(--sc-border-color, hsl(var(--cc-blue-border)));
            overflow: hidden;
            font-size: 0.75rem;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.15s ease;
            box-shadow: 0 1px 2px rgba(0,0,0,0.02);
            background: white;
          }
          
          .split-chip:hover {
            box-shadow: 0 2px 4px rgba(0,0,0,0.05);
            transform: translateY(-1px);
          }
          
          .split-chip-left {
            display: flex;
            align-items: center;
            gap: 0.375rem;
            padding: 0 0.5rem;
            background: var(--sc-left-bg, hsl(var(--cc-blue-bg)));
            color: var(--sc-left-fg, hsl(var(--cc-blue-fg)));
          }
          
          .split-chip-right {
            display: flex;
            align-items: center;
            gap: 0.375rem;
            padding: 0 0.5rem;
            background: var(--sc-right-bg, hsl(var(--cc-blue-bg)));
            color: var(--sc-right-fg, hsl(var(--cc-blue-fg)));
          }
          
          .split-chip-divider {
            width: 1px;
            background: var(--sc-border-color, hsl(var(--cc-blue-border)));
          }
          
          .pulse-subtle {
            animation: sc-pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
          }
          
          @keyframes sc-pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.6; }
          }
        `
      }} />

      {/* 1. SECTION HEADER */}
      <div className="bg-white border-b px-8 py-6 mb-8">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-xl font-semibold text-[#1a2333] mb-1">C — Split Chip</h2>
          <p className="text-[#64748b] text-sm">
            A two-segment pill with a vertical separator. Each side manages its own color channel for two-read scannability.
          </p>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-8 space-y-12">
        {/* 2. APP-SHELL MOCK */}
        <section>
          <h3 className="text-xs font-semibold text-[#64748b] uppercase tracking-wider mb-4">Context</h3>
          <div className="border border-[#e2e8f0] rounded-xl overflow-hidden shadow-sm flex flex-col bg-white w-full max-w-[1100px] h-[300px]">
            <div className="flex flex-1">
              {/* Sidebar hint */}
              <div className="w-16 bg-[#162035] flex-shrink-0 flex flex-col items-center py-4 border-r border-[#162035]">
                <div className="w-8 h-8 rounded bg-[#e85d3a] flex items-center justify-center mb-8">
                  <span className="text-white font-bold text-sm">C</span>
                </div>
                <div className="w-8 h-8 rounded-md bg-[#25324b] mb-4"></div>
                <div className="w-8 h-8 rounded-md bg-transparent mb-4"></div>
              </div>
              
              {/* Main content area */}
              <div className="flex-1 flex flex-col min-w-0 bg-[#f8fafc]">
                {/* Header */}
                <header className="h-14 bg-white border-b border-[#e2e8f0] flex items-center px-4 justify-between sticky top-0 shrink-0">
                  <div className="flex items-center">
                    <button className="mr-4 text-[#64748b] hover:text-[#1a2333]">
                      <Menu className="w-5 h-5" />
                    </button>
                    <h1 className="font-semibold text-sm text-[#64748b]">NEMT Claims Dispute Command Center</h1>
                  </div>
                  
                  <div>
                    {/* The Pill in Default/Calm state */}
                    <div className="split-chip">
                      <div className="split-chip-left">
                        <Package className="w-3.5 h-3.5 opacity-70" />
                        <span>12 queued</span>
                      </div>
                      <div className="split-chip-divider" />
                      <div className="split-chip-right">
                        <Clock className="w-3.5 h-3.5 opacity-70" />
                        <span>next batch 11:00 AM in 2h 14m</span>
                      </div>
                    </div>
                  </div>
                </header>
                
                {/* Body hint */}
                <div className="p-6">
                  <div className="h-32 rounded-xl border border-dashed border-[#cbd5e1] bg-[#f1f5f9] flex items-center justify-center opacity-50">
                    <span className="text-[#94a3b8] text-sm">Page Content</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 3. STATES STRIP */}
        <section>
          <h3 className="text-xs font-semibold text-[#64748b] uppercase tracking-wider mb-4">All States</h3>
          <div className="grid gap-6">
            
            <div className="flex items-center gap-6 p-4 rounded-lg bg-white border shadow-sm">
              <div className="w-48 shrink-0">
                <div className="font-medium text-sm text-[#1a2333]">1. Empty / Idle</div>
                <div className="text-xs text-[#64748b]">No claims, batch upcoming</div>
              </div>
              <div>
                <div className="split-chip" style={{
                  '--sc-border-color': 'hsl(var(--cc-muted-border))',
                  '--sc-left-bg': 'hsl(var(--cc-muted-bg))',
                  '--sc-left-fg': 'hsl(var(--cc-muted-fg))',
                  '--sc-right-bg': 'hsl(var(--cc-muted-bg))',
                  '--sc-right-fg': 'hsl(var(--cc-muted-fg))'
                } as React.CSSProperties}>
                  <div className="split-chip-left">
                    <Package className="w-3.5 h-3.5 opacity-60" />
                    <span>No claims queued</span>
                  </div>
                  <div className="split-chip-divider" />
                  <div className="split-chip-right">
                    <Clock className="w-3.5 h-3.5 opacity-60" />
                    <span>next batch 2:00 PM</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-6 p-4 rounded-lg bg-white border shadow-sm">
              <div className="w-48 shrink-0">
                <div className="font-medium text-sm text-[#1a2333]">2. Queued / Calm</div>
                <div className="text-xs text-[#64748b]">&gt;15 min away</div>
              </div>
              <div>
                <div className="split-chip">
                  <div className="split-chip-left">
                    <Package className="w-3.5 h-3.5 opacity-70" />
                    <span>12 queued</span>
                  </div>
                  <div className="split-chip-divider" />
                  <div className="split-chip-right">
                    <Clock className="w-3.5 h-3.5 opacity-70" />
                    <span>next batch 11:00 AM in 2h 14m</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-6 p-4 rounded-lg bg-white border shadow-sm">
              <div className="w-48 shrink-0">
                <div className="font-medium text-sm text-[#1a2333]">3. Queued / Imminent</div>
                <div className="text-xs text-[#64748b]">≤15 min until batch</div>
              </div>
              <div>
                <div className="split-chip" style={{
                  '--sc-border-color': 'hsl(var(--cc-amber-border))',
                  '--sc-right-bg': 'hsl(var(--cc-amber-bg))',
                  '--sc-right-fg': 'hsl(var(--cc-amber-fg))'
                } as React.CSSProperties}>
                  <div className="split-chip-left">
                    <Package className="w-3.5 h-3.5 opacity-70" />
                    <span>12 queued</span>
                  </div>
                  <div className="split-chip-divider" />
                  <div className="split-chip-right">
                    <Clock className="w-3.5 h-3.5 opacity-80" />
                    <span className="font-semibold">next batch 11:00 AM in 8m</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-6 p-4 rounded-lg bg-white border shadow-sm">
              <div className="w-48 shrink-0">
                <div className="font-medium text-sm text-[#1a2333]">4. Running</div>
                <div className="text-xs text-[#64748b]">Actively sweeping</div>
              </div>
              <div>
                <div className="split-chip pulse-subtle" style={{
                  '--sc-border-color': 'hsl(var(--cc-green-border))',
                  '--sc-left-bg': 'hsl(var(--cc-green-bg))',
                  '--sc-left-fg': 'hsl(var(--cc-green-fg))',
                  '--sc-right-bg': 'hsl(var(--cc-green-bg))',
                  '--sc-right-fg': 'hsl(var(--cc-green-fg))'
                } as React.CSSProperties}>
                  <div className="split-chip-left">
                    <Zap className="w-3.5 h-3.5 opacity-80 fill-current" />
                    <span className="font-semibold">Sending batch</span>
                  </div>
                  <div className="split-chip-divider" />
                  <div className="split-chip-right">
                    <span>7 of 12</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-6 p-4 rounded-lg bg-white border shadow-sm">
              <div className="w-48 shrink-0">
                <div className="font-medium text-sm text-[#1a2333]">5. After-hours</div>
                <div className="text-xs text-[#64748b]">Outside cron window</div>
              </div>
              <div>
                <div className="split-chip" style={{
                  '--sc-border-color': 'hsl(var(--cc-muted-border))',
                  '--sc-left-bg': 'hsl(var(--cc-blue-bg))',
                  '--sc-left-fg': 'hsl(var(--cc-blue-fg))',
                  '--sc-right-bg': 'hsl(var(--cc-muted-bg))',
                  '--sc-right-fg': 'hsl(var(--cc-muted-fg))'
                } as React.CSSProperties}>
                  <div className="split-chip-left">
                    <Package className="w-3.5 h-3.5 opacity-70" />
                    <span>5 queued</span>
                  </div>
                  <div className="split-chip-divider" />
                  <div className="split-chip-right">
                    <Clock className="w-3.5 h-3.5 opacity-60" />
                    <span>next batch Mon 8:00 AM</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-6 p-4 rounded-lg bg-white border shadow-sm">
              <div className="w-48 shrink-0">
                <div className="font-medium text-sm text-[#1a2333]">6. Degraded</div>
                <div className="text-xs text-[#64748b]">Error / attention needed</div>
              </div>
              <div>
                <div className="split-chip" style={{
                  '--sc-border-color': 'hsl(var(--cc-red-border))',
                  '--sc-left-bg': 'hsl(var(--cc-red-bg))',
                  '--sc-left-fg': 'hsl(var(--cc-red-fg))',
                  '--sc-right-bg': 'hsl(var(--cc-red-bg))',
                  '--sc-right-fg': 'hsl(var(--cc-red-fg))'
                } as React.CSSProperties}>
                  <div className="split-chip-left" style={{ paddingRight: '0.25rem' }}>
                    <div className="w-2 h-2 rounded-full bg-[#dc2626] animate-pulse"></div>
                  </div>
                  {/* Note: In degraded state we remove divider to make it feel like one unified alert */}
                  <div className="split-chip-right" style={{ paddingLeft: '0.25rem' }}>
                    <AlertCircle className="w-3.5 h-3.5 opacity-80" />
                    <span className="font-semibold">Batch attention needed</span>
                  </div>
                </div>
              </div>
            </div>

          </div>
        </section>

        {/* 4 & 5. MOBILE AND POPOVER */}
        <div className="grid grid-cols-2 gap-12 items-start">
          <section>
            <h3 className="text-xs font-semibold text-[#64748b] uppercase tracking-wider mb-4">Mobile Collapsed</h3>
            <div className="p-8 rounded-lg bg-white border shadow-sm flex items-center justify-center">
              <div className="split-chip" style={{
                  '--sc-border-color': 'hsl(var(--cc-amber-border))',
                  '--sc-right-bg': 'hsl(var(--cc-amber-bg))',
                  '--sc-right-fg': 'hsl(var(--cc-amber-fg))'
                } as React.CSSProperties}>
                  <div className="split-chip-left px-2">
                    <span className="font-semibold">12</span>
                  </div>
                  <div className="split-chip-divider" />
                  <div className="split-chip-right px-2">
                    <Clock className="w-3.5 h-3.5 opacity-80" />
                    <span className="font-semibold">2h 14m</span>
                  </div>
                </div>
            </div>
          </section>

          <section>
            <h3 className="text-xs font-semibold text-[#64748b] uppercase tracking-wider mb-4">Popover Open State</h3>
            <div className="p-8 rounded-lg bg-white border shadow-sm flex flex-col items-center gap-4 bg-[#f8fafc]">
              
              <Popover open={true}>
                <PopoverTrigger asChild>
                  <div className="split-chip pointer-events-none">
                    <div className="split-chip-left">
                      <Package className="w-3.5 h-3.5 opacity-70" />
                      <span>12 queued</span>
                    </div>
                    <div className="split-chip-divider" />
                    <div className="split-chip-right">
                      <Clock className="w-3.5 h-3.5 opacity-70" />
                      <span>next batch 11:00 AM in 2h 14m</span>
                    </div>
                  </div>
                </PopoverTrigger>
                <PopoverContent 
                  sideOffset={8}
                  className="w-80 p-0 shadow-lg border-[#e2e8f0]" 
                  onInteractOutside={(e) => e.preventDefault()}
                  onEscapeKeyDown={(e) => e.preventDefault()}
                  onPointerDownOutside={(e) => e.preventDefault()}
                  onFocusOutside={(e) => e.preventDefault()}
                >
                  <div className="px-4 py-3 border-b bg-[#f8fafc] rounded-t-md flex items-center justify-between">
                    <span className="font-semibold text-sm text-[#1a2333]">Today's batches</span>
                  </div>
                  
                  <div className="p-4 border-b">
                    <div className="flex justify-between items-center text-xs">
                      <div className="flex flex-col items-center gap-1 text-[#64748b]">
                        <CheckCircle2 className="w-4 h-4 text-[#16a34a]" />
                        <span>8:00 AM</span>
                      </div>
                      <div className="flex-1 border-t border-dashed mx-2 mb-4 border-[#cbd5e1]"></div>
                      <div className="flex flex-col items-center gap-1 text-[#1a2333] font-semibold relative">
                        <div className="w-4 h-4 rounded-full border-2 border-[#2563eb] bg-white absolute -top-1"></div>
                        <span className="mt-4">11:00 AM</span>
                        <span className="text-[10px] text-[#2563eb] absolute -bottom-4">Next</span>
                      </div>
                      <div className="flex-1 border-t border-dashed mx-2 mb-4 border-[#cbd5e1]"></div>
                      <div className="flex flex-col items-center gap-1 text-[#94a3b8]">
                        <div className="w-4 h-4 rounded-full border-2 border-[#cbd5e1] bg-white"></div>
                        <span>2:00 PM</span>
                      </div>
                      <div className="flex-1 border-t border-dashed mx-2 mb-4 border-[#cbd5e1]"></div>
                      <div className="flex flex-col items-center gap-1 text-[#94a3b8]">
                        <div className="w-4 h-4 rounded-full border-2 border-[#cbd5e1] bg-white"></div>
                        <span>6:00 PM</span>
                      </div>
                    </div>
                  </div>

                  <div className="p-2 max-h-48 overflow-y-auto">
                    <div className="px-2 py-1.5 text-xs font-medium text-[#64748b] mb-1">Queue (12 claims)</div>
                    <div className="flex items-center justify-between py-1.5 px-2 hover:bg-[#f8fafc] rounded-md transition-colors text-sm cursor-pointer">
                      <div className="flex items-center gap-2 text-[#1a2333]">
                        <span className="font-mono text-xs text-[#64748b]">INV-9921</span>
                        <span>John Doe</span>
                      </div>
                      <span className="font-medium text-[#1a2333]">$145.00</span>
                    </div>
                    <div className="flex items-center justify-between py-1.5 px-2 hover:bg-[#f8fafc] rounded-md transition-colors text-sm cursor-pointer">
                      <div className="flex items-center gap-2 text-[#1a2333]">
                        <span className="font-mono text-xs text-[#64748b]">INV-8842</span>
                        <span>Jane Smith</span>
                      </div>
                      <span className="font-medium text-[#1a2333]">$82.50</span>
                    </div>
                    <div className="flex items-center justify-between py-1.5 px-2 hover:bg-[#f8fafc] rounded-md transition-colors text-sm cursor-pointer">
                      <div className="flex items-center gap-2 text-[#1a2333]">
                        <span className="font-mono text-xs text-[#64748b]">INV-7731</span>
                        <span>Robert Johnson</span>
                      </div>
                      <span className="font-medium text-[#1a2333]">$210.00</span>
                    </div>
                    <div className="py-2 px-2 text-xs text-[#64748b] italic">
                      + 9 more claims
                    </div>
                  </div>

                  <div className="p-2 border-t bg-[#f8fafc] rounded-b-md">
                    <Button variant="ghost" className="w-full text-xs h-8 text-[#2563eb] hover:text-[#1d4ed8] hover:bg-[#eff6ff] justify-between">
                      View all in Portal Submissions
                      <ArrowRight className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </PopoverContent>
              </Popover>

            </div>
          </section>
        </div>

      </div>
    </div>
  );
}
