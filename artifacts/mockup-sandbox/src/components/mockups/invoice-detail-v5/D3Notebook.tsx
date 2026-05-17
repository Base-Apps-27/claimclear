import React from "react";
import "./_group.css";
import {
  ArrowLeft, Play, CheckCircle2, AlertTriangle, FileText, UploadCloud,
  ChevronDown, ChevronRight, MessageSquare, History, Gavel, X,
  Clock, ShieldAlert, Paperclip
} from "lucide-react";

export default function D3Notebook() {
  return (
    <div className="cc-scope min-h-screen pb-24" style={{ fontFamily: "var(--cc-font-serif, 'Georgia', serif)" }}>
      {/* Top Utility Bar */}
      <div className="border-b border-[var(--cc-border)] bg-[var(--cc-card)] sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-6 h-12 flex items-center gap-3 text-sm text-[var(--cc-muted-fg)] font-sans">
          <ArrowLeft className="w-4 h-4 cursor-pointer hover:text-[var(--cc-fg)] transition-colors" />
          <span className="cursor-pointer hover:text-[var(--cc-fg)] transition-colors">Invoice groups</span>
          <span>/</span>
          <span className="mono text-[var(--cc-fg)] font-medium">#INV-2026-1234</span>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 pt-12 space-y-16">
        
        {/* Header & Status Prose */}
        <section className="space-y-8">
          <div className="flex items-start justify-between">
            <div className="space-y-4">
              <div className="flex items-center gap-4 font-sans">
                <span className="cc-badge bg-[var(--cc-blue-bg)] text-[var(--cc-blue-fg)] border-none px-2.5 py-1">Ready</span>
                <span className="text-sm text-[var(--cc-muted-fg)] flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5" /> 14 days in queue
                </span>
              </div>
              <h1 className="text-4xl tracking-tight text-[var(--cc-fg)]">
                Aetna <span className="text-[var(--cc-muted-fg)] font-light">·</span> <span className="mono">#INV-2026-1234</span>
              </h1>
              <div className="flex items-center gap-6 text-sm font-sans text-[var(--cc-muted-fg)]">
                <div>Billed Apr 10, 2026</div>
                <div>Member <span className="mono">#88241</span></div>
                <div className="text-[var(--cc-fg)] font-medium">Total: $487.00</div>
              </div>
            </div>

            <div className="flex flex-col items-end gap-3 font-sans">
              <button className="cc-btn cc-btn-primary shadow-sm group">
                <Play className="w-4 h-4" />
                <span className="text-base tracking-wide">Open in queue</span>
              </button>
              <span className="text-xs text-[var(--cc-muted-fg)]">Walk SOP & build submission</span>
            </div>
          </div>

          {/* Status Prose */}
          <div className="text-lg leading-relaxed text-[var(--cc-fg)] max-w-3xl">
            <strong className="font-semibold">Ready to dispute.</strong> 3 of 5 legs are in scope. 2 are fully evidenced; Leg B is blocked waiting on the auth-denial document. Once it's uploaded, the package can be sent to Aetna via the queue.
          </div>

          {/* Minor Lifecycle Strip */}
          <div className="flex items-center gap-2 font-sans text-xs">
            <LifecycleStep label="Triage" date="Apr 10" status="done" />
            <div className="w-6 h-px bg-[var(--cc-border)]" />
            <LifecycleStep label="Evidence" date="Apr 11" status="done" />
            <div className="w-6 h-px bg-[var(--cc-border)]" />
            <LifecycleStep label="Ready" date="Today" status="current" />
            <div className="w-6 h-px bg-[var(--cc-border)]" />
            <LifecycleStep label="Submitted" status="pending" />
            <div className="w-6 h-px bg-[var(--cc-border)]" />
            <LifecycleStep label="Awaiting" status="pending" />
            <div className="w-6 h-px bg-[var(--cc-border)]" />
            <LifecycleStep label="Resolved" status="pending" />
          </div>
        </section>


        {/* Legs Section */}
        <section className="space-y-6 font-sans">
          <h2 className="text-xl font-serif text-[var(--cc-fg)] pb-2 border-b border-[var(--cc-border)]">Claim Lines (Legs)</h2>
          
          <div className="space-y-3">
            {/* Leg A - Collapsed */}
            <div className="cc-card p-3 flex items-center justify-between hover:bg-[var(--cc-muted)] cursor-pointer transition-colors group">
              <div className="flex items-center gap-4">
                <ChevronRight className="w-4 h-4 text-[var(--cc-muted-fg)] group-hover:text-[var(--cc-fg)]" />
                <span className="font-medium w-16">Leg A</span>
                <span className="mono text-[var(--cc-muted-fg)] text-sm">TX-558820</span>
                <span className="text-sm text-[var(--cc-muted-fg)] w-24">Underpayment</span>
                <span className="text-sm text-[var(--cc-muted-fg)]">Apr 10 · $42.00</span>
              </div>
              <div className="flex items-center gap-6">
                <span className="text-xs text-[var(--cc-muted-fg)]">SOP Q4/4 ✓ · 3/3 files</span>
                <span className="cc-badge bg-[var(--cc-blue-bg)] text-[var(--cc-blue-fg)] border-none w-20 justify-center">Ready</span>
              </div>
            </div>

            {/* Leg B - Expanded Dossier */}
            <div className="cc-card shadow-sm border-[var(--cc-amber-border)] overflow-hidden">
              <div className="p-4 bg-[var(--cc-amber-bg)] flex items-center justify-between border-b border-[var(--cc-amber-border)]">
                <div className="flex items-center gap-4">
                  <ChevronDown className="w-4 h-4 text-[var(--cc-amber-fg)]" />
                  <span className="font-semibold text-[var(--cc-amber-fg)] w-16">Leg B</span>
                  <span className="mono text-[var(--cc-amber-fg)] text-sm opacity-80">TX-558821</span>
                  <span className="text-sm text-[var(--cc-amber-fg)] w-24 font-medium">Underpayment</span>
                  <span className="text-sm text-[var(--cc-amber-fg)] opacity-80">Apr 12 · $58.00</span>
                </div>
                <span className="cc-badge bg-[var(--cc-card)] text-[var(--cc-amber-fg)] border-[var(--cc-amber-border)] w-24 justify-center">Needs review</span>
              </div>
              
              <div className="p-6 bg-[var(--cc-card)] grid grid-cols-12 gap-8">
                
                {/* Main Content: SOP & Evidence */}
                <div className="col-span-8 space-y-8">
                  {/* SOP Transcript */}
                  <div>
                    <h3 className="text-sm font-semibold text-[var(--cc-fg)] uppercase tracking-wider mb-4 flex items-center gap-2">
                      <FileText className="w-4 h-4 text-[var(--cc-muted-fg)]" /> SOP Transcript
                    </h3>
                    <div className="space-y-3 text-sm">
                      <div className="flex items-baseline gap-3">
                        <span className="text-[var(--cc-muted-fg)] w-6 shrink-0">Q1</span>
                        <span className="text-[var(--cc-fg)] flex-1">Submitted on time?</span>
                        <span className="font-medium text-[var(--cc-success)]">Yes</span>
                      </div>
                      <div className="flex items-baseline gap-3">
                        <span className="text-[var(--cc-muted-fg)] w-6 shrink-0">Q2</span>
                        <span className="text-[var(--cc-fg)] flex-1">Remittance received?</span>
                        <span className="font-medium text-[var(--cc-success)]">Yes</span>
                      </div>
                      <div className="flex items-baseline gap-3">
                        <span className="text-[var(--cc-muted-fg)] w-6 shrink-0">Q3</span>
                        <span className="text-[var(--cc-fg)] flex-1">Claim authorized?</span>
                        <span className="font-medium text-[var(--cc-destructive)]">No</span>
                      </div>
                      <div className="flex items-baseline gap-3 bg-[var(--cc-amber-bg)] -mx-3 p-3 rounded-md">
                        <span className="text-[var(--cc-amber-fg)] w-6 shrink-0 font-medium">Q4</span>
                        <span className="text-[var(--cc-amber-fg)] flex-1 font-medium">Appeal in 90 days?</span>
                        <span className="font-semibold flex items-center gap-1.5 text-[var(--cc-amber-fg)]">
                          <AlertTriangle className="w-3.5 h-3.5" /> Blocked
                        </span>
                      </div>
                      <div className="text-xs text-[var(--cc-amber-fg)] pl-12">Waiting on auth-denial doc</div>
                    </div>
                  </div>

                  {/* Evidence */}
                  <div>
                    <h3 className="text-sm font-semibold text-[var(--cc-fg)] uppercase tracking-wider mb-4 flex items-center gap-2">
                      <Paperclip className="w-4 h-4 text-[var(--cc-muted-fg)]" /> Evidence (2/3)
                    </h3>
                    <div className="space-y-2 mb-4">
                      <div className="flex items-center justify-between p-2.5 border border-[var(--cc-border)] rounded-md bg-[var(--cc-muted)]/50">
                        <div className="flex items-center gap-3 text-sm">
                          <CheckCircle2 className="w-4 h-4 text-[var(--cc-success)]" />
                          <span className="font-medium text-[var(--cc-fg)]">claim.pdf</span>
                          <span className="text-[var(--cc-muted-fg)] text-xs">Apr 13 · 84 KB</span>
                        </div>
                      </div>
                      <div className="flex items-center justify-between p-2.5 border border-[var(--cc-border)] rounded-md bg-[var(--cc-muted)]/50">
                        <div className="flex items-center gap-3 text-sm">
                          <CheckCircle2 className="w-4 h-4 text-[var(--cc-success)]" />
                          <span className="font-medium text-[var(--cc-fg)]">remittance.pdf</span>
                          <span className="text-[var(--cc-muted-fg)] text-xs">Apr 13 · 122 KB</span>
                        </div>
                      </div>
                      <div className="flex items-center justify-between p-2.5 border border-[var(--cc-red-border)] rounded-md bg-[var(--cc-red-bg)] border-dashed">
                        <div className="flex items-center gap-3 text-sm">
                          <X className="w-4 h-4 text-[var(--cc-red-fg)]" />
                          <span className="font-medium text-[var(--cc-red-fg)]">auth_denial.png</span>
                          <span className="text-[var(--cc-red-fg)] opacity-80 text-xs">Suggested by Q4</span>
                        </div>
                        <span className="cc-badge bg-[var(--cc-card)] text-[var(--cc-red-fg)] border-[var(--cc-red-border)]">Missing</span>
                      </div>
                    </div>
                    {/* Drag Drop Zone */}
                    <div className="border-2 border-dashed border-[var(--cc-border)] rounded-md p-6 text-center hover:bg-[var(--cc-muted)] transition-colors cursor-pointer group">
                      <UploadCloud className="w-6 h-6 text-[var(--cc-muted-fg)] mx-auto mb-2 group-hover:text-[var(--cc-fg)]" />
                      <div className="text-sm font-medium text-[var(--cc-fg)]">Drop auth_denial.png here</div>
                      <div className="text-xs text-[var(--cc-muted-fg)] mt-1">or click to browse</div>
                    </div>
                  </div>
                  
                  <div className="pt-2">
                    <button className="text-sm font-medium text-[var(--cc-primary)] hover:underline flex items-center gap-1.5">
                      Walk this SOP in Queue <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Sidebar: Actions */}
                <div className="col-span-4 border-l border-[var(--cc-border)] pl-6 space-y-6">
                  <div>
                    <h3 className="text-xs font-semibold text-[var(--cc-muted-fg)] uppercase tracking-wider mb-3">Leg Actions</h3>
                    <div className="flex flex-col gap-2">
                      <button className="cc-btn cc-btn-ghost justify-start w-full text-[var(--cc-fg)]"><ShieldAlert className="w-4 h-4 text-[var(--cc-muted-fg)]" /> Reclassify</button>
                      <button className="cc-btn cc-btn-ghost justify-start w-full text-[var(--cc-fg)]"><X className="w-4 h-4 text-[var(--cc-muted-fg)]" /> Exclude</button>
                      <button className="cc-btn cc-btn-ghost justify-start w-full text-[var(--cc-fg)]"><CheckCircle2 className="w-4 h-4 text-[var(--cc-muted-fg)]" /> Handled offline</button>
                      <button className="cc-btn cc-btn-ghost justify-start w-full text-[var(--cc-fg)]"><FileText className="w-4 h-4 text-[var(--cc-muted-fg)]" /> Mark sibling dup</button>
                    </div>
                  </div>
                </div>

              </div>
            </div>

            {/* Leg C - Collapsed */}
            <div className="cc-card p-3 flex items-center justify-between hover:bg-[var(--cc-muted)] cursor-pointer transition-colors group opacity-60">
              <div className="flex items-center gap-4">
                <ChevronRight className="w-4 h-4 text-[var(--cc-muted-fg)] group-hover:text-[var(--cc-fg)]" />
                <span className="font-medium w-16">Leg C</span>
                <span className="mono text-[var(--cc-muted-fg)] text-sm">TX-558822</span>
                <span className="text-sm text-[var(--cc-muted-fg)] w-24">Coding</span>
                <span className="text-sm text-[var(--cc-muted-fg)]">Apr 11 · $19.00</span>
              </div>
              <div className="flex items-center gap-6">
                <span className="text-xs text-[var(--cc-muted-fg)]">SOP Q1/4 · 0/2 files</span>
                <span className="cc-badge bg-[var(--cc-muted)] text-[var(--cc-muted-fg)] border-[var(--cc-border)] w-20 justify-center">On hold</span>
              </div>
            </div>

          </div>

          <div className="text-sm italic text-[var(--cc-muted-fg)] pl-4 pt-2">
            + 2 hidden — 1 excluded, 1 sibling-dup of Leg A (inherits Leg A's SOP & evidence)
          </div>
        </section>


        {/* History Rail */}
        <section className="space-y-6 font-sans">
          <h2 className="text-xl font-serif text-[var(--cc-fg)] pb-2 border-b border-[var(--cc-border)]">History & Communications</h2>
          
          <div className="space-y-4">
            
            {/* Communication Card */}
            <div className="cc-card p-4 flex items-start gap-4 border-l-4 border-l-[var(--cc-purple-fg)]">
              <div className="p-2 rounded-full bg-[var(--cc-purple-bg)] text-[var(--cc-purple-fg)]">
                <MessageSquare className="w-5 h-5" />
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-[var(--cc-fg)]">Communication</h3>
                  <span className="text-sm text-[var(--cc-muted-fg)]">0 new</span>
                </div>
                <p className="text-sm text-[var(--cc-muted-fg)] mt-1">Read portal replies and email threads.</p>
              </div>
              <ChevronRight className="w-5 h-5 text-[var(--cc-border)] self-center" />
            </div>

            {/* Notes & Audit Card */}
            <div className="cc-card p-4 flex items-start gap-4 border-l-4 border-l-[var(--cc-blue-fg)]">
              <div className="p-2 rounded-full bg-[var(--cc-blue-bg)] text-[var(--cc-blue-fg)]">
                <History className="w-5 h-5" />
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-[var(--cc-fg)]">Notes & Audit</h3>
                  <span className="text-sm text-[var(--cc-muted-fg)]">15 entries</span>
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <span className="cc-badge bg-[var(--cc-muted)] text-[var(--cc-muted-fg)] border-none text-[10px]">Leg B</span>
                  <p className="text-sm text-[var(--cc-muted-fg)] truncate">SOP step Q3 completed by jsmith</p>
                </div>
              </div>
              <ChevronRight className="w-5 h-5 text-[var(--cc-border)] self-center" />
            </div>

            {/* Overrides Card */}
            <div className="cc-card p-4 flex items-start gap-4 border-l-4 border-l-[var(--cc-amber-fg)]">
              <div className="p-2 rounded-full bg-[var(--cc-amber-bg)] text-[var(--cc-amber-fg)]">
                <Gavel className="w-5 h-5" />
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-[var(--cc-fg)]">Overrides</h3>
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <span className="cc-badge bg-[var(--cc-muted)] text-[var(--cc-fg)] border-[var(--cc-border)] text-[10px]">Hold</span>
                  <span className="cc-badge bg-[var(--cc-muted)] text-[var(--cc-fg)] border-[var(--cc-border)] text-[10px]">Withdraw</span>
                  <span className="cc-badge bg-[var(--cc-muted)] text-[var(--cc-fg)] border-[var(--cc-border)] text-[10px]">Close</span>
                  <span className="cc-badge bg-[var(--cc-muted)] text-[var(--cc-fg)] border-[var(--cc-border)] text-[10px]">Mark Denied</span>
                </div>
              </div>
              <ChevronRight className="w-5 h-5 text-[var(--cc-border)] self-center" />
            </div>

          </div>
        </section>

      </div>
    </div>
  );
}

function LifecycleStep({ label, date, status }: { label: string, date?: string, status: "done" | "current" | "pending" }) {
  const isDone = status === "done";
  const isCurrent = status === "current";
  
  return (
    <div className={`flex flex-col items-center gap-1.5 ${status === "pending" ? "opacity-50" : ""}`}>
      <div className="flex items-center gap-1.5">
        {isDone ? (
          <CheckCircle2 className="w-3.5 h-3.5 text-[var(--cc-success)]" />
        ) : isCurrent ? (
          <div className="w-3.5 h-3.5 rounded-full bg-[var(--cc-primary)] border-2 border-[var(--cc-bg)] shadow-[0_0_0_1px_var(--cc-primary)]" />
        ) : (
          <div className="w-3.5 h-3.5 rounded-full border-2 border-[var(--cc-muted-fg)]" />
        )}
        <span className={`text-xs font-medium ${isCurrent ? "text-[var(--cc-primary)]" : "text-[var(--cc-fg)]"}`}>{label}</span>
      </div>
      {date && <span className="text-[10px] text-[var(--cc-muted-fg)]">{date}</span>}
    </div>
  );
}
