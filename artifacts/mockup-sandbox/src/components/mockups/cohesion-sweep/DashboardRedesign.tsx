import {
  Sparkles, Upload, FilePlus, Send, Bot, Activity, ChevronRight, AlertTriangle, RefreshCw,
  TrendingUp, FileText, CheckCircle2,
} from "lucide-react";
import { ReactNode } from "react";
import { PageHeader, Section } from "./_shared";

function HeroTile({ label, value, sub, valueTone = "neutral" }: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  valueTone?: "neutral" | "good" | "danger";
}) {
  const valueColor =
    valueTone === "good"   ? "var(--cc-success)" :
    valueTone === "danger" ? "var(--cc-destructive)" :
                             "var(--cc-fg)";
  return (
    <div className="cc-card p-4">
      <div className="text-[11px] uppercase tracking-wide font-semibold mb-1.5" style={{ color: "var(--cc-muted-fg)" }}>
        {label}
      </div>
      <div className="text-3xl font-bold mono" style={{ color: valueColor }}>
        {value}
      </div>
      {sub && <div className="text-xs mt-1.5" style={{ color: "var(--cc-muted-fg)" }}>{sub}</div>}
    </div>
  );
}

const recent = [
  { who: "M. Rivera", action: "Submitted INV-2026-0419 to MAS portal",     when: "7m ago" },
  { who: "system",    action: "Imported 23 claims from job-status report", when: "12m ago" },
  { who: "MAS",       action: "Approved INV-2026-0414 · $1,432 recovered", when: "1h ago", tone: "good" as const },
  { who: "system",    action: "Sandbox-verified INV-2026-0418 (12 legs)",  when: "2h ago" },
  { who: "L. Chen",   action: "Added evidence on C-2026-04812",            when: "3h ago" },
  { who: "MAS",       action: "Denied INV-2026-0411 · $640 lost",          when: "1d ago", tone: "bad" as const },
];

const expiring = [
  { num: "INV-2026-0410", days: 1, total: "$1,876.40", action: "File before tomorrow EOD" },
  { num: "INV-2026-0411", days: 2, total: "$  942.60", action: "Awaiting evidence" },
  { num: "INV-2026-0412", days: 5, total: "$2,010.20", action: "Member contact required" },
];

export function DashboardRedesign() {
  return (
    <div className="cc-scope p-6 space-y-5" style={{ width: "100%" }}>
      <PageHeader title="Command center" sub="Welcome back, Maria — here's what's moving today" search={false} accent="blue" />

      {/* Worker health one-liner — neutral card, single green dot */}
      <div className="cc-card flex items-center gap-2 px-4 py-2 text-sm">
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--cc-success)" }} />
        <span className="font-medium">Worker healthy</span>
        <span style={{ color: "var(--cc-muted-fg)" }}>· last batch 7m ago by M. Rivera · 23/23 succeeded · daily import ran 4h ago</span>
        <a href="#" className="ml-auto text-xs" style={{ color: "var(--cc-primary)" }}>System health →</a>
      </div>

      {/* HERO row — neutral cards, color only on the truly meaningful numbers */}
      <div className="grid grid-cols-4 gap-3">
        <HeroTile label="Needs evidence"    value="18"       sub="claims you can move forward today" />
        <HeroTile label="Awaiting response" value="92"       sub="$24,810 in MAS court" />
        <HeroTile label="Total exposure"    value="$42,820"  sub="claim + 70% vendor prepay"        valueTone="danger" />
        <HeroTile label="Recovered (wk)"    value="$8,140"   sub={<span className="flex items-center gap-1"><TrendingUp className="w-3 h-3" />↑ 18% vs last week</span>} valueTone="good" />
      </div>

      {/* THE one loud block — actually urgent */}
      <div className="cc-card overflow-hidden" style={{ borderColor: "var(--cc-red-border)", borderWidth: 2 }}>
        <div className="px-5 py-3 flex items-center justify-between" style={{ background: "var(--cc-red-bg)", borderBottom: "1px solid var(--cc-red-border)" }}>
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5" style={{ color: "var(--cc-destructive)" }} />
            <span className="text-sm font-bold uppercase tracking-wide" style={{ color: "var(--cc-red-fg)" }}>Expiring soon</span>
            <span className="text-xs" style={{ color: "var(--cc-red-fg)", opacity: 0.85 }}>· filing deadline within 7 days</span>
          </div>
          <a href="#" className="text-xs font-medium" style={{ color: "var(--cc-red-fg)" }}>See all 3 →</a>
        </div>
        <div className="grid grid-cols-3">
          {expiring.map((e, i) => (
            <div key={e.num} className="p-4 flex flex-col gap-2" style={{ borderRight: i < expiring.length - 1 ? "1px solid var(--cc-border)" : "none" }}>
              <div className="flex items-center gap-2">
                <span className="mono text-xs font-bold px-2 py-0.5 rounded" style={{
                  background: e.days <= 1 ? "var(--cc-destructive)" : "var(--cc-muted)",
                  color: e.days <= 1 ? "white" : "var(--cc-fg)",
                }}>{e.days}d left</span>
                <span className="mono text-sm font-semibold" style={{ color: "var(--cc-purple-fg)" }}>{e.num}</span>
              </div>
              <div className="text-xs" style={{ color: "var(--cc-muted-fg)" }}>{e.action}</div>
              <div className="flex items-center justify-between mt-auto pt-1">
                <span className="text-lg font-bold mono">{e.total}</span>
                <button className="cc-btn cc-btn-sm">Open <ChevronRight className="w-3 h-3" /></button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Bot / portal row — fully neutral */}
      <div className="grid grid-cols-3 gap-3">
        <div className="cc-card p-3.5">
          <div className="flex items-center gap-2 text-xs uppercase font-semibold mb-2" style={{ color: "var(--cc-muted-fg)" }}>
            <Bot className="w-3.5 h-3.5" />Portal worker
          </div>
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--cc-success)" }} />
            <span className="text-sm font-medium">Idle · ready</span>
          </div>
          <div className="text-xs mt-1" style={{ color: "var(--cc-muted-fg)" }}>last run 7m ago</div>
        </div>
        <div className="cc-card p-3.5">
          <div className="flex items-center gap-2 text-xs uppercase font-semibold mb-2" style={{ color: "var(--cc-muted-fg)" }}>
            <Send className="w-3.5 h-3.5" />Portal queue
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold mono">2</span>
            <span className="text-xs" style={{ color: "var(--cc-muted-fg)" }}>drafts ready to file</span>
          </div>
          <a href="#" className="text-xs mt-1 inline-block" style={{ color: "var(--cc-primary)" }}>Open queue →</a>
        </div>
        <div className="cc-card p-3.5">
          <div className="flex items-center gap-2 text-xs uppercase font-semibold mb-2" style={{ color: "var(--cc-muted-fg)" }}>
            <TrendingUp className="w-3.5 h-3.5" />Bot success rate
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold mono">96%</span>
            <span className="text-xs" style={{ color: "var(--cc-muted-fg)" }}>last 50 submissions</span>
          </div>
          <div className="text-xs mt-1" style={{ color: "var(--cc-muted-fg)" }}>2 retries auto-resolved</div>
        </div>
      </div>

      {/* Closed last 7 days + Recent activity — neutral with subtle accents */}
      <div className="grid grid-cols-3 gap-5">
        <Section title={<>Closed last 7 days</>} className="col-span-1">
          <div className="space-y-3">
            <div>
              <div className="flex items-baseline justify-between">
                <span className="text-xs uppercase font-semibold" style={{ color: "var(--cc-muted-fg)" }}>Denied by payer</span>
                <span className="text-xs" style={{ color: "var(--cc-muted-fg)" }}>final</span>
              </div>
              <div className="text-2xl font-bold mono">6 · <span style={{ color: "var(--cc-destructive)" }}>$1,420</span></div>
            </div>
            <div className="cc-divider" />
            <div>
              <div className="flex items-baseline justify-between">
                <span className="text-xs uppercase font-semibold" style={{ color: "var(--cc-muted-fg)" }}>Withdrawn (closed by us)</span>
                <span className="text-xs" style={{ color: "var(--cc-muted-fg)" }}>not pursued</span>
              </div>
              <div className="text-2xl font-bold mono" style={{ color: "var(--cc-muted-fg)" }}>4 · $   680</div>
            </div>
          </div>
        </Section>

        <div className="col-span-2">
          <Section
            title={<><Activity className="w-4 h-4" />Recent activity</>}
            action={<a href="#" className="text-xs" style={{ color: "var(--cc-primary)" }}>See all</a>}
            padded={false}
          >
            {recent.map((r, i) => {
              const dotColor =
                r.tone === "good" ? "var(--cc-success)" :
                r.tone === "bad"  ? "var(--cc-destructive)" :
                                    "var(--cc-muted-fg)";
              return (
                <div key={i} className="flex items-center gap-3 px-4 py-2.5" style={{
                  borderBottom: i === recent.length - 1 ? "none" : "1px solid var(--cc-border)",
                }}>
                  <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: dotColor }} />
                  <span className="text-xs font-medium" style={{ color: "var(--cc-muted-fg)", minWidth: 80 }}>{r.who}</span>
                  <span className="text-sm flex-1">{r.action}</span>
                  <span className="text-xs" style={{ color: "var(--cc-muted-fg)" }}>{r.when}</span>
                </div>
              );
            })}
          </Section>
        </div>
      </div>

      {/* Quick actions strip — flat */}
      <div className="cc-card p-1 flex items-center gap-1 flex-wrap" style={{ background: "var(--cc-muted)" }}>
        <span className="text-[10px] uppercase font-semibold px-3" style={{ color: "var(--cc-muted-fg)" }}>Quick actions</span>
        <button className="cc-btn cc-btn-sm" style={{ background: "var(--cc-card)" }}>
          <Sparkles className="w-3 h-3" />Classify 24 unreviewed
        </button>
        <button className="cc-btn cc-btn-sm" style={{ background: "var(--cc-card)" }}>
          <Upload className="w-3 h-3" />Import job-status report
        </button>
        <button className="cc-btn cc-btn-sm" style={{ background: "var(--cc-card)" }}>
          <FilePlus className="w-3 h-3" />New claim
        </button>
        <button className="cc-btn cc-btn-sm" style={{ background: "var(--cc-card)" }}>
          <Send className="w-3 h-3" />Portal queue (2)
        </button>
        <button className="cc-btn cc-btn-sm" style={{ background: "var(--cc-card)" }}>
          <FileText className="w-3 h-3" />Export this week
        </button>
        <button className="cc-btn cc-btn-sm cc-btn-ghost ml-auto"><RefreshCw className="w-3 h-3" />Refresh</button>
      </div>
    </div>
  );
}
