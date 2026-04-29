import "./_group.css";
import {
  Edit2, CheckCircle2, X, PauseCircle, Send, ArrowRightLeft, Inbox, Mail,
  Tag, Paperclip, Activity, ChevronDown, AlertCircle, Bot, MoreVertical,
} from "lucide-react";
import { claim, evidenceItems, auditLog, responses, InvoiceContextBar, PresenceAvatars, StatusPill } from "./_shared";

export function VariantPinned() {
  return (
    <div className="cc-scope p-6 space-y-4" style={{ width: "100%" }}>
      <InvoiceContextBar />

      {/* HEADER */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-2xl font-bold mono">{claim.confNumber}</h2>
          <StatusPill status={claim.status} />
          <span className="cc-badge">{claim.outcome}</span>
        </div>
        <PresenceAvatars />
      </div>

      <div className="grid grid-cols-12 gap-5">
        {/* MAIN COLUMN — calm, read-only by default, edit on hover */}
        <div className="col-span-8 space-y-5">
          <Section title="Claim details">
            <div className="grid grid-cols-3 gap-x-5 gap-y-3 text-sm">
              <Stat label="Date" value={claim.date} />
              <Stat label="Amount" value={claim.claimAmount} />
              <Stat label="Car #" value={claim.carNumber} />
              <Stat label="Client #" value={claim.clientNumber} />
              <Stat label="Ref #" value={claim.refNumber} mono />
              <Stat label="Payor" value="MAS Medicaid" />
            </div>
            <div className="cc-divider my-4" />
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <div className="text-xs" style={{ color: "var(--cc-muted-fg)" }}>Error details</div>
                <button className="cc-btn cc-btn-ghost cc-btn-sm" style={{ padding: "2px 6px" }}><Edit2 className="w-3 h-3" /></button>
              </div>
              <span className="cc-badge" style={{ background: "var(--cc-blue-bg)", color: "var(--cc-blue-fg)", border: "none" }}>2 errors</span>
              <ul className="text-sm space-y-1 mt-2">
                {claim.errorDetails.split(";").map((p, i) => <li key={i}>· {p.trim()}</li>)}
              </ul>
              <div className="mt-3 text-xs flex items-center gap-2" style={{ color: "var(--cc-muted-fg)" }}>
                <span>Error type:</span>
                <span style={{ color: "var(--cc-amber-fg)" }} className="font-medium flex items-center gap-1"><AlertCircle className="w-3 h-3" />unassigned</span>
              </div>
            </div>
          </Section>

          <Section title={<>Evidence <span className="cc-badge cc-badge-secondary" style={{ marginLeft: 6 }}>{evidenceItems.length}</span></>} icon={<Paperclip className="w-4 h-4" />}>
            <div className="space-y-2">
              {evidenceItems.map(e => (
                <div key={e.id} className="flex items-center justify-between text-sm py-1.5 group">
                  <div className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4" style={{ color: "var(--cc-success)" }} /><span>{e.type}</span><span className="text-xs" style={{ color: "var(--cc-muted-fg)" }}>· {e.note}</span></div>
                  <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition">
                    <span className="text-xs" style={{ color: "var(--cc-muted-fg)" }}>{e.at}</span>
                    <button className="cc-btn cc-btn-ghost cc-btn-sm" style={{ padding: 4 }}><MoreVertical className="w-3 h-3" /></button>
                  </div>
                </div>
              ))}
            </div>
          </Section>

          <Section title={<>Latest response <span className="cc-badge" style={{ marginLeft: 6, background: "var(--cc-red-bg)", color: "var(--cc-red-fg)", border: "none" }}>Denied</span></>} icon={<Inbox className="w-4 h-4" />}>
            {responses.map(r => (
              <div key={r.id} className="text-sm">
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2"><Mail className="w-3.5 h-3.5" style={{ color: "var(--cc-muted-fg)" }} /><span className="font-medium">{r.subject}</span></div>
                  <span className="text-xs" style={{ color: "var(--cc-muted-fg)" }}>{r.receivedAt}</span>
                </div>
                <div className="rounded p-3" style={{ background: "var(--cc-muted)", color: "var(--cc-fg)" }}>{r.body}</div>
                <div className="text-xs mt-2" style={{ color: "var(--cc-muted-fg)" }}>From {r.sender} · matched with high confidence</div>
              </div>
            ))}
          </Section>

          <Section title="Activity" icon={<Activity className="w-4 h-4" />}>
            <div className="space-y-3 text-sm">
              {auditLog.map(a => (
                <div key={a.id} className="flex gap-2">
                  <div className="w-1.5 h-1.5 rounded-full mt-2 flex-shrink-0" style={{ background: a.viaGroup ? "var(--cc-purple-fg)" : "var(--cc-primary)" }} />
                  <div className="flex-1">
                    <div>{a.action}</div>
                    <div className="text-xs flex items-center gap-1.5" style={{ color: "var(--cc-muted-fg)" }}>
                      <span>{a.actor}</span><span>·</span><span>{a.at}</span>
                      {a.viaGroup && <span className="cc-badge" style={{ fontSize: 10, padding: "0 6px", background: "var(--cc-purple-bg)", color: "var(--cc-purple-fg)", border: "none" }}>via group</span>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Section>
        </div>

        {/* PINNED ACTIONS RAIL — single source of truth for actions */}
        <aside className="col-span-4 space-y-3" style={{ position: "sticky", top: 16, alignSelf: "start" }}>
          <div className="cc-card overflow-hidden">
            <div className="px-4 py-3 text-sm font-semibold flex items-center justify-between" style={{ borderBottom: "1px solid var(--cc-border)", background: "var(--cc-muted)" }}>
              <span>Take action</span>
              <span className="text-xs font-normal" style={{ color: "var(--cc-muted-fg)" }}>Step 4 of 5</span>
            </div>

            {/* Recommended */}
            <div className="p-4" style={{ background: "var(--cc-blue-bg)" }}>
              <div className="text-xs uppercase font-semibold mb-2" style={{ color: "var(--cc-blue-fg)" }}>Recommended</div>
              <button className="cc-btn cc-btn-primary w-full justify-center" style={{ padding: "0.5rem 0.75rem" }}>
                <Inbox className="w-4 h-4" />Process the denial response
              </button>
              <div className="text-xs mt-2" style={{ color: "var(--cc-blue-fg)", opacity: 0.85 }}>The payer replied. Decide whether to accept the loss or re-dispute.</div>
            </div>

            {/* Resolve group */}
            <ActionGroup label="Resolve">
              <RowAction icon={<CheckCircle2 className="w-3.5 h-3.5" />} label="Mark Approved" />
              <RowAction icon={<X className="w-3.5 h-3.5" />} label="Payer Denied" sub="Close based on response" />
              <RowAction icon={<X className="w-3.5 h-3.5" />} label="Withdraw — Not Contestable" muted />
              <RowAction icon={<X className="w-3.5 h-3.5" />} label="Withdraw — Accepted Loss" muted />
            </ActionGroup>

            {/* Workflow group */}
            <ActionGroup label="Workflow">
              <RowAction icon={<Send className="w-3.5 h-3.5" />} label="Re-queue for portal" disabled sub="Already submitted" />
              <RowAction icon={<Tag className="w-3.5 h-3.5" />} label="Assign error type" warn />
            </ActionGroup>

            {/* Pause group */}
            <ActionGroup label="Pause / change">
              <RowAction icon={<PauseCircle className="w-3.5 h-3.5" />} label="Place on hold" />
              <RowAction icon={<ArrowRightLeft className="w-3.5 h-3.5" />} label="Reassign claim" />
              <RowAction icon={<Edit2 className="w-3.5 h-3.5" />} label="Edit details" />
            </ActionGroup>
          </div>

          <div className="cc-card p-3 text-xs" style={{ color: "var(--cc-muted-fg)" }}>
            <div className="flex items-center gap-2"><Bot className="w-3.5 h-3.5" /><span>Portal bot is idle. Last submission: Apr 26, 9:01am</span></div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function Section({ title, children, icon }: { title: React.ReactNode; children: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="cc-card">
      <div className="px-4 py-3 flex items-center gap-2 text-sm font-semibold" style={{ borderBottom: "1px solid var(--cc-border)" }}>
        {icon}{title}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function ActionGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="px-2 py-2" style={{ borderTop: "1px solid var(--cc-border)" }}>
      <div className="px-2 py-1.5 text-[10px] uppercase tracking-wide font-semibold" style={{ color: "var(--cc-muted-fg)" }}>{label}</div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function RowAction({ icon, label, sub, disabled, muted, warn }: { icon: React.ReactNode; label: string; sub?: string; disabled?: boolean; muted?: boolean; warn?: boolean }) {
  return (
    <button className="w-full text-left px-2.5 py-1.5 rounded transition-colors flex items-start gap-2 hover:bg-[var(--cc-muted)] disabled:opacity-50 disabled:cursor-not-allowed" disabled={disabled} style={{ background: warn ? "var(--cc-amber-bg)" : undefined }}>
      <div className="mt-0.5" style={{ color: warn ? "var(--cc-amber-fg)" : muted ? "var(--cc-muted-fg)" : "var(--cc-fg)" }}>{icon}</div>
      <div className="flex-1 min-w-0">
        <div className="text-sm" style={{ color: warn ? "var(--cc-amber-fg)" : muted ? "var(--cc-muted-fg)" : "var(--cc-fg)" }}>{label}</div>
        {sub && <div className="text-xs" style={{ color: "var(--cc-muted-fg)" }}>{sub}</div>}
      </div>
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
