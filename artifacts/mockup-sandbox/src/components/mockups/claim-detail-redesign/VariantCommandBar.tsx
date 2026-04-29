import "./_group.css";
import React from "react";
import {
  AlertCircle,
  ArrowRight,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDashed,
  Edit2,
  Inbox,
  Mail,
  MoreVertical,
  Paperclip,
  PauseCircle,
  Play,
  Send,
  Tag,
  X,
  Activity,
  MessageSquare,
  FileText
} from "lucide-react";
import {
  claim,
  evidenceItems,
  auditLog,
  responses,
  InvoiceContextBar,
  PresenceAvatars,
  StatusPill,
  Section
} from "./_shared";

const stages = [
  { key: "triage", label: "Triage", desc: "Identify the error" },
  { key: "build", label: "Build Case", desc: "Gather evidence" },
  { key: "submit", label: "Submit", desc: "Send to payer" },
  { key: "await", label: "Await Response", desc: "Track payer reply" },
  { key: "resolve", label: "Resolve", desc: "Close the loop" },
];
const currentStage = "triage";

export function VariantCommandBar() {
  return (
    <div className="cc-scope relative flex flex-col" style={{ width: "100%", background: "var(--cc-bg)" }}>
      {/* Top Breadcrumb Context */}
      <div className="px-6 pt-6 pb-4">
        <InvoiceContextBar />
      </div>

      {/* STICKY COMMAND BAR */}
      <div 
        className="sticky top-0 z-50 flex items-center justify-between px-6 py-3 cc-card mx-6 mb-4 shadow-sm"
        style={{ border: "1px solid var(--cc-border)" }}
      >
        {/* Left: Claim Identity & State */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 mr-2">
            <h1 className="text-lg font-bold mono m-0 leading-none">{claim.confNumber}</h1>
          </div>
          <StatusPill status={claim.status} />
          <span className="cc-badge cc-badge-secondary">{claim.outcome}</span>
          <div className="w-px h-4 mx-2" style={{ background: "var(--cc-border)" }} />
          <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--cc-muted-fg)" }}>
            Step 1 of 5
          </span>
        </div>

        {/* Center: The SINGLE Primary Action */}
        <div className="flex-1 flex justify-center">
          <button className="cc-btn cc-btn-primary px-6 py-2 shadow-sm flex items-center gap-2">
            <span>Triage this claim</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>

        {/* Right: Secondary Actions & Overflow */}
        <div className="flex items-center gap-2 relative">
          <button className="cc-btn cc-btn-ghost text-sm">
            <PauseCircle className="w-4 h-4" /> Place on hold
          </button>
          
          <button className="cc-btn text-sm flex items-center gap-1" style={{ background: "var(--cc-muted)" }}>
            More actions <ChevronDown className="w-4 h-4" />
          </button>

          {/* Rendered Open Overflow Menu (as requested in brief) */}
          <div className="absolute top-full right-0 mt-2 w-64 cc-card shadow-lg py-1 z-50 border" style={{ borderColor: "var(--cc-border)" }}>
            <div className="px-3 py-2 text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--cc-muted-fg)" }}>
              Change Status
            </div>
            <div className="px-2 mb-1">
              <select className="cc-select text-xs py-1" defaultValue={claim.status}>
                <option>Submitted</option>
                <option>Closed</option>
                <option>Needs Review</option>
                <option>Needs Evidence</option>
                <option>On Hold</option>
              </select>
            </div>
            
            <div className="cc-divider my-1" />
            
            <button className="w-full text-left px-3 py-1.5 text-sm hover:bg-[var(--cc-muted)] flex items-center gap-2">
              <Send className="w-3.5 h-3.5" style={{ color: "var(--cc-muted-fg)" }} /> Queue for portal
            </button>
            
            <div className="cc-divider my-1" />
            <div className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--cc-muted-fg)" }}>
              Resolve Claim
            </div>
            
            <button className="w-full text-left px-3 py-1.5 text-sm hover:bg-[var(--cc-muted)] flex items-center gap-2">
              <CheckCircle2 className="w-3.5 h-3.5 text-green-600" /> Mark as Approved
            </button>
            <button className="w-full text-left px-3 py-1.5 text-sm hover:bg-[var(--cc-muted)] flex items-center gap-2">
              <CheckCircle2 className="w-3.5 h-3.5 text-amber-600" /> Mark as Partially Approved
            </button>
            <button className="w-full text-left px-3 py-1.5 text-sm hover:bg-[var(--cc-muted)] flex items-center gap-2">
              <X className="w-3.5 h-3.5 text-red-600" /> Mark as Payer Denied
            </button>
            
            <div className="cc-divider my-1" />
            <div className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--cc-muted-fg)" }}>
              Other Outcomes
            </div>
            
            <button className="w-full text-left px-3 py-1.5 text-sm hover:bg-[var(--cc-muted)]">Withdraw — Not Contestable</button>
            <button className="w-full text-left px-3 py-1.5 text-sm hover:bg-[var(--cc-muted)]">Withdraw — Accepted Loss</button>
            <button className="w-full text-left px-3 py-1.5 text-sm hover:bg-[var(--cc-muted)]">Mark Non-Issue</button>
          </div>
        </div>
      </div>

      {/* STAGE STEPPER */}
      <div className="px-6 mb-6">
        <div className="cc-card overflow-hidden">
          <div className="flex">
            {stages.map((s, i) => {
              const idx = stages.findIndex(x => x.key === currentStage);
              const state = i < idx ? "done" : i === idx ? "active" : "todo";
              return (
                <div key={s.key} className="flex-1 px-4 py-3 flex items-center gap-3 relative" style={{
                  background: state === "active" ? "var(--cc-blue-bg)" : state === "done" ? "var(--cc-card)" : "var(--cc-muted)",
                  color: state === "active" ? "var(--cc-blue-fg)" : state === "todo" ? "var(--cc-muted-fg)" : "var(--cc-fg)",
                  borderRight: i < stages.length - 1 ? "1px solid var(--cc-border)" : "none",
                }}>
                  {state === "done" ? <CheckCircle2 className="w-4 h-4 flex-shrink-0" style={{ color: "var(--cc-success)" }} /> :
                   state === "active" ? <Play className="w-4 h-4 flex-shrink-0" fill="currentColor" /> :
                   <div className="w-4 h-4 rounded-full border flex-shrink-0" style={{ borderColor: "var(--cc-border)" }} />}
                  <div className="min-w-0">
                    <div className="text-xs font-semibold truncate">{s.label}</div>
                  </div>
                  {i < stages.length - 1 && (
                    <ChevronRight className="w-4 h-4 absolute -right-2 top-1/2 -translate-y-1/2 z-10" style={{ color: "var(--cc-muted-fg)", background: "var(--cc-bg)" }} />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* 2-COLUMN MAIN CONTENT */}
      <div className="px-6 pb-12 grid grid-cols-12 gap-6">
        
        {/* Main Column (2/3) */}
        <div className="col-span-8 space-y-6">
          
          <Section title="Claim Details" icon={<FileText className="w-4 h-4" />}>
            <div className="grid grid-cols-3 gap-x-6 gap-y-4 text-sm">
              <Stat label="Conf #" value={claim.confNumber} mono />
              <Stat label="Date" value={claim.date} />
              <Stat label="Client #" value={claim.clientNumber} />
              <Stat label="Car #" value={claim.carNumber} />
              <Stat label="Amount" value={claim.claimAmount} />
              <Stat label="Payor Email" value={claim.payorEmail} />
            </div>
            <div className="cc-divider my-4" />
            <div className="grid grid-cols-2 gap-x-6 gap-y-4">
              <div>
                <div className="text-xs mb-1" style={{ color: "var(--cc-muted-fg)" }}>Ref #</div>
                <div className="text-sm font-medium mono">{claim.refNumber}</div>
              </div>
              <div>
                <div className="text-xs mb-1" style={{ color: "var(--cc-muted-fg)" }}>Error Type</div>
                <div className="text-sm font-medium flex items-center gap-1.5" style={{ color: "var(--cc-amber-fg)" }}>
                  <AlertCircle className="w-4 h-4" /> unassigned
                </div>
              </div>
            </div>
            <div className="mt-4">
              <div className="text-xs mb-2" style={{ color: "var(--cc-muted-fg)" }}>Error Details</div>
              <div className="bg-gray-50 rounded p-3 text-sm" style={{ background: "var(--cc-muted)", border: "1px solid var(--cc-border)" }}>
                <ul className="space-y-1.5">
                  {claim.errorDetails.split(";").map((p, i) => (
                    <li key={i} className="flex gap-2">
                      <span style={{ color: "var(--cc-muted-fg)" }}>&bull;</span>
                      <span>{p.trim()}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </Section>

          <Section title="Dispute Workflow" icon={<Activity className="w-4 h-4" />}>
            <div className="rounded p-4" style={{ background: "var(--cc-blue-bg)", border: "1px solid var(--cc-blue-border)" }}>
              <div className="flex items-center gap-2 mb-3">
                <span className="cc-badge" style={{ background: "white", color: "var(--cc-blue-fg)", border: "1px solid var(--cc-blue-border)" }}>Triage Step</span>
                <span className="text-xs" style={{ color: "var(--cc-blue-fg)", opacity: 0.8 }}>Identify issue</span>
              </div>
              <div className="font-medium mb-3 text-base" style={{ color: "var(--cc-blue-fg)" }}>Is this claim actually contestable?</div>
              <div className="flex flex-col gap-2">
                <label className="flex items-center gap-3 p-3 rounded bg-white cursor-pointer hover:bg-gray-50 transition border" style={{ borderColor: "var(--cc-border)" }}>
                  <input type="radio" name="workflow_q" className="w-4 h-4 text-blue-600" />
                  <span className="text-sm font-medium">Yes, the error can be disputed</span>
                </label>
                <label className="flex items-center gap-3 p-3 rounded bg-white cursor-pointer hover:bg-gray-50 transition border" style={{ borderColor: "var(--cc-border)" }}>
                  <input type="radio" name="workflow_q" className="w-4 h-4 text-blue-600" />
                  <span className="text-sm font-medium">No, this is a valid denial / non-contestable</span>
                </label>
              </div>
            </div>
          </Section>

          <Section title={<>Evidence <span className="cc-badge cc-badge-secondary ml-2">{evidenceItems.length}</span></>} icon={<Paperclip className="w-4 h-4" />}>
            <div className="space-y-3">
              {evidenceItems.map(e => (
                <div key={e.id} className="flex items-start justify-between text-sm p-3 rounded border" style={{ borderColor: "var(--cc-border)", background: "var(--cc-card)" }}>
                  <div className="flex items-start gap-3">
                    <CheckCircle2 className="w-4 h-4 mt-0.5" style={{ color: "var(--cc-success)" }} />
                    <div>
                      <div className="font-medium">{e.type}</div>
                      <div className="text-xs mt-0.5" style={{ color: "var(--cc-muted-fg)" }}>{e.note}</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs" style={{ color: "var(--cc-muted-fg)" }}>{e.at}</div>
                    <div className="text-xs mt-0.5" style={{ color: "var(--cc-muted-fg)" }}>by {e.by}</div>
                  </div>
                </div>
              ))}
            </div>
          </Section>
          
        </div>

        {/* Right Rail Column (1/3) - Pure Context */}
        <div className="col-span-4 space-y-6">
          
          <div className="cc-card p-4 space-y-4 text-sm" style={{ background: "var(--cc-muted)", border: "1px solid var(--cc-border)" }}>
            <div className="font-semibold text-xs uppercase tracking-wider" style={{ color: "var(--cc-muted-fg)" }}>Claim Context</div>
            <div className="grid grid-cols-2 gap-y-3">
              <div>
                <div className="text-xs mb-0.5" style={{ color: "var(--cc-muted-fg)" }}>Member</div>
                <div className="font-medium">{claim.clientNumber}</div>
              </div>
              <div>
                <div className="text-xs mb-0.5" style={{ color: "var(--cc-muted-fg)" }}>Vehicle</div>
                <div className="font-medium">{claim.carNumber}</div>
              </div>
              <div className="col-span-2">
                <div className="text-xs mb-0.5" style={{ color: "var(--cc-muted-fg)" }}>Payor</div>
                <div className="font-medium">{claim.payorEmail}</div>
              </div>
              <div>
                <div className="text-xs mb-0.5" style={{ color: "var(--cc-muted-fg)" }}>Amount</div>
                <div className="font-medium">{claim.claimAmount}</div>
              </div>
              <div>
                <div className="text-xs mb-0.5" style={{ color: "var(--cc-muted-fg)" }}>Date</div>
                <div className="font-medium">{claim.date}</div>
              </div>
            </div>
          </div>

          <div className="cc-card flex flex-col h-[400px]">
            <div className="px-4 py-3 font-semibold text-sm border-b flex items-center gap-2" style={{ borderColor: "var(--cc-border)" }}>
              <Activity className="w-4 h-4" /> Activity Feed
            </div>
            
            <div className="flex-1 overflow-y-auto p-4 space-y-4 text-sm">
              {auditLog.map(a => (
                <div key={a.id} className="flex gap-3">
                  <div className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0" style={{ background: a.viaGroup ? "var(--cc-purple-fg)" : "var(--cc-primary)" }} />
                  <div className="flex-1">
                    <div className="font-medium" style={{ color: "var(--cc-fg)" }}>{a.action}</div>
                    <div className="text-xs mt-0.5 flex items-center gap-1.5" style={{ color: "var(--cc-muted-fg)" }}>
                      <span>{a.actor}</span><span>&middot;</span><span>{a.at}</span>
                      {a.viaGroup && <span className="cc-badge" style={{ fontSize: 10, padding: "0 4px", background: "var(--cc-purple-bg)", color: "var(--cc-purple-fg)", border: "none" }}>via group</span>}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="p-3 border-t bg-gray-50" style={{ borderColor: "var(--cc-border)", background: "var(--cc-muted)" }}>
              <div className="relative">
                <textarea 
                  className="cc-input w-full text-sm resize-none pr-10" 
                  rows={2} 
                  placeholder="Type a note..."
                  style={{ background: "var(--cc-card)" }}
                />
                <button className="absolute bottom-2 right-2 p-1.5 rounded bg-blue-50 text-blue-600 hover:bg-blue-100 transition">
                  <Send className="w-3 h-3" />
                </button>
              </div>
            </div>
          </div>

        </div>

      </div>
    </div>
  );
}

function Stat({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-xs mb-1" style={{ color: "var(--cc-muted-fg)" }}>{label}</div>
      <div className={`text-sm font-medium ${mono ? "mono" : ""}`}>{value}</div>
    </div>
  );
}
