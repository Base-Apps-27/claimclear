import "./_group.css";
import {
  Edit2, CheckCircle2, X, PauseCircle, Send, ArrowRightLeft, Inbox, Mail,
  Tag, Paperclip, Activity, AlertCircle, Bot, MoreVertical,
  ChevronRight, CircleDashed, FileText, Eye, ExternalLink, Layers,
  Briefcase, ChevronDown, Filter,
} from "lucide-react";
import { PresenceAvatars, StatusPill } from "./_shared";

const invoice = {
  number: "INV-2026-0419",
  status: "In Progress",
  payor: "MAS Medicaid",
  billingPeriod: "Apr 14 – Apr 27, 2026",
  totalAmount: "$2,184.50",
  recoveredAmount: "$612.30",
  legCount: 12,
  receivedAt: "Apr 24, 2026",
};

const legAggregates = {
  approved: 3,
  awaiting: 5,
  denied: 1,
  needsReview: 2,
  onHold: 1,
};

const stages = [
  { key: "triage",  label: "Classify",       done: 12, total: 12 },
  { key: "build",   label: "Build Case",     done: 11, total: 12 },
  { key: "submit",  label: "Submit",         done: 9,  total: 12 },
  { key: "await",   label: "Await Response", done: 4,  total: 9  },
  { key: "resolve", label: "Resolve",        done: 3,  total: 12 },
];
const activeIdx = 3;

const childClaims = [
  { id: 1, conf: "C-2026-04810", date: "Apr 14", amount: "$184.50", status: "Approved",      outcome: "Won" },
  { id: 2, conf: "C-2026-04811", date: "Apr 16", amount: "$212.00", status: "Approved",      outcome: "Won" },
  { id: 3, conf: "C-2026-04812", date: "Apr 24", amount: "$184.50", status: "In Dispute",    outcome: "Pending" },
  { id: 4, conf: "C-2026-04813", date: "Apr 18", amount: "$98.40",  status: "Submitted",     outcome: "Pending" },
  { id: 5, conf: "C-2026-04814", date: "Apr 19", amount: "$245.20", status: "Submitted",     outcome: "Pending" },
  { id: 6, conf: "C-2026-04815", date: "Apr 20", amount: "$176.80", status: "Needs Review",  outcome: "—" },
  { id: 7, conf: "C-2026-04816", date: "Apr 21", amount: "$198.00", status: "Needs Review",  outcome: "—" },
  { id: 8, conf: "C-2026-04817", date: "Apr 22", amount: "$215.90", status: "On Hold",       outcome: "—" },
  { id: 9, conf: "C-2026-04818", date: "Apr 23", amount: "$184.50", status: "Submitted",     outcome: "Pending" },
  { id: 10, conf: "C-2026-04819", date: "Apr 25", amount: "$204.30", status: "Submitted",    outcome: "Pending" },
  { id: 11, conf: "C-2026-04820", date: "Apr 26", amount: "$112.40", status: "Approved",     outcome: "Won" },
  { id: 12, conf: "C-2026-04821", date: "Apr 27", amount: "$168.00", status: "Denied",       outcome: "Lost" },
];

const auditLog = [
  { id: 1, at: "Apr 27, 2:16pm", actor: "system",      action: "Response received for C-2026-04812 (denial)" },
  { id: 2, at: "Apr 27, 9:00am", actor: "M. Rivera",   action: "Bulk-queued 4 legs for portal submission" },
  { id: 3, at: "Apr 26, 4:30pm", actor: "M. Rivera",   action: "Classified 5 remaining legs" },
  { id: 4, at: "Apr 25, 11:02am", actor: "M. Rivera",  action: "Added shared evidence: Authorization Letter" },
  { id: 5, at: "Apr 24, 4:30pm", actor: "system",      action: "Imported invoice with 12 legs" },
];

export function InvoiceVariantPinned() {
  return (
    <div className="cc-scope p-6 space-y-4 invoice-scope" style={{ width: "100%" }}>
      {/* Visual distinction stripe — runs across the top */}
      <div style={{ height: 4, background: "var(--cc-purple-fg)", borderRadius: 2, marginBottom: -8 }} />

      {/* HEADER — the visual switch happens here */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {/* Distinct INVOICE pill */}
          <span className="cc-badge mono" style={{
            background: "var(--cc-purple-fg)",
            color: "white",
            border: "none",
            padding: "0.25rem 0.625rem",
            fontSize: 11,
            letterSpacing: "0.05em",
          }}>
            <Layers className="w-3 h-3" />INVOICE
          </span>
          <h2 className="text-2xl font-bold mono">{invoice.number}</h2>
          <StatusPill status={invoice.status} />
        </div>
        <PresenceAvatars />
      </div>

      {/* INVOICE-LEVEL CONTEXT BAND — replaces the "part of invoice X" bar from the claim page */}
      <div className="cc-card flex items-center gap-5 px-4 py-2.5 text-sm" style={{ background: "var(--cc-purple-bg)", borderColor: "var(--cc-purple-border)" }}>
        <div className="flex items-center gap-1.5" style={{ color: "var(--cc-purple-fg)" }}>
          <Briefcase className="w-3.5 h-3.5" />
          <span className="font-medium">{invoice.legCount} legs</span>
        </div>
        <div className="w-px h-4" style={{ background: "var(--cc-purple-border)" }} />
        <div><span style={{ color: "var(--cc-purple-fg)", opacity: 0.75 }}>Total billed</span> <span className="font-semibold">{invoice.totalAmount}</span></div>
        <div><span style={{ color: "var(--cc-purple-fg)", opacity: 0.75 }}>Recovered</span> <span className="font-semibold" style={{ color: "var(--cc-success)" }}>{invoice.recoveredAmount}</span></div>
        <div><span style={{ color: "var(--cc-purple-fg)", opacity: 0.75 }}>Payor</span> <span className="font-medium">{invoice.payor}</span></div>
        <div className="ml-auto flex items-center gap-1.5">
          {/* Aggregated leg pills */}
          <LegPill label="Approved" count={legAggregates.approved} bg="var(--cc-green-bg)"  fg="var(--cc-green-fg)" />
          <LegPill label="Awaiting" count={legAggregates.awaiting} bg="var(--cc-blue-bg)"   fg="var(--cc-blue-fg)" />
          <LegPill label="Review"   count={legAggregates.needsReview} bg="var(--cc-amber-bg)" fg="var(--cc-amber-fg)" />
          <LegPill label="Hold"     count={legAggregates.onHold}    bg="var(--cc-purple-bg)" fg="var(--cc-purple-fg)" />
          <LegPill label="Denied"   count={legAggregates.denied}   bg="var(--cc-red-bg)"     fg="var(--cc-red-fg)" />
        </div>
      </div>

      {/* GROUP-LEVEL STEPPER — same shape as claim, with X/Y progress per stage */}
      <div className="cc-card overflow-hidden" style={{ borderColor: "var(--cc-purple-border)" }}>
        <div className="flex">
          {stages.map((s, i) => {
            const state = i < activeIdx ? "done" : i === activeIdx ? "active" : "todo";
            return (
              <div key={s.key} className="flex-1 px-3 py-2.5 flex items-center gap-2.5 relative" style={{
                background: state === "active" ? "var(--cc-purple-bg)" : state === "done" ? "var(--cc-card)" : "var(--cc-muted)",
                color: state === "active" ? "var(--cc-purple-fg)" : state === "todo" ? "var(--cc-muted-fg)" : "var(--cc-fg)",
                borderRight: i < stages.length - 1 ? "1px solid var(--cc-border)" : "none",
              }}>
                {state === "done" ? <CheckCircle2 className="w-4 h-4 flex-shrink-0" style={{ color: "var(--cc-success)" }} /> :
                 state === "active" ? <CircleDashed className="w-4 h-4 flex-shrink-0" /> :
                 <div className="w-4 h-4 rounded-full border flex-shrink-0" style={{ borderColor: "var(--cc-border)" }} />}
                <div className="min-w-0">
                  <div className="text-[10px] uppercase tracking-wide flex items-center gap-1.5" style={{ opacity: 0.65 }}>
                    <span>Step {i + 1}</span>
                    <span className="mono font-semibold" style={{ opacity: 0.85 }}>{s.done}/{s.total}</span>
                  </div>
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
        {/* MAIN COLUMN */}
        <div className="col-span-8 space-y-5">
          <Section title="Invoice details">
            <div className="grid grid-cols-3 gap-x-5 gap-y-3 text-sm">
              <Stat label="Received" value={invoice.receivedAt} />
              <Stat label="Billing period" value={invoice.billingPeriod} />
              <Stat label="Payor" value={invoice.payor} />
              <Stat label="Total billed" value={invoice.totalAmount} />
              <Stat label="Recovered" value={invoice.recoveredAmount} />
              <Stat label="Outstanding" value="$1,572.20" />
            </div>
          </Section>

          <Section
            title={<>Legs <span className="cc-badge cc-badge-secondary" style={{ marginLeft: 6 }}>{childClaims.length}</span></>}
            icon={<Briefcase className="w-4 h-4" />}
            action={
              <div className="flex items-center gap-1">
                <button className="cc-btn cc-btn-ghost cc-btn-sm"><Filter className="w-3 h-3" />Filter</button>
                <button className="cc-btn cc-btn-ghost cc-btn-sm">Sort by status</button>
              </div>
            }
          >
            <div className="rounded overflow-hidden" style={{ border: "1px solid var(--cc-border)" }}>
              <table className="w-full text-sm">
                <thead style={{ background: "var(--cc-muted)" }}>
                  <tr style={{ color: "var(--cc-muted-fg)" }}>
                    <th className="text-left px-3 py-2 text-xs font-medium uppercase tracking-wide">Conf #</th>
                    <th className="text-left px-3 py-2 text-xs font-medium uppercase tracking-wide">Date</th>
                    <th className="text-right px-3 py-2 text-xs font-medium uppercase tracking-wide">Amount</th>
                    <th className="text-left px-3 py-2 text-xs font-medium uppercase tracking-wide">Status</th>
                    <th className="text-left px-3 py-2 text-xs font-medium uppercase tracking-wide">Outcome</th>
                    <th className="px-2 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {childClaims.map((c, i) => (
                    <tr key={c.id} style={{ borderTop: "1px solid var(--cc-border)", background: i % 2 ? "var(--cc-bg)" : "var(--cc-card)" }} className="hover:bg-[var(--cc-muted)] cursor-pointer">
                      <td className="px-3 py-2 mono text-xs" style={{ color: "var(--cc-primary)" }}>{c.conf}</td>
                      <td className="px-3 py-2 text-xs" style={{ color: "var(--cc-muted-fg)" }}>{c.date}</td>
                      <td className="px-3 py-2 text-right text-xs font-medium">{c.amount}</td>
                      <td className="px-3 py-2"><StatusPill status={c.status} /></td>
                      <td className="px-3 py-2 text-xs" style={{ color: c.outcome === "Won" ? "var(--cc-success)" : c.outcome === "Lost" ? "var(--cc-destructive)" : "var(--cc-muted-fg)" }}>{c.outcome}</td>
                      <td className="px-2 py-2 text-right"><MoreVertical className="w-3 h-3 inline" style={{ color: "var(--cc-muted-fg)" }} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between mt-3">
              <div className="text-xs" style={{ color: "var(--cc-muted-fg)" }}>3 won · 1 lost · 8 pending</div>
              <button className="cc-btn cc-btn-ghost cc-btn-sm">Open in Queue →</button>
            </div>
          </Section>

          <Section
            title={<>Portal submissions <span className="cc-badge" style={{ marginLeft: 6, background: "var(--cc-green-bg)", color: "var(--cc-green-fg)", border: "none" }}>9 of 12 sent</span></>}
            icon={<Bot className="w-4 h-4" />}
            action={<button className="cc-btn cc-btn-ghost cc-btn-sm"><Eye className="w-3 h-3" />View bot log</button>}
          >
            <div className="text-xs mb-3" style={{ color: "var(--cc-muted-fg)" }}>
              Bot has submitted 9 of 12 legs. Last batch: Apr 26, 9:01am · 3 legs still in <span className="font-medium">Needs Review</span> require classification before submission.
            </div>
            <div className="grid grid-cols-3 gap-2">
              <SubmissionTile state="success" count={9} label="Submitted" />
              <SubmissionTile state="warn"    count={2} label="Needs review first" />
              <SubmissionTile state="neutral" count={1} label="On hold" />
            </div>
          </Section>

          <Section title="Activity" icon={<Activity className="w-4 h-4" />}>
            <div className="space-y-3 text-sm">
              {auditLog.map(a => (
                <div key={a.id} className="flex gap-2">
                  <div className="w-1.5 h-1.5 rounded-full mt-2 flex-shrink-0" style={{ background: "var(--cc-purple-fg)" }} />
                  <div className="flex-1">
                    <div>{a.action}</div>
                    <div className="text-xs flex items-center gap-1.5 mt-0.5" style={{ color: "var(--cc-muted-fg)" }}>
                      <span>{a.actor}</span><span>·</span><span>{a.at}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Section>
        </div>

        {/* PINNED ACTIONS RAIL — bulk actions for the whole invoice */}
        <aside className="col-span-4 space-y-3" style={{ position: "sticky", top: 16, alignSelf: "start" }}>
          <div className="cc-card overflow-hidden" style={{ borderColor: "var(--cc-purple-border)" }}>
            <div className="px-4 py-3 text-sm font-semibold flex items-center justify-between" style={{ borderBottom: "1px solid var(--cc-purple-border)", background: "var(--cc-purple-bg)", color: "var(--cc-purple-fg)" }}>
              <span className="flex items-center gap-2"><Layers className="w-4 h-4" />Bulk actions</span>
              <span className="text-xs font-normal" style={{ opacity: 0.75 }}>across 12 legs</span>
            </div>

            {/* Recommended */}
            <div className="p-4" style={{ background: "var(--cc-purple-bg)", borderTop: "1px solid var(--cc-purple-border)" }}>
              <div className="text-xs uppercase font-semibold mb-2" style={{ color: "var(--cc-purple-fg)" }}>Recommended</div>
              <button className="cc-btn w-full justify-center" style={{ background: "var(--cc-purple-fg)", color: "white", border: "none", padding: "0.5rem 0.75rem" }}>
                <AlertCircle className="w-4 h-4" />Classify 2 legs in Needs Review
              </button>
              <div className="text-xs mt-2" style={{ color: "var(--cc-purple-fg)", opacity: 0.85 }}>
                These legs can't be submitted until they have an error type assigned.
              </div>
            </div>

            <ActionGroup label="Submit">
              <RowAction icon={<Send className="w-3.5 h-3.5" />} label="Queue all submittable" sub="3 legs ready for portal" />
              <RowAction icon={<Send className="w-3.5 h-3.5" />} label="Re-queue failed" disabled sub="No failed submissions" />
            </ActionGroup>

            <ActionGroup label="Resolve">
              <RowAction icon={<CheckCircle2 className="w-3.5 h-3.5" />} label="Accept losses on denied" sub="1 leg currently denied" />
              <RowAction icon={<X className="w-3.5 h-3.5" />} label="Withdraw remaining" muted sub="8 legs still active" />
            </ActionGroup>

            <ActionGroup label="Pause / change">
              <RowAction icon={<PauseCircle className="w-3.5 h-3.5" />} label="Place all on hold" />
              <RowAction icon={<Tag className="w-3.5 h-3.5" />} label="Apply error type to many…" />
              <RowAction icon={<Edit2 className="w-3.5 h-3.5" />} label="Edit invoice details" />
            </ActionGroup>
          </div>

          <div className="cc-card p-3 text-xs" style={{ color: "var(--cc-muted-fg)" }}>
            <div className="flex items-center gap-2"><Bot className="w-3.5 h-3.5" /><span>Bot is idle. Last batch: Apr 26, 9:01am</span></div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function LegPill({ label, count, bg, fg }: { label: string; count: number; bg: string; fg: string }) {
  if (count === 0) return null;
  return (
    <span className="cc-badge" style={{ background: bg, color: fg, border: "none", fontSize: 11 }}>
      <span className="font-bold">{count}</span> {label}
    </span>
  );
}

function SubmissionTile({ state, count, label }: { state: "success" | "warn" | "neutral"; count: number; label: string }) {
  const colors = {
    success: { bg: "var(--cc-green-bg)", fg: "var(--cc-green-fg)" },
    warn:    { bg: "var(--cc-amber-bg)", fg: "var(--cc-amber-fg)" },
    neutral: { bg: "var(--cc-muted)",    fg: "var(--cc-muted-fg)" },
  }[state];
  return (
    <div className="rounded p-3" style={{ background: colors.bg, border: "1px solid var(--cc-border)" }}>
      <div className="text-2xl font-bold mono" style={{ color: colors.fg }}>{count}</div>
      <div className="text-xs" style={{ color: colors.fg, opacity: 0.85 }}>{label}</div>
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

function RowAction({ icon, label, sub, disabled, muted }: { icon: React.ReactNode; label: string; sub?: string; disabled?: boolean; muted?: boolean }) {
  return (
    <button className="w-full text-left px-2.5 py-1.5 rounded transition-colors flex items-start gap-2 hover:bg-[var(--cc-muted)] disabled:opacity-50 disabled:cursor-not-allowed" disabled={disabled}>
      <div className="mt-0.5" style={{ color: muted ? "var(--cc-muted-fg)" : "var(--cc-fg)" }}>{icon}</div>
      <div className="flex-1 min-w-0">
        <div className="text-sm" style={{ color: muted ? "var(--cc-muted-fg)" : "var(--cc-fg)" }}>{label}</div>
        {sub && <div className="text-xs" style={{ color: "var(--cc-muted-fg)" }}>{sub}</div>}
      </div>
    </button>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs" style={{ color: "var(--cc-muted-fg)" }}>{label}</div>
      <div className="text-sm mt-0.5 font-medium">{value}</div>
    </div>
  );
}
