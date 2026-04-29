import React from 'react';
import { Clock, Zap, AlertCircle, Menu, CheckCircle2, ChevronRight, FileText, ArrowRight } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';

export function QueueFirst() {
  return (
    <div className="min-h-screen bg-background text-foreground font-sans p-8 space-y-12">
      <style dangerouslySetInnerHTML={{__html: `
        .pill-blue { background-color: hsl(214 100% 96%); border-color: hsl(214 95% 85%); color: hsl(221 83% 38%); }
        .pill-amber { background-color: hsl(48 96% 95%); border-color: hsl(45 93% 80%); color: hsl(28 78% 38%); }
        .pill-green { background-color: hsl(141 78% 95%); border-color: hsl(142 70% 80%); color: hsl(142 71% 30%); }
        .pill-red { background-color: hsl(0 93% 96%); border-color: hsl(0 90% 85%); color: hsl(0 74% 42%); }
        .pill-muted { background-color: hsl(210 18% 94%); border-color: hsl(214 20% 90%); color: hsl(215 14% 45%); }
        .progress-bg { background-color: rgba(0,0,0,0.06); }
        .progress-bar-blue { background-color: hsl(221 83% 38%); }
        .progress-bar-amber { background-color: hsl(28 78% 38%); }
        .progress-bar-green { background-color: hsl(142 71% 30%); }
        .progress-bar-red { background-color: hsl(0 74% 42%); }
        .progress-bar-muted { background-color: hsl(215 14% 45%); }
      `}} />

      {/* 1. SECTION HEADER */}
      <div className="space-y-1 max-w-4xl mx-auto">
        <h2 className="text-xl font-bold tracking-tight">Variant B — Queue-First</h2>
        <p className="text-muted-foreground text-sm">
          <strong>Hypothesis:</strong> The live count is the dominant visual element. A thin progress bar shows time until the next batch, feeling alive without distracting.
        </p>
      </div>

      {/* 2. APP-SHELL MOCK */}
      <div className="max-w-5xl mx-auto">
        <div className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">App Header Context (Default State)</div>
        <div className="border rounded-xl overflow-hidden shadow-sm bg-background flex flex-col h-[400px]">
          {/* Mock App Header */}
          <header className="h-14 border-b bg-card flex items-center px-4 shrink-0 relative z-10">
            {/* Sidebar hint */}
            <div className="absolute left-0 top-0 bottom-0 w-16 bg-[#18233a] flex justify-center pt-4">
              <Menu className="text-white/50 w-5 h-5" />
            </div>
            <div className="ml-16 flex items-center">
              <Button variant="ghost" size="icon" className="mr-3 h-8 w-8 text-muted-foreground -ml-2">
                <Menu className="h-4 w-4" />
              </Button>
              <h1 className="font-semibold text-sm text-muted-foreground">NEMT Claims Dispute Command Center</h1>
            </div>
            
            <div className="ml-auto">
              <Pill
                count="12"
                label="queued"
                subtext="next batch 11:00 AM in 2h 14m"
                color="blue"
                progress={45}
                icon={Clock}
              />
            </div>
          </header>
          
          {/* Mock Page Content */}
          <div className="flex-1 bg-[hsl(210,20%,97%)] p-8 ml-16">
            <div className="max-w-3xl space-y-4">
              <div className="h-8 w-48 bg-black/5 rounded-md mb-8"></div>
              <div className="h-32 bg-white border rounded-xl border-black/5 shadow-xs"></div>
              <div className="h-64 bg-white border rounded-xl border-black/5 shadow-xs"></div>
            </div>
          </div>
        </div>
      </div>

      {/* 3. STATES STRIP */}
      <div className="max-w-6xl mx-auto">
        <div className="text-xs font-medium text-muted-foreground mb-4 uppercase tracking-wider">All States</div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <StateCard title="1. Empty / Idle" desc="No claims queued, batch still upcoming.">
            <Pill count="0" label="queued" subtext="next batch 2:00 PM" color="muted" progress={15} icon={Clock} empty />
          </StateCard>
          
          <StateCard title="2. Queued / Calm" desc="Some claims queued, batch >15min away.">
            <Pill count="12" label="queued" subtext="next batch 11:00 AM in 2h 14m" color="blue" progress={45} icon={Clock} />
          </StateCard>
          
          <StateCard title="3. Queued / Imminent" desc="≤15 minutes until batch (warm tint).">
            <Pill count="12" label="queued" subtext="next batch 11:00 AM in 8m" color="amber" progress={90} icon={Clock} pulse />
          </StateCard>

          <StateCard title="4. Running" desc="Batch is actively sweeping right now.">
            <Pill count="7" label="of 12" subtext="Sending batch" color="green" progress={100} icon={Zap} running />
          </StateCard>

          <StateCard title="5. After-hours" desc="Outside cron window.">
            <Pill count="5" label="queued" subtext="next batch Mon 8:00 AM" color="muted" progress={0} icon={Clock} />
          </StateCard>

          <StateCard title="6. Degraded" desc="Batch errored / worker unhealthy.">
            <Pill count="!" label="Attention" subtext="Batch attention needed" color="red" progress={100} icon={AlertCircle} degraded />
          </StateCard>
        </div>
      </div>

      {/* 4. MOBILE & POPOVER */}
      <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-12">
        <div>
          <div className="text-xs font-medium text-muted-foreground mb-4 uppercase tracking-wider">Mobile Collapsed (≤768px)</div>
          <div className="p-6 border rounded-xl bg-card inline-block">
             <PillCollapsed count="12" subtext="2h 14m" color="blue" progress={45} icon={Clock} />
          </div>
        </div>

        <div>
          <div className="text-xs font-medium text-muted-foreground mb-4 uppercase tracking-wider">Popover Open State</div>
          <div className="relative pt-2">
            <Popover open>
              <PopoverTrigger asChild>
                <div className="inline-block">
                  <Pill count="12" label="queued" subtext="next batch 11:00 AM in 2h 14m" color="blue" progress={45} icon={Clock} />
                </div>
              </PopoverTrigger>
              <PopoverContent className="w-80 p-0 shadow-lg border-black/5" align="start" sideOffset={8}>
                <div className="p-3 border-b bg-muted/30">
                  <h4 className="font-medium text-sm">Today's batches</h4>
                  <div className="flex items-center gap-1.5 text-xs mt-2 text-muted-foreground">
                    <span className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3 text-green-600"/> 8:00 AM</span>
                    <span className="text-border mx-0.5">•</span>
                    <span className="font-medium text-foreground bg-accent/10 text-accent-foreground px-1.5 py-0.5 rounded border border-accent/20">11:00 AM ← next</span>
                    <span className="text-border mx-0.5">•</span>
                    <span>2:00 PM</span>
                    <span className="text-border mx-0.5">•</span>
                    <span>6:00 PM</span>
                  </div>
                </div>
                <div className="p-3">
                  <div className="text-xs font-medium text-muted-foreground mb-2 flex justify-between">
                    <span>Queued claims (12)</span>
                  </div>
                  <div className="space-y-1">
                    {[
                      { ref: 'INV-2023-089', member: 'Jane Doe', amount: '$45.00' },
                      { ref: 'INV-2023-090', member: 'John Smith', amount: '$120.50' },
                      { ref: 'INV-2023-091', member: 'Alice Johnson', amount: '$32.00' }
                    ].map((row, i) => (
                      <div key={i} className="flex justify-between items-center text-sm py-1.5 px-2 hover:bg-muted/50 rounded-md cursor-pointer group">
                        <div className="flex items-center gap-2">
                          <FileText className="w-3.5 h-3.5 text-muted-foreground" />
                          <span className="font-medium">{row.ref}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-muted-foreground truncate max-w-[80px]">{row.member}</span>
                          <span className="tabular-nums">{row.amount}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="p-2 border-t bg-muted/10">
                  <Button variant="ghost" size="sm" className="w-full justify-between text-xs font-medium text-primary hover:text-primary hover:bg-primary/5">
                    View all in Portal Submissions
                    <ArrowRight className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </div>
      </div>
    </div>
  );
}

function StateCard({ title, desc, children }: { title: string, desc: string, children: React.ReactNode }) {
  return (
    <Card className="border shadow-none bg-card">
      <CardContent className="p-5 flex flex-col items-start gap-4">
        <div>
          <h4 className="font-semibold text-sm mb-1">{title}</h4>
          <p className="text-xs text-muted-foreground">{desc}</p>
        </div>
        <div className="mt-auto pt-2">{children}</div>
      </CardContent>
    </Card>
  );
}

interface PillProps {
  count: string;
  label: string;
  subtext: string;
  color: 'blue' | 'amber' | 'green' | 'red' | 'muted';
  progress: number;
  icon: any;
  empty?: boolean;
  running?: boolean;
  pulse?: boolean;
  degraded?: boolean;
}

function Pill({ count, label, subtext, color, progress, icon: Icon, empty, running, pulse, degraded }: PillProps) {
  return (
    <button className={`
      relative group flex items-center border rounded-md h-9 overflow-hidden transition-all
      pill-${color} hover:opacity-90 cursor-pointer
      ${pulse ? 'animate-pulse' : ''}
    `}>
      {/* Content wrapper */}
      <div className="flex items-center h-full px-2.5 gap-2 relative z-10">
        
        {/* Count Block */}
        <div className="flex items-baseline gap-1">
          {!empty && !degraded && <span className="font-bold text-[15px] leading-none tabular-nums tracking-tight">{count}</span>}
          {empty && <span className="font-medium text-sm leading-none">No claims</span>}
          {degraded && <span className="w-2 h-2 rounded-full bg-red-600 animate-pulse mr-1" />}
          {(!empty || degraded) && <span className="text-[11px] font-medium leading-none opacity-80 uppercase tracking-wide">{label}</span>}
        </div>

        {/* Divider */}
        <div className={`w-[1px] h-3.5 opacity-20 bg-current`} />

        {/* Subtext & Icon */}
        <div className="flex items-center gap-1.5 opacity-90">
          {!running && !degraded && <Icon className="w-3.5 h-3.5" />}
          {running && <Icon className="w-3.5 h-3.5 fill-current" />}
          {degraded && <Icon className="w-3.5 h-3.5" />}
          <span className="text-[11px] font-medium leading-none whitespace-nowrap">{subtext}</span>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="absolute bottom-0 left-0 right-0 h-[2px] progress-bg">
        <div 
          className={`h-full progress-bar-${color} transition-all duration-1000 ease-in-out`}
          style={{ width: `${progress}%` }}
        />
      </div>
    </button>
  );
}

function PillCollapsed({ count, subtext, color, progress, icon: Icon }: Omit<PillProps, 'label'>) {
  return (
    <button className={`
      relative group flex items-center border rounded-md h-8 overflow-hidden transition-all
      pill-${color} hover:opacity-90 cursor-pointer
    `}>
      <div className="flex items-center h-full px-2.5 gap-1.5 relative z-10">
        <span className="font-bold text-[14px] leading-none tabular-nums tracking-tight">{count}</span>
        <div className={`w-[1px] h-3 opacity-20 bg-current`} />
        <Icon className="w-3 h-3 opacity-90" />
        <span className="text-[11px] font-medium leading-none opacity-90">{subtext}</span>
      </div>
      <div className="absolute bottom-0 left-0 right-0 h-[2px] progress-bg">
        <div className={`h-full progress-bar-${color}`} style={{ width: `${progress}%` }} />
      </div>
    </button>
  );
}
