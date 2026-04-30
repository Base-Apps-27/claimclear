import "./_group.css";
import {
  Edit2, CheckCircle2, X, PauseCircle, Send, ArrowRightLeft, Inbox, Mail,
  Tag, Paperclip, Activity, ChevronDown, AlertCircle, Bot, MoreVertical,
  ChevronRight, CircleDashed, FileText, Eye, ExternalLink,
} from "lucide-react";
import { claim, evidenceItems, auditLog, responses, InvoiceContextBar, PresenceAvatars, StatusPill } from "./_shared";

const stages = [
  { key: "triage",  label: "Classify",       desc: "Identify the error" },
  { key: "build",   label: "Build Case",     desc: "Gather evidence" },
  { key: "submit",  label: "Submit",         desc: "Send to payer" },
  { key: "await",   label: "Await Response", desc: "Track payer reply" },
  { key: "resolve", label: "Resolve",        desc: "Close the loop" },
];
const currentStage = "await";

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

      {/* STAGE STEPPER (from Variant A) */}
      <div className="cc-card overflow-hidden">
        <div className="flex">
          {stages.map((s, i) => {
            const idx = stages.findIndex(x => x.key === currentStage);
            const state = i < idx ? "done" : i === idx ? "active" : "todo";
            return (
              <div key={s.key} className="flex-1 px-3 py-2.5 flex items-center gap-2.5 relative" style={{
                background: state === "active" ? "var(--cc-blue-bg)" : state === "done" ? "var(--cc-card)" : "var(--cc-muted)",
                color: state === "active" ? "var(--cc-blue-fg)" : state === "todo" ? "var(--cc-muted-fg)" : "var(--cc-fg)",
                borderRight: i < stages.length - 1 ? "1px solid var(--cc-border)" : "none",
              }}>
                {state === "done" ? <CheckCircle2 className="w-4 h-4 flex-shrink-0" style={{ color: "var(--cc-success)" }} /> :
                 state === "active" ? <CircleDashed className="w-4 h-4 flex-shrink-0" /> :
                 <div className="w-4 h-4 rounded-full border flex-shrink-0" style={{ borderColor: "var(--cc-border)" }} />}
                <div className="min-w-0">
                  <div className="text-[10px] uppercase tracking-wide" style={{ opacity: 0.65 }}>Step {i + 1}</div>
                  <div className="text-xs font-semibold truncate">{s.label}</div>
                </div>
                {i < stages.length - 1 && (
                  <ChevronRight className="w-3 h-3 absolute -right-1.5 top-1/2 -translate-y-1/2 z-10" style={{ color: "var(--cc-muted-fg)", background: "var(--cc-bg)" }} />
                )}
              </div>
            );
          })}
        </div>
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

          {/* NEW — PORTAL SUBMISSION PREVIEW: what the bot sent */}
          <Section
            title={<>Portal submission <span className="cc-badge" style={{ marginLeft: 6, background: "var(--cc-green-bg)", color: "var(--cc-green-fg)", border: "none" }}>Submitted</span></>}
            icon={<Bot className="w-4 h-4" />}
            action={
              <div className="flex items-center gap-2">
                <button className="cc-btn cc-btn-ghost cc-btn-sm"><Eye className="w-3 h-3" />View bot log</button>
                <button className="cc-btn cc-btn-ghost cc-btn-sm"><ExternalLink className="w-3 h-3" />Open in MAS portal</button>
              </div>
            }
          >
            <div className="text-xs mb-3" style={{ color: "var(--cc-muted-fg)" }}>
              Submitted Apr 26, 9:01am · confirmation <span className="mono font-medium" style={{ color: "var(--cc-fg)" }}>MAS-2026-A8841</span> · by ClaimClear bot
            </div>

            <div className="rounded p-3 text-sm" style={{ background: "var(--cc-muted)", border: "1px solid var(--cc-border)" }}>
              <div className="text-[10px] uppercase tracking-wide font-semibold mb-2" style={{ color: "var(--cc-muted-fg)" }}>What we sent</div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                <Field k="Dispute type" v="Mileage adjustment" />
                <Field k="Member ID" v={claim.clientNumber} />
                <Field k="Conf #" v={claim.confNumber} mono />
                <Field k="Trip date" v={claim.date} />
                <Field k="Original billed" v={claim.claimAmount} />
                <Field k="Requested amount" v="$267.40" />
                <Field k="Rate code" v="R-12" />
                <Field k="Vehicle" v={claim.carNumber} />
              </div>
              <div className="cc-divider my-2.5" />
              <div className="text-[10px] uppercase tracking-wide font-semibold mb-1.5" style={{ color: "var(--cc-muted-fg)" }}>Narrative</div>
              <div className="text-xs italic" style={{ color: "var(--cc-fg)" }}>
                "Trip mileage of 14.2mi confirmed by GPS log (attached). Member authorization (attached) covers pickup window 09:00-18:30, which includes the 18:30 pickup time. Requesting adjustment from billed 9.8mi to actual 14.2mi at rate code R-12."
              </div>
              <div className="cc-divider my-2.5" />
              <div className="text-[10px] uppercase tracking-wide font-semibold mb-1.5" style={{ color: "var(--cc-muted-fg)" }}>Attachments (2)</div>
              <div className="flex flex-wrap gap-1.5">
                <span className="cc-badge"><Paperclip className="w-3 h-3" />trip-log-2026-04-24.pdf</span>
                <span className="cc-badge"><Paperclip className="w-3 h-3" />member-auth-CLT-44210.pdf</span>
              </div>
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

          <Section title={<>Email thread <span className="cc-badge cc-badge-secondary" style={{ marginLeft: 6 }}>2</span></>} icon={<Mail className="w-4 h-4" />}>
            <div className="space-y-2">
              <ThreadRow dir="outbound" who="ClaimClear" when="Apr 26, 9:01am" subject="Dispute submission - C-2026-04812" body="Submitted dispute with GPS log and authorization letter." />
              <ThreadRow dir="inbound" who="MAS Adjudicator" when="Apr 27, 2:15pm" subject="Re: Dispute C-2026-04812 - Determination" body="After review, the claim is denied…" />
            </div>
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

            <ActionGroup label="Resolve">
              <RowAction icon={<CheckCircle2 className="w-3.5 h-3.5" />} label="Mark Approved" />
              <RowAction icon={<X className="w-3.5 h-3.5" />} label="Payer Denied" sub="Close based on response" />
              <RowAction icon={<X className="w-3.5 h-3.5" />} label="Withdraw — Not Contestable" muted />
              <RowAction icon={<X className="w-3.5 h-3.5" />} label="Withdraw — Accepted Loss" muted />
            </ActionGroup>

            <ActionGroup label="Workflow">
              <RowAction icon={<Send className="w-3.5 h-3.5" />} label="Re-queue for portal" disabled sub="Already submitted" />
              <RowAction icon={<Tag className="w-3.5 h-3.5" />} label="Assign error type" warn />
            </ActionGroup>

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

function Section({ title, children, icon, action }: { title: React.ReactNode; children: React.ReactNode; icon?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="cc-card">
      <div className="px-4 py-3 flex items-center justify-between gap-2" style={{ borderBottom: "1px solid var(--cc-border)" }}>
        <div className="flex items-center gap-2 text-sm font-semibold">{icon}{title}</div>
        {action}
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

function Field({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-2">
      <span style={{ color: "var(--cc-muted-fg)" }}>{k}</span>
      <span className={`font-medium text-right ${mono ? "mono" : ""}`}>{v}</span>
    </div>
  );
}

function ThreadRow({ dir, who, when, subject, body }: { dir: "outbound" | "inbound"; who: string; when: string; subject: string; body: string }) {
  return (
    <div className={`rounded p-3 text-sm ${dir === "outbound" ? "ml-6" : "mr-6"}`} style={{ background: dir === "outbound" ? "var(--cc-blue-bg)" : "var(--cc-muted)", border: "1px solid var(--cc-border)" }}>
      <div className="flex justify-between items-center"><span className="text-xs font-medium">{dir === "outbound" ? "Sent" : "Received"} · {who}</span><span className="text-xs" style={{ opacity: 0.6 }}>{when}</span></div>
      <div className="font-medium mt-1">{subject}</div>
      <div className="text-xs mt-1" style={{ opacity: 0.85 }}>{body}</div>
    </div>
  );
}
