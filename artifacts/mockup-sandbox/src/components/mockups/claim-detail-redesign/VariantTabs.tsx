import "./_group.css";
import {
  Edit2, Mail, Inbox, FileText, Bot, MessageSquare, Activity, Tag,
  CheckCircle2, X, Eye, ArrowRightLeft, Send, PauseCircle, Paperclip, AlertCircle,
} from "lucide-react";
import { claim, evidenceItems, responses, auditLog, submissions, InvoiceContextBar, PresenceAvatars, StatusPill } from "./_shared";

const tabs = [
  { key: "overview", label: "Overview", icon: FileText, badge: null },
  { key: "evidence", label: "Evidence", icon: Paperclip, badge: 2 },
  { key: "submissions", label: "Submissions", icon: Bot, badge: 1 },
  { key: "responses", label: "Responses", icon: Inbox, badge: 1, dot: true },
  { key: "emails", label: "Emails", icon: Mail, badge: 2 },
  { key: "activity", label: "Activity", icon: Activity, badge: null },
];

export function VariantTabs() {
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
        <div className="flex items-center gap-2">
          <PresenceAvatars />
          <button className="cc-btn cc-btn-ghost"><Edit2 className="w-3.5 h-3.5" />Edit</button>
        </div>
      </div>

      {/* PRIMARY ACTION CALLOUT — always says one thing about the current state */}
      <div className="cc-card p-4 flex items-start gap-3" style={{ background: "var(--cc-blue-bg)", borderColor: "var(--cc-blue-border)" }}>
        <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: "white", color: "var(--cc-blue-fg)" }}>
          <Inbox className="w-4 h-4" />
        </div>
        <div className="flex-1">
          <div className="text-sm font-semibold" style={{ color: "var(--cc-blue-fg)" }}>1 unprocessed response — denial from MAS Adjudicator</div>
          <div className="text-xs mt-0.5" style={{ color: "var(--cc-blue-fg)", opacity: 0.85 }}>Open the Responses tab to review and decide whether to accept the loss or re-dispute.</div>
        </div>
        <button className="cc-btn cc-btn-primary">Open Responses →</button>
      </div>

      {/* TABS */}
      <div className="cc-card overflow-hidden">
        <div className="flex" style={{ borderBottom: "1px solid var(--cc-border)" }}>
          {tabs.map((t, i) => {
            const Active = t.key === "overview";
            return (
              <button key={t.key} className="px-4 py-3 text-sm font-medium flex items-center gap-2 relative" style={{
                color: Active ? "var(--cc-fg)" : "var(--cc-muted-fg)",
                borderBottom: Active ? "2px solid var(--cc-primary)" : "2px solid transparent",
                background: Active ? "var(--cc-card)" : "transparent",
              }}>
                <t.icon className="w-3.5 h-3.5" />
                {t.label}
                {t.badge !== null && <span className="cc-badge cc-badge-secondary" style={{ padding: "0 6px", fontSize: 10 }}>{t.badge}</span>}
                {t.dot && <span className="w-1.5 h-1.5 rounded-full absolute top-2 right-2" style={{ background: "var(--cc-accent)" }} />}
              </button>
            );
          })}
        </div>

        {/* OVERVIEW TAB CONTENT */}
        <div className="p-5 space-y-5">
          {/* Two-column summary */}
          <div className="grid grid-cols-3 gap-5">
            <div className="col-span-2">
              <div className="flex items-center justify-between mb-3">
                <div className="text-sm font-semibold">Claim details</div>
                <button className="cc-btn cc-btn-ghost cc-btn-sm"><Edit2 className="w-3 h-3" />Edit</button>
              </div>
              <div className="grid grid-cols-3 gap-x-4 gap-y-3 text-sm">
                <Stat label="Date" value={claim.date} />
                <Stat label="Amount" value={claim.claimAmount} />
                <Stat label="Car #" value={claim.carNumber} />
                <Stat label="Client #" value={claim.clientNumber} />
                <Stat label="Ref #" value={claim.refNumber} mono />
                <Stat label="Payor" value="MAS Medicaid" />
              </div>
              <div className="cc-divider my-4" />
              <div className="text-xs mb-1.5" style={{ color: "var(--cc-muted-fg)" }}>Error details</div>
              <span className="cc-badge" style={{ background: "var(--cc-blue-bg)", color: "var(--cc-blue-fg)", border: "none" }}>Multiple errors detected</span>
              <ul className="text-sm space-y-1 mt-2">
                {claim.errorDetails.split(";").map((p, i) => <li key={i}>· {p.trim()}</li>)}
              </ul>
              <div className="mt-3 flex items-center gap-2">
                <span className="text-xs" style={{ color: "var(--cc-muted-fg)" }}>Error type:</span>
                <button className="cc-btn cc-btn-sm" style={{ background: "var(--cc-amber-bg)", color: "var(--cc-amber-fg)", borderColor: "var(--cc-amber-border)" }}>
                  <Tag className="w-3 h-3" />Assign type
                </button>
              </div>
            </div>

            {/* Workflow summary card — links into the relevant tab */}
            <div className="space-y-3">
              <div className="text-sm font-semibold">Where we are</div>
              <ProgressRow done label="Classified" sub="Identified mileage issue" />
              <ProgressRow done label="Evidence collected" sub="2 items attached" />
              <ProgressRow done label="Submitted to portal" sub="Apr 26 · MAS-2026-A8841" />
              <ProgressRow active label="Awaiting decision" sub="Response received Apr 27" />
              <ProgressRow label="Resolve" sub="—" />
            </div>
          </div>

          {/* Compact secondary actions row, neatly grouped */}
          <div className="cc-divider" />
          <div className="flex items-center justify-between">
            <div className="text-xs" style={{ color: "var(--cc-muted-fg)" }}>State changes</div>
            <div className="flex items-center gap-2">
              <button className="cc-btn cc-btn-sm"><PauseCircle className="w-3 h-3" />Place on hold</button>
              <button className="cc-btn cc-btn-sm"><ArrowRightLeft className="w-3 h-3" />Reassign</button>
              <button className="cc-btn cc-btn-sm" style={{ color: "var(--cc-destructive)" }}>Withdraw…</button>
            </div>
          </div>
        </div>
      </div>

      {/* Activity preview — full feed lives in Activity tab */}
      <div className="cc-card p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-semibold flex items-center gap-2"><Activity className="w-4 h-4" />Recent activity</div>
          <button className="cc-btn cc-btn-ghost cc-btn-sm">View all →</button>
        </div>
        <div className="space-y-2.5 text-sm">
          {auditLog.slice(0, 3).map(a => (
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
      </div>
    </div>
  );
}

function ProgressRow({ done, active, label, sub }: { done?: boolean; active?: boolean; label: string; sub: string }) {
  return (
    <div className="flex items-start gap-2">
      {done ? (
        <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: "var(--cc-success)" }} />
      ) : active ? (
        <div className="w-4 h-4 mt-0.5 rounded-full border-2 flex-shrink-0" style={{ borderColor: "var(--cc-primary)", background: "var(--cc-primary)", boxShadow: "inset 0 0 0 2px white" }} />
      ) : (
        <div className="w-4 h-4 mt-0.5 rounded-full border flex-shrink-0" style={{ borderColor: "var(--cc-border)" }} />
      )}
      <div className="flex-1 min-w-0">
        <div className={`text-sm ${active ? "font-semibold" : ""}`} style={{ color: !done && !active ? "var(--cc-muted-fg)" : undefined }}>{label}</div>
        <div className="text-xs" style={{ color: "var(--cc-muted-fg)" }}>{sub}</div>
      </div>
    </div>
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
