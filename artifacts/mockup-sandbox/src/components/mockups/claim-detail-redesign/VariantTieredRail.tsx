import React, { useState } from "react";
import "./_group.css";
import {
  AlertTriangle,
  TreeDeciduous,
  Trash2,
  Inbox,
  Mail,
  MessagesSquare,
  ArrowRight,
  CheckCircle2,
  X,
  Eye,
  ChevronDown,
  ChevronRight,
  Clock,
  Send,
  PauseCircle,
  Paperclip,
  Activity,
  Edit2,
  CircleDashed,
  ChevronUp,
  MessageSquarePlus,
  Play
} from "lucide-react";
import {
  claim,
  evidenceItems,
  submissions,
  responses,
  emails,
  auditLog,
  StatusPill,
  PresenceAvatars,
  validOutcomes,
  validStatuses,
  InvoiceContextBar,
  Section
} from "./_shared";

const stages = [
  { key: "triage", label: "Classify", desc: "Identify the error" },
  { key: "build", label: "Build Case", desc: "Gather evidence" },
  { key: "submit", label: "Submit", desc: "Send to payer" },
  { key: "await", label: "Await Response", desc: "Track payer reply" },
  { key: "resolve", label: "Resolve", desc: "Close the loop" },
];
const currentStage = "triage";

export function VariantTieredRail() {
  const [showMoreOutcomes, setShowMoreOutcomes] = useState(false);

  return (
    <div className="cc-scope p-6 space-y-5" style={{ width: "100%" }}>
      <InvoiceContextBar />

      {/* HEADER STRIP */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-2xl font-bold mono">{claim.confNumber}</h2>
          <StatusPill status={claim.status} />
          <span className="cc-badge cc-badge-secondary">{claim.outcome}</span>
        </div>
        <div className="flex items-center gap-2">
          <PresenceAvatars />
          <button className="cc-btn cc-btn-ghost"><Edit2 className="w-4 h-4" />Edit</button>
        </div>
      </div>

      {/* STAGE STEPPER */}
      <div className="cc-card overflow-hidden">
        <div className="flex">
          {stages.map((s, i) => {
            const idx = stages.findIndex((x) => x.key === currentStage);
            const state = i < idx ? "done" : i === idx ? "active" : "todo";
            return (
              <div
                key={s.key}
                className="flex-1 px-3 py-2.5 flex items-center gap-2.5 relative"
                style={{
                  background: state === "active" ? "var(--cc-blue-bg)" : state === "done" ? "var(--cc-card)" : "var(--cc-muted)",
                  color: state === "active" ? "var(--cc-blue-fg)" : state === "todo" ? "var(--cc-muted-fg)" : "var(--cc-fg)",
                  borderRight: i < stages.length - 1 ? "1px solid var(--cc-border)" : "none",
                }}
              >
                {state === "done" ? (
                  <CheckCircle2 className="w-4 h-4 flex-shrink-0" style={{ color: "var(--cc-success)" }} />
                ) : state === "active" ? (
                  <CircleDashed className="w-4 h-4 flex-shrink-0" />
                ) : (
                  <div className="w-4 h-4 rounded-full border flex-shrink-0" style={{ borderColor: "var(--cc-border)" }} />
                )}
                <div className="min-w-0">
                  <div className="text-[10px] uppercase tracking-wide" style={{ opacity: 0.65 }}>
                    Step {i + 1}
                  </div>
                  <div className="text-xs font-semibold truncate">{s.label}</div>
                </div>
                {i < stages.length - 1 && (
                  <ChevronRight
                    className="w-3 h-3 absolute -right-1.5 top-1/2 -translate-y-1/2 z-10"
                    style={{ color: "var(--cc-muted-fg)", background: "var(--cc-bg)" }}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-5">
        {/* MAIN COLUMN: Informational Only */}
        <div className="col-span-2 space-y-5">
          <Section title="Claim Details">
            <div className="grid grid-cols-2 gap-y-4 gap-x-6 text-sm">
              <Field label="Conf #" value={claim.confNumber} mono />
              <Field label="Date" value={claim.date} />
              <Field label="Client #" value={claim.clientNumber} />
              <Field label="Car #" value={claim.carNumber} />
              <Field label="Amount" value={claim.claimAmount} />
              <Field label="Payor Email" value={claim.payorEmail} />
              
              <div className="col-span-2">
                <div className="text-xs" style={{ color: "var(--cc-muted-fg)" }}>Ref #</div>
                <div className="mt-1 mono font-medium">{claim.refNumber}</div>
              </div>

              <div className="col-span-2">
                <div className="text-xs" style={{ color: "var(--cc-muted-fg)" }}>Error Details</div>
                <div className="mt-1.5 mb-2">
                  <span className="cc-badge" style={{ background: "var(--cc-purple-bg)", color: "var(--cc-purple-fg)", border: "none" }}>Multiple errors detected</span>
                </div>
                <ul className="space-y-1">
                  {claim.errorDetails.split(";").map((p, i) => (
                    <li key={i} className="flex gap-2">
                      <span style={{ color: "var(--cc-muted-fg)" }}>{i + 1}.</span>
                      <span>{p.trim()}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="col-span-2">
                <div className="text-xs" style={{ color: "var(--cc-muted-fg)" }}>Error Type</div>
                <div className="mt-1.5 text-sm font-medium flex items-center gap-2" style={{ color: "var(--cc-amber-fg)" }}>
                  <AlertTriangle className="w-4 h-4" /> Unassigned
                </div>
              </div>
            </div>
          </Section>

          <Section title={<>Dispute Workflow <span className="text-xs font-normal ml-2" style={{ color: "var(--cc-muted-fg)" }}>Decision tree</span></>} icon={<TreeDeciduous className="w-4 h-4" />}>
            <div className="rounded p-4" style={{ background: "var(--cc-muted)", border: "1px solid var(--cc-border)" }}>
              <div className="flex items-center gap-2 mb-3">
                <span className="cc-badge cc-badge-secondary">Step 1</span>
                <span className="text-xs font-medium" style={{ color: "var(--cc-muted-fg)" }}>Identify the dispute path</span>
              </div>
              <div className="font-semibold text-base mb-4">What type of error is this?</div>
              
              {/* Informational Answer Choices, NO action buttons */}
              <div className="space-y-2">
                <div className="p-3 rounded bg-white border border-[var(--cc-border)] hover:border-[var(--cc-primary)] cursor-pointer transition-colors text-sm font-medium">
                  Mileage mismatch
                </div>
                <div className="p-3 rounded bg-white border border-[var(--cc-border)] hover:border-[var(--cc-primary)] cursor-pointer transition-colors text-sm font-medium">
                  Outside authorization window
                </div>
                <div className="p-3 rounded bg-white border border-[var(--cc-border)] hover:border-[var(--cc-primary)] cursor-pointer transition-colors text-sm font-medium">
                  Duplicate charge
                </div>
              </div>
            </div>
          </Section>

          <Section title={<>Evidence <span className="cc-badge cc-badge-secondary ml-2">{evidenceItems.length}</span></>} icon={<Paperclip className="w-4 h-4" />}>
            <div className="space-y-2">
              {evidenceItems.map(ev => (
                <div key={ev.id} className="rounded p-3 text-sm flex items-start justify-between" style={{ background: "var(--cc-bg)", border: "1px solid var(--cc-border)" }}>
                  <div>
                    <div className="font-medium flex items-center gap-2"><CheckCircle2 className="w-4 h-4" style={{ color: "var(--cc-success)" }}/> {ev.type}</div>
                    <div className="text-xs mt-1" style={{ color: "var(--cc-muted-fg)" }}>{ev.note}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px]" style={{ color: "var(--cc-muted-fg)" }}>by {ev.by} · {ev.at}</span>
                  </div>
                </div>
              ))}
              {evidenceItems.length === 0 && (
                <div className="text-sm text-center py-4" style={{ color: "var(--cc-muted-fg)" }}>No evidence collected yet.</div>
              )}
            </div>
          </Section>
        </div>

        {/* RIGHT RAIL: Single Source of Truth for Actions */}
        <div className="col-span-1 space-y-5">
          <div className="cc-card overflow-hidden" style={{ position: "sticky", top: "1.25rem" }}>
            
            {/* TIER 1: Recommended Next */}
            <div className="p-5" style={{ background: "var(--cc-blue-bg)", borderBottom: "1px solid var(--cc-blue-border)" }}>
              <div className="flex items-center justify-between mb-3">
                <div className="text-xs uppercase font-bold tracking-wider" style={{ color: "var(--cc-blue-fg)" }}>Recommended Next</div>
                <div className="text-[10px] font-semibold" style={{ color: "var(--cc-blue-fg)", opacity: 0.7 }}>STEP 1 OF 5</div>
              </div>
              <button className="cc-btn cc-btn-primary w-full justify-center text-base py-2.5 shadow-sm">
                <Play className="w-4 h-4 mr-1" /> Classify this claim
              </button>
              <div className="text-xs text-center mt-3" style={{ color: "var(--cc-blue-fg)", opacity: 0.8 }}>
                Confirm dispute reason and prepare the case
              </div>
            </div>

            {/* TIER 2: Common Actions */}
            <div className="p-4 space-y-4">
              <div className="space-y-2">
                <div className="text-[10px] uppercase font-semibold tracking-wide" style={{ color: "var(--cc-muted-fg)" }}>Status</div>
                <select className="cc-select w-full text-sm font-medium" defaultValue={claim.status}>
                  {validStatuses.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>

              <div className="space-y-2">
                <div className="text-[10px] uppercase font-semibold tracking-wide" style={{ color: "var(--cc-muted-fg)" }}>Workflow</div>
                <button className="cc-btn w-full justify-center text-sm"><Send className="w-4 h-4" /> Queue for portal</button>
                <button className="cc-btn w-full justify-center text-sm"><PauseCircle className="w-4 h-4" /> Place on hold</button>
              </div>
            </div>

            {/* TIER 3: Rare/Destructive Outcomes */}
            <div style={{ borderTop: "1px solid var(--cc-border)" }}>
              <button 
                className="w-full p-4 flex items-center justify-between text-sm font-medium hover:bg-[var(--cc-muted)] transition-colors"
                onClick={() => setShowMoreOutcomes(!showMoreOutcomes)}
              >
                <span>More outcomes</span>
                {showMoreOutcomes ? <ChevronUp className="w-4 h-4" style={{ color: "var(--cc-muted-fg)" }} /> : <ChevronDown className="w-4 h-4" style={{ color: "var(--cc-muted-fg)" }} />}
              </button>
              
              {showMoreOutcomes && (
                <div className="px-4 pb-4 space-y-1.5 bg-[var(--cc-muted)] pt-1">
                  <OutcomeButton label="Mark as Approved" color="var(--cc-success)" />
                  <OutcomeButton label="Mark as Partially Approved" color="var(--cc-success)" />
                  <OutcomeButton label="Mark as Payer Denied" color="var(--cc-red-fg)" />
                  <OutcomeButton label="Withdraw — Not Contestable" desc="No clear path to recover the dollars" />
                  <OutcomeButton label="Withdraw — Accepted Loss" desc="Business decision to accept" />
                  <OutcomeButton label="Mark Non-Issue" desc="No dispute necessary" />
                </div>
              )}
            </div>
          </div>

          <div className="cc-card p-4">
            <div className="text-sm font-semibold mb-3 flex items-center gap-2"><MessageSquarePlus className="w-4 h-4" /> Add a Note</div>
            <textarea className="cc-input text-sm" rows={3} placeholder="Type a note..." />
            <div className="mt-3 flex justify-end">
              <button className="cc-btn cc-btn-primary cc-btn-sm">Save Note</button>
            </div>
          </div>

          <div className="cc-card p-4">
            <div className="text-sm font-semibold mb-4 flex items-center gap-2"><Activity className="w-4 h-4" /> Activity Feed</div>
            <div className="space-y-4">
              {auditLog.slice(0, 4).map(log => (
                <div key={log.id} className="relative pl-4">
                  <div className="absolute left-0 top-1.5 w-1.5 h-1.5 rounded-full" style={{ background: "var(--cc-border)" }} />
                  <div className="text-sm font-medium leading-tight">{log.action}</div>
                  <div className="text-xs mt-0.5" style={{ color: "var(--cc-muted-fg)" }}>{log.actor} · {log.at}</div>
                </div>
              ))}
              <button className="text-xs font-medium w-full text-center py-1 hover:underline" style={{ color: "var(--cc-primary)" }}>View all activity</button>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-xs" style={{ color: "var(--cc-muted-fg)" }}>{label}</div>
      <div className={`text-sm mt-0.5 font-medium ${mono ? "mono" : ""}`}>{value}</div>
    </div>
  );
}

function OutcomeButton({ label, desc, color = "var(--cc-fg)" }: { label: string; desc?: string; color?: string }) {
  return (
    <button className="w-full text-left p-2 rounded hover:bg-white border border-transparent hover:border-[var(--cc-border)] transition-all">
      <div className="text-sm font-medium" style={{ color }}>{label}</div>
      {desc && <div className="text-[10px] mt-0.5" style={{ color: "var(--cc-muted-fg)" }}>{desc}</div>}
    </button>
  );
}
