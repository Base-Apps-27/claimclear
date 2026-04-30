import "./_group.css";
import {
  ArrowRight, Mail, ChevronRight, FileCheck2, Send, Inbox, CheckCircle2,
  CircleDashed, AlertCircle, PauseCircle, Edit2, Tag, Paperclip, MessageSquare,
} from "lucide-react";
import { claim, evidenceItems, responses, auditLog, InvoiceContextBar, PresenceAvatars, StatusPill } from "./_shared";

const stages = [
  { key: "triage",   label: "Classify",       desc: "Identify the error" },
  { key: "build",    label: "Build Case",     desc: "Gather evidence" },
  { key: "submit",   label: "Submit",         desc: "Send to payer" },
  { key: "await",    label: "Await Response", desc: "Track payer reply" },
  { key: "resolve",  label: "Resolve",        desc: "Close the loop" },
];
const currentStage = "await";

export function VariantStepper() {
  return (
    <div className="cc-scope p-6 space-y-4" style={{ width: "100%" }}>
      <InvoiceContextBar />

      {/* HEADER */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div>
            <div className="text-xs" style={{ color: "var(--cc-muted-fg)" }}>Claim</div>
            <div className="flex items-center gap-3 mt-0.5">
              <h2 className="text-2xl font-bold mono">{claim.confNumber}</h2>
              <StatusPill status={claim.status} />
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <PresenceAvatars />
          <button className="cc-btn cc-btn-ghost"><Edit2 className="w-3.5 h-3.5" />Edit details</button>
        </div>
      </div>

      {/* THE STEPPER — the only action surface visible above the fold */}
      <div className="cc-card overflow-hidden">
        <div className="flex" style={{ borderBottom: "1px solid var(--cc-border)" }}>
          {stages.map((s, i) => {
            const idx = stages.findIndex(x => x.key === currentStage);
            const state = i < idx ? "done" : i === idx ? "active" : "todo";
            return (
              <div key={s.key} className="flex-1 px-4 py-3 flex items-center gap-3 relative" style={{
                background: state === "active" ? "var(--cc-blue-bg)" : state === "done" ? "var(--cc-card)" : "var(--cc-muted)",
                color: state === "active" ? "var(--cc-blue-fg)" : state === "todo" ? "var(--cc-muted-fg)" : "var(--cc-fg)",
              }}>
                {state === "done" ? <CheckCircle2 className="w-5 h-5" style={{ color: "var(--cc-success)" }} /> :
                 state === "active" ? <CircleDashed className="w-5 h-5" /> :
                 <div className="w-5 h-5 rounded-full border" style={{ borderColor: "var(--cc-border)" }} />}
                <div className="min-w-0">
                  <div className="text-xs uppercase tracking-wide" style={{ opacity: 0.7 }}>{`Step ${i + 1}`}</div>
                  <div className="text-sm font-semibold truncate">{s.label}</div>
                </div>
                {i < stages.length - 1 && <ChevronRight className="w-4 h-4 absolute -right-2 top-1/2 -translate-y-1/2 z-10" style={{ color: "var(--cc-border)", background: "var(--cc-bg)" }} />}
              </div>
            );
          })}
        </div>

        {/* ONLY this stage's actions */}
        <div className="p-5">
          <div className="flex items-start gap-4">
            <div className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center" style={{ background: "var(--cc-blue-bg)", color: "var(--cc-blue-fg)" }}>
              <Inbox className="w-5 h-5" />
            </div>
            <div className="flex-1">
              <div className="text-base font-semibold">A response was received — review and decide</div>
              <div className="text-sm mt-0.5" style={{ color: "var(--cc-muted-fg)" }}>
                <Mail className="w-3.5 h-3.5 inline mr-1" />MAS Adjudicator replied <strong>Denied</strong> · received Apr 27, 2:15pm
              </div>
              <div className="mt-3 rounded p-3 text-sm" style={{ background: "var(--cc-red-bg)", color: "var(--cc-red-fg)", border: "1px solid var(--cc-red-border)" }}>
                "After review, the claim is denied. The trip exceeded the approved mileage authorization for rate code R-12."
              </div>

              <div className="mt-4">
                <div className="text-xs uppercase tracking-wide font-semibold mb-2" style={{ color: "var(--cc-muted-fg)" }}>What's next?</div>
                <div className="grid grid-cols-3 gap-2">
                  <ActionTile primary icon={<CheckCircle2 className="w-4 h-4" />} label="Accept loss" sub="Close the claim — won't re-dispute" />
                  <ActionTile icon={<Send className="w-4 h-4" />} label="Re-dispute" sub="Build a new case with more evidence" />
                  <ActionTile icon={<PauseCircle className="w-4 h-4" />} label="Place on hold" sub="Pause while waiting on info" />
                </div>
                <div className="mt-3 text-xs" style={{ color: "var(--cc-muted-fg)" }}>
                  Need to fix something earlier? <a href="#" style={{ color: "var(--cc-primary)" }}>Reopen Classify</a> · <a href="#" style={{ color: "var(--cc-primary)" }}>Reopen Submit</a>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* CALM BODY: read-only summary + activity */}
      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2 space-y-4">
          <div className="cc-card p-4">
            <div className="flex items-center justify-between mb-3"><div className="text-sm font-semibold">Claim summary</div><button className="cc-btn cc-btn-ghost cc-btn-sm"><Edit2 className="w-3 h-3" />Edit</button></div>
            <div className="grid grid-cols-3 gap-x-4 gap-y-3 text-sm">
              <Stat label="Date" value={claim.date} />
              <Stat label="Amount" value={claim.claimAmount} />
              <Stat label="Car #" value={claim.carNumber} />
              <Stat label="Client #" value={claim.clientNumber} />
              <Stat label="Ref #" value={claim.refNumber} mono />
              <Stat label="Payor" value={claim.payorEmail} />
            </div>
            <div className="cc-divider my-3" />
            <div className="text-xs mb-1.5" style={{ color: "var(--cc-muted-fg)" }}>Why this was rejected</div>
            <ul className="text-sm space-y-1">
              {claim.errorDetails.split(";").map((p, i) => <li key={i}>· {p.trim()}</li>)}
            </ul>
            <div className="mt-3 flex items-center gap-2">
              <span className="text-xs" style={{ color: "var(--cc-muted-fg)" }}>Error type:</span>
              <button className="cc-btn cc-btn-sm" style={{ background: "var(--cc-amber-bg)", color: "var(--cc-amber-fg)", borderColor: "var(--cc-amber-border)" }}>
                <Tag className="w-3 h-3" />Assign type
              </button>
            </div>
          </div>

          {/* Quiet evidence list — view-only here */}
          <div className="cc-card p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-semibold flex items-center gap-2"><Paperclip className="w-4 h-4" />Evidence ({evidenceItems.length})</div>
              <button className="cc-btn cc-btn-ghost cc-btn-sm">Manage in Build Case</button>
            </div>
            <ul className="text-sm space-y-1.5">
              {evidenceItems.map(e => (
                <li key={e.id} className="flex items-center justify-between">
                  <span><CheckCircle2 className="w-3.5 h-3.5 inline mr-2" style={{ color: "var(--cc-success)" }} />{e.type}</span>
                  <span className="text-xs" style={{ color: "var(--cc-muted-fg)" }}>{e.at}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Activity feed merged (notes + audit + group rows) */}
        <div className="cc-card p-4">
          <div className="text-sm font-semibold mb-3 flex items-center gap-2"><MessageSquare className="w-4 h-4" />Activity</div>
          <div className="space-y-3 text-sm">
            {auditLog.map(a => (
              <div key={a.id} className="flex gap-2">
                <div className="w-1.5 h-1.5 rounded-full mt-2 flex-shrink-0" style={{ background: a.viaGroup ? "var(--cc-purple-fg)" : "var(--cc-primary)" }} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm">{a.action}</div>
                  <div className="text-xs flex items-center gap-1.5 mt-0.5" style={{ color: "var(--cc-muted-fg)" }}>
                    <span>{a.actor}</span><span>·</span><span>{a.at}</span>
                    {a.viaGroup && <span className="cc-badge cc-badge-sm" style={{ fontSize: 10, padding: "0 6px", background: "var(--cc-purple-bg)", color: "var(--cc-purple-fg)", border: "none" }}>via group</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ActionTile({ icon, label, sub, primary }: { icon: React.ReactNode; label: string; sub: string; primary?: boolean }) {
  return (
    <button className="text-left rounded-md p-3 transition-colors" style={{
      background: primary ? "var(--cc-primary)" : "var(--cc-card)",
      color: primary ? "var(--cc-primary-fg)" : "var(--cc-fg)",
      border: "1px solid " + (primary ? "var(--cc-primary)" : "var(--cc-border)"),
    }}>
      <div className="flex items-center gap-2 font-semibold text-sm">{icon}{label}</div>
      <div className="text-xs mt-1" style={{ opacity: primary ? 0.85 : 0.6 }}>{sub}</div>
    </button>
  );
}

function Stat({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-xs" style={{ color: "var(--cc-muted-fg)" }}>{label}</div>
      <div className={`text-sm mt-0.5 font-medium ${mono ? "mono" : ""}`}>{value}</div>
    </div>
  );
}
