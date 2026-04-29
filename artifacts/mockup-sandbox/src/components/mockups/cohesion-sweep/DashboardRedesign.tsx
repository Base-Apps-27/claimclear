import {
  Sparkles, Upload, FilePlus, Send, Bot, Activity, ChevronRight, AlertCircle, Clock, FileText,
} from "lucide-react";
import {
  PageHeader, StatusStrip, StatusDot, Section, ActionGroup, RowAction, StatusPill, MetricTile, Recommended, PrimaryButton,
} from "./_shared";

const recent = [
  { who: "M. Rivera", action: "Submitted INV-2026-0419 to MAS portal",   when: "7m ago",  tone: "blue" as const },
  { who: "system",    action: "Imported 23 claims from job-status report", when: "12m ago", tone: "muted" as const },
  { who: "MAS",       action: "Approved INV-2026-0414 · $1,432 recovered", when: "1h ago",  tone: "green" as const },
  { who: "system",    action: "Sandbox-verified INV-2026-0418 (12 legs)",  when: "2h ago",  tone: "purple" as const },
  { who: "L. Chen",   action: "Added evidence on C-2026-04812",            when: "3h ago",  tone: "muted" as const },
  { who: "MAS",       action: "Denied INV-2026-0411 · $640 lost",          when: "1d ago",  tone: "red" as const },
];

const expiring = [
  { num: "INV-2026-0410", days: 2, total: "$1,876.40", action: "File before May 1" },
  { num: "INV-2026-0411", days: 5, total: "$  942.60", action: "Awaiting evidence" },
  { num: "INV-2026-0412", days: 7, total: "$2,010.20", action: "Member contact required" },
];

export function DashboardRedesign() {
  return (
    <div className="cc-scope p-6 space-y-4" style={{ width: "100%" }}>
      <PageHeader title="Dashboard" sub="Welcome back, Maria. Here's what's moving today." search={false} accent="blue" />

      <StatusStrip>
        <StatusDot tone="green" />
        <span className="font-medium">Worker healthy</span>
        <span style={{ color: "var(--cc-muted-fg)" }}>·</span>
        <span style={{ color: "var(--cc-muted-fg)" }}>Last batch <span style={{ color: "var(--cc-fg)" }}>7m ago</span> by <span style={{ color: "var(--cc-fg)" }}>M. Rivera</span></span>
        <span style={{ color: "var(--cc-muted-fg)" }}>·</span>
        <span style={{ color: "var(--cc-success)" }}>23/23 succeeded</span>
        <span style={{ color: "var(--cc-muted-fg)" }}>·</span>
        <span style={{ color: "var(--cc-muted-fg)" }}>Daily import ran <span style={{ color: "var(--cc-fg)" }}>4h ago</span></span>
        <a href="#" className="ml-auto" style={{ color: "var(--cc-primary)", fontWeight: 500 }}>System health →</a>
      </StatusStrip>

      <div className="grid grid-cols-4 gap-3">
        <MetricTile label="In dispute" value="$24,810" sub="92 claims across 14 groups" tone="blue" />
        <MetricTile label="Recovered (wk)" value="$8,140" sub="↑ 18% vs last week" tone="green" />
        <MetricTile label="Lost (wk)"  value="$1,420" sub="6 denials · all final" tone="red" />
        <MetricTile label="Approval rate" value="84%"  sub="rolling 30 days" tone="muted" />
      </div>

      <div className="grid grid-cols-12 gap-5">
        <div className="col-span-8 space-y-4">
          <Section title={<><Activity className="w-4 h-4" />Recent activity</>} action={<a href="#" className="text-xs" style={{ color: "var(--cc-primary)" }}>See all</a>} padded={false}>
            {recent.map((r, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-2.5" style={{ borderBottom: i === recent.length - 1 ? "none" : "1px solid var(--cc-border)" }}>
                <StatusPill tone={r.tone}>{r.who}</StatusPill>
                <span className="text-sm flex-1">{r.action}</span>
                <span className="text-xs" style={{ color: "var(--cc-muted-fg)" }}>{r.when}</span>
              </div>
            ))}
          </Section>

          <Section title={<><Clock className="w-4 h-4" />Expiring soon (filing deadline within 7 days)</>} action={<a href="#" className="text-xs" style={{ color: "var(--cc-primary)" }}>See all 3</a>} padded={false}>
            {expiring.map(e => (
              <div key={e.num} className="flex items-center gap-3 px-4 py-2.5" style={{ borderBottom: "1px solid var(--cc-border)" }}>
                <StatusPill tone={e.days <= 2 ? "red" : "amber"}>{e.days}d left</StatusPill>
                <span className="mono text-sm font-semibold" style={{ color: "var(--cc-purple-fg)" }}>{e.num}</span>
                <span className="text-xs flex-1" style={{ color: "var(--cc-muted-fg)" }}>{e.action}</span>
                <span className="text-sm font-medium mono">{e.total}</span>
                <button className="cc-btn cc-btn-sm">Open <ChevronRight className="w-3 h-3" /></button>
              </div>
            ))}
          </Section>
        </div>

        <aside className="col-span-4 space-y-3" style={{ position: "sticky", top: 16, alignSelf: "start" }}>
          <div className="cc-card overflow-hidden">
            <div className="px-4 py-3 text-sm font-semibold flex items-center justify-between" style={{ borderBottom: "1px solid var(--cc-border)", background: "var(--cc-blue-bg)", color: "var(--cc-blue-fg)" }}>
              <span className="flex items-center gap-2"><Sparkles className="w-4 h-4" />What you can do now</span>
            </div>

            <Recommended
              tone="blue"
              title="Triage 24 unreviewed claims"
              body="From last night's import. Reviewer-assist suggests an error type on every one."
              cta={<PrimaryButton tone="blue"><Sparkles className="w-4 h-4" />Start triage</PrimaryButton>}
              sub="Average 35 sec per claim."
            />

            <ActionGroup label="Day-to-day">
              <RowAction icon={<Upload className="w-3.5 h-3.5" />}  label="Import job-status report"     sub="CSV or Excel from MAS" />
              <RowAction icon={<FilePlus className="w-3.5 h-3.5" />} label="New claim manually"           sub="Use when import missed something" />
              <RowAction icon={<Send className="w-3.5 h-3.5" />}     label="Open portal queue"            sub="2 drafts ready to file" />
            </ActionGroup>

            <ActionGroup label="Quality checks">
              <RowAction icon={<Bot className="w-3.5 h-3.5" />}      label="Run worker health check"       muted />
              <RowAction icon={<FileText className="w-3.5 h-3.5" />} label="Export this week (CSV)"        muted />
            </ActionGroup>
          </div>

          <div className="cc-card p-3 text-xs" style={{ color: "var(--cc-muted-fg)" }}>
            <div className="flex items-center gap-2"><AlertCircle className="w-3.5 h-3.5" />
              <span>Recovery falling behind a goal? Open <span style={{ color: "var(--cc-primary)", fontWeight: 500 }}>Summary</span> to see the trend.</span>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
