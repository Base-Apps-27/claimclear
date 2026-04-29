import React from "react";
import { Clock, Zap, AlertCircle, Menu, ChevronRight, Check } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const TELEMETRY_STYLES = `
  .telemetry-pill {
    font-family: 'Inter', sans-serif;
  }
  .bg-cc-blue { background-color: hsl(214 100% 96%); }
  .border-cc-blue { border-color: hsl(214 95% 85%); }
  .text-cc-blue { color: hsl(221 83% 38%); }

  .bg-cc-amber { background-color: hsl(48 96% 95%); }
  .border-cc-amber { border-color: hsl(45 93% 80%); }
  .text-cc-amber { color: hsl(28 78% 38%); }

  .bg-cc-green { background-color: hsl(141 78% 95%); }
  .border-cc-green { border-color: hsl(142 70% 80%); }
  .text-cc-green { color: hsl(142 71% 30%); }

  .bg-cc-red { background-color: hsl(0 93% 96%); }
  .border-cc-red { border-color: hsl(0 90% 85%); }
  .text-cc-red { color: hsl(0 74% 42%); }
  
  .bg-cc-muted { background-color: hsl(210 18% 94%); }
  .border-cc-muted { border-color: hsl(214 20% 90%); }
  .text-cc-muted { color: hsl(215 14% 45%); }
`;

type PillState = "idle" | "calm" | "imminent" | "running" | "after-hours" | "degraded";

interface QuietTelemetryPillProps {
  state: PillState;
  collapsed?: boolean;
}

const QuietTelemetryPill: React.FC<QuietTelemetryPillProps> = ({ state, collapsed = false }) => {
  const getPillContent = () => {
    switch (state) {
      case "idle":
        return {
          icon: <Clock className="w-3.5 h-3.5 text-muted-foreground" />,
          content: collapsed ? "0 · 2:00 PM" : "No claims queued · next batch 2:00 PM",
          classes: "bg-transparent border-transparent hover:bg-cc-muted text-muted-foreground",
          count: null
        };
      case "calm":
        return {
          icon: <Clock className="w-3.5 h-3.5 text-muted-foreground" />,
          content: collapsed ? "12 · 2h 14m" : "next batch 11:00 AM in 2h 14m",
          classes: "bg-transparent border-border hover:bg-cc-muted text-muted-foreground",
          count: "12 queued"
        };
      case "imminent":
        return {
          icon: <Clock className="w-3.5 h-3.5 text-cc-amber" />,
          content: collapsed ? "12 · 8m" : "next batch 11:00 AM in 8m",
          classes: "bg-cc-amber border-cc-amber text-cc-amber",
          count: "12 queued"
        };
      case "running":
        return {
          icon: <Zap className="w-3.5 h-3.5 text-cc-blue fill-cc-blue animate-pulse" />,
          content: collapsed ? "7 / 12" : "Sending batch · 7 of 12",
          classes: "bg-cc-blue border-cc-blue text-cc-blue",
          count: null
        };
      case "after-hours":
        return {
          icon: <Clock className="w-3.5 h-3.5 text-muted-foreground" />,
          content: collapsed ? "5 · Mon 8am" : "next batch Mon 8:00 AM",
          classes: "bg-transparent border-border hover:bg-cc-muted text-muted-foreground",
          count: "5 queued"
        };
      case "degraded":
        return {
          icon: <AlertCircle className="w-3.5 h-3.5 text-cc-red" />,
          content: collapsed ? "Error" : "Batch attention needed",
          classes: "bg-cc-red border-cc-red text-cc-red",
          count: null
        };
    }
  };

  const { icon, content, classes, count } = getPillContent();

  return (
    <button className={`telemetry-pill flex items-center h-7 px-2.5 rounded-md border transition-colors text-[13px] font-medium tracking-tight ${classes}`}>
      {count && !collapsed && (
        <span className="tabular-nums opacity-70 mr-1.5">{count} · </span>
      )}
      <div className="flex items-center gap-1.5">
        {icon}
        <span className={state === "idle" || state === "calm" || state === "after-hours" ? "font-mono text-xs tracking-tighter" : ""}>{content}</span>
      </div>
    </button>
  );
};

export function QuietTelemetry() {
  return (
    <div className="min-h-screen bg-background text-foreground pb-20">
      <style>{TELEMETRY_STYLES}</style>
      
      {/* 1. SECTION HEADER */}
      <div className="p-6 border-b bg-card">
        <h2 className="text-lg font-semibold tracking-tight">Variant A: Quiet Telemetry</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Hypothesis: The pill reads like a System Health element promoted into the header — calm, time-leading, low visual weight, almost monospaced metadata. The emphasis is on *when* the next batch fires.
        </p>
      </div>

      <div className="p-8 space-y-12">
        {/* 2. APP-SHELL MOCK */}
        <section>
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4">In Context</h3>
          
          <div className="rounded-xl overflow-hidden border shadow-sm flex max-w-[1100px] mx-auto bg-card h-[400px]">
            {/* Fake Sidebar */}
            <div className="w-64 bg-[#1B2A4A] shrink-0 border-r border-[#15223c] flex flex-col">
              <div className="h-14 border-b border-[#15223c] flex items-center px-4 gap-2">
                <div className="w-8 h-8 rounded-lg bg-[#E85D3A] flex items-center justify-center text-white font-bold text-xs">A</div>
                <span className="text-[#f1f5f9] font-medium tracking-tight">Agape ClaimClear</span>
              </div>
            </div>
            
            {/* Fake Main Area */}
            <div className="flex-1 flex flex-col bg-[#f8fafc]">
              {/* The Real Header */}
              <header className="h-14 border-b bg-white flex items-center justify-between px-4 sticky top-0">
                <div className="flex items-center">
                  <button className="mr-4 text-slate-500 hover:text-slate-900 transition-colors">
                    <Menu className="w-5 h-5" />
                  </button>
                  <h1 className="font-semibold text-sm text-slate-500">NEMT Claims Dispute Command Center</h1>
                </div>
                <div>
                  <QuietTelemetryPill state="calm" />
                </div>
              </header>
              
              {/* Fake Content Hint */}
              <div className="p-8">
                <div className="flex gap-6 mb-6">
                  <div className="h-24 flex-1 bg-white border border-slate-200 rounded-xl shadow-sm"></div>
                  <div className="h-24 flex-1 bg-white border border-slate-200 rounded-xl shadow-sm"></div>
                  <div className="h-24 flex-1 bg-white border border-slate-200 rounded-xl shadow-sm"></div>
                  <div className="h-24 flex-1 bg-white border border-slate-200 rounded-xl shadow-sm"></div>
                </div>
                <div className="h-64 bg-white border border-slate-200 rounded-xl shadow-sm"></div>
              </div>
            </div>
          </div>
        </section>

        {/* 3. STATES STRIP */}
        <section>
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4">All States</h3>
          
          <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
            <Card className="p-4 flex flex-col gap-3 items-start border-dashed shadow-none">
              <QuietTelemetryPill state="idle" />
              <div>
                <div className="text-xs font-semibold">1. Empty / Idle</div>
                <div className="text-xs text-muted-foreground mt-0.5">No claims, batch upcoming</div>
              </div>
            </Card>

            <Card className="p-4 flex flex-col gap-3 items-start border-dashed shadow-none">
              <QuietTelemetryPill state="calm" />
              <div>
                <div className="text-xs font-semibold">2. Queued / Calm</div>
                <div className="text-xs text-muted-foreground mt-0.5">Claims queued, &gt;15m away</div>
              </div>
            </Card>

            <Card className="p-4 flex flex-col gap-3 items-start border-dashed shadow-none">
              <QuietTelemetryPill state="imminent" />
              <div>
                <div className="text-xs font-semibold">3. Queued / Imminent</div>
                <div className="text-xs text-muted-foreground mt-0.5">≤15 mins until batch</div>
              </div>
            </Card>

            <Card className="p-4 flex flex-col gap-3 items-start border-dashed shadow-none">
              <QuietTelemetryPill state="running" />
              <div>
                <div className="text-xs font-semibold">4. Running</div>
                <div className="text-xs text-muted-foreground mt-0.5">Actively sweeping now</div>
              </div>
            </Card>

            <Card className="p-4 flex flex-col gap-3 items-start border-dashed shadow-none">
              <QuietTelemetryPill state="after-hours" />
              <div>
                <div className="text-xs font-semibold">5. After-Hours</div>
                <div className="text-xs text-muted-foreground mt-0.5">Outside cron window</div>
              </div>
            </Card>

            <Card className="p-4 flex flex-col gap-3 items-start border-dashed shadow-none">
              <QuietTelemetryPill state="degraded" />
              <div>
                <div className="text-xs font-semibold">6. Degraded</div>
                <div className="text-xs text-muted-foreground mt-0.5">Batch errored / worker unhealthy</div>
              </div>
            </Card>
          </div>
        </section>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
          {/* 4. MOBILE COLLAPSED */}
          <section>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4">Mobile Collapsed Form</h3>
            <Card className="p-6 border-dashed shadow-none bg-slate-50 flex items-center justify-center">
              <div className="w-[320px] bg-white border shadow-sm rounded-lg overflow-hidden">
                <header className="h-14 border-b flex items-center justify-between px-4">
                  <Menu className="w-5 h-5 text-slate-500" />
                  <QuietTelemetryPill state="calm" collapsed />
                </header>
              </div>
            </Card>
          </section>

          {/* 5. POPOVER OPEN */}
          <section>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4">Popover Open State</h3>
            <Card className="p-6 border-dashed shadow-none bg-slate-50 flex items-center justify-center min-h-[300px]">
              
              <Popover open>
                <PopoverTrigger asChild>
                  <div className="relative">
                    <QuietTelemetryPill state="calm" />
                  </div>
                </PopoverTrigger>
                <PopoverContent className="w-80 p-0" align="start" sideOffset={8}>
                  <div className="p-3 border-b bg-slate-50/50">
                    <h4 className="font-medium text-sm">Today's batches</h4>
                    <div className="flex items-center gap-2 mt-2 text-[11px] text-muted-foreground font-mono">
                      <span className="flex items-center gap-1 text-slate-400 line-through decoration-slate-300">
                        8:00 AM <Check className="w-3 h-3" />
                      </span>
                      <span>·</span>
                      <span className="text-slate-900 font-semibold flex items-center gap-1">
                        11:00 AM <span className="text-[10px] bg-slate-200 text-slate-700 px-1 rounded-sm uppercase tracking-wider font-sans">Next</span>
                      </span>
                      <span>·</span>
                      <span>2:00 PM</span>
                      <span>·</span>
                      <span>6:00 PM</span>
                    </div>
                  </div>
                  
                  <div className="p-0">
                    <div className="px-3 py-2 text-xs font-medium text-slate-500 bg-slate-50 border-b">
                      12 Queued Claims
                    </div>
                    <ul className="text-sm">
                      <li className="px-3 py-2.5 border-b hover:bg-slate-50 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-slate-900">INV-84920</span>
                          <span className="text-slate-500">J. Smith</span>
                        </div>
                        <span className="text-slate-600 font-mono text-xs">$145.00</span>
                      </li>
                      <li className="px-3 py-2.5 border-b hover:bg-slate-50 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-slate-900">INV-84921</span>
                          <span className="text-slate-500">M. Johnson</span>
                        </div>
                        <span className="text-slate-600 font-mono text-xs">$85.50</span>
                      </li>
                      <li className="px-3 py-2.5 border-b hover:bg-slate-50 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-slate-900">INV-84922</span>
                          <span className="text-slate-500">R. Davis</span>
                        </div>
                        <span className="text-slate-600 font-mono text-xs">$210.00</span>
                      </li>
                    </ul>
                  </div>
                  
                  <div className="p-2 border-t bg-slate-50">
                    <button className="w-full flex items-center justify-between px-2 py-1.5 text-xs font-medium text-primary hover:bg-primary/5 rounded transition-colors">
                      View all in Portal Submissions
                      <ChevronRight className="w-3 h-3" />
                    </button>
                  </div>
                </PopoverContent>
              </Popover>

            </Card>
          </section>
        </div>

      </div>
    </div>
  );
}
