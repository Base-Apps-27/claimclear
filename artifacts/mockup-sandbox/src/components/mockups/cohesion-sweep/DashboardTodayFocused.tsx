import {
  AlertTriangle, Mail, Stamp, ChevronRight, Clock, Activity, Server,
} from "lucide-react";
import { ReactNode } from "react";
import { PageHeader, StatusPill } from "./_shared";

/* ------------------------------------------------------------------ */
/* Mock data                                                           */
/* ------------------------------------------------------------------ */

const fileToday = [
  { num: "INV-1855844580", amount: "$82.68",  service: "Mar 30, 2026", note: "Needs evidence", days: 0 },
  { num: "INV-1852976000", amount: "$22.97",  service: "Mar 30, 2026", note: "On hold",        days: 0 },
  { num: "INV-1751261260", amount: "$30.05",  service: "Mar 30, 2026", note: "On hold",        days: 0 },
];
const fileSoonCount = 5;        // 1–3 days
const fileSoonTotal = "$1,432.40";

const responses = [
  { num: "INV-1855952820", payor: "Healthfirst",    received: "today 9:14a",  conf: "high"   as const },
  { num: "INV-1855019540", payor: "MetroPlus",      received: "today 8:02a",  conf: "low"    as const },
  { num: "INV-1850081300", payor: "Fidelis Care",   received: "yesterday",    conf: "medium" as const },
];
const responsesMore = 9;

const reattest = [
  { num: "INV-1854609210", amount: "$1,210.40", approved: "Apr 28", waiting: "3d" },
  { num: "INV-1854055400", amount: "$  642.10", approved: "Apr 27", waiting: "4d" },
  { num: "INV-1853990110", amount: "$  318.55", approved: "Apr 25", waiting: "6d" },
];

const recent = [
  { who: "Danny S",         action: "Edited dispute write-up for INV-1855952820", when: "just now" },
  { who: "Payor",           action: "Response logged on INV-1855019540",          when: "56m ago" },
  { who: "Response Tracker",action: "Acknowledgment logged · INV-1850081350",     when: "16h ago" },
  { who: "Batch Processor", action: "Moved INV-1854609510 → Awaiting Response",   when: "16h ago" },
  { who: "Retry",           action: "Scheduled retry for INV-1855855900",         when: "17h ago" },
];

/* ------------------------------------------------------------------ */
/* Bits                                                                */
/* ------------------------------------------------------------------ */

function HeroCard({
  tone, eyebrow, count, title, items, footer, icon,
}: {
  tone: "red" | "blue" | "amber";
  eyebrow: string;
  count: number;
  title: string;
  items: { left: ReactNode; right: ReactNode; sub?: ReactNode }[];
  footer?: ReactNode;
  icon: ReactNode;
}) {
  const toneMap = {
    red:   { bg: "var(--cc-red-bg)",   border: "var(--cc-red-border)",   fg: "var(--cc-red-fg)",   accent: "var(--cc-destructive)" },
    blue:  { bg: "var(--cc-blue-bg)",  border: "var(--cc-blue-border)",  fg: "var(--cc-blue-fg)",  accent: "var(--cc-primary)" },
    amber: { bg: "var(--cc-amber-bg)", border: "var(--cc-amber-border)", fg: "var(--cc-amber-fg)", accent: "var(--cc-amber-fg)" },
  }[tone];

  return (
    <div className="cc-card overflow-hidden flex flex-col" style={{ borderColor: toneMap.border, borderWidth: 2 }}>
      <div className="px-4 py-2.5 flex items-center justify-between"
           style={{ background: toneMap.bg, borderBottom: `1px solid ${toneMap.border}` }}>
        <div className="flex items-center gap-2">
          <span style={{ color: toneMap.accent }}>{icon}</span>
          <span className="text-[11px] uppercase tracking-wide font-bold" style={{ color: toneMap.fg }}>
            {eyebrow}
          </span>
        </div>
        <a href="#" className="text-xs font-medium" style={{ color: toneMap.fg }}>See all →</a>
      </div>
      <div className="px-4 pt-3 pb-2">
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-bold mono" style={{ color: toneMap.accent }}>{count}</span>
          <span className="text-sm" style={{ color: "var(--cc-muted-fg)" }}>{title}</span>
        </div>
      </div>
      <div className="flex-1">
        {items.map((it, i) => (
          <div key={i} className="px-4 py-2 flex items-center justify-between"
               style={{ borderTop: "1px solid var(--cc-border)" }}>
            <div className="min-w-0">
              <div className="text-sm font-medium truncate">{it.left}</div>
              {it.sub && <div className="text-xs mt-0.5" style={{ color: "var(--cc-muted-fg)" }}>{it.sub}</div>}
            </div>
            <div className="text-sm mono ml-3 shrink-0" style={{ color: "var(--cc-fg)" }}>{it.right}</div>
          </div>
        ))}
      </div>
      {footer && (
        <div className="px-4 py-2 text-xs"
             style={{ borderTop: "1px solid var(--cc-border)", background: "var(--cc-muted)", color: "var(--cc-muted-fg)" }}>
          {footer}
        </div>
      )}
    </div>
  );
}

function BacklogTile({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline gap-2 px-3 py-2">
      <span className="text-sm font-semibold mono">{value}</span>
      <span className="text-xs" style={{ color: "var(--cc-muted-fg)" }}>{label}</span>
    </div>
  );
}

function MoneyCell({ label, value, tone }: { label: string; value: string; tone?: "good" | "danger" }) {
  const color = tone === "good" ? "var(--cc-success)" : tone === "danger" ? "var(--cc-destructive)" : "var(--cc-fg)";
  return (
    <div className="px-4 py-2 flex flex-col">
      <span className="text-[10px] uppercase tracking-wide font-semibold" style={{ color: "var(--cc-muted-fg)" }}>{label}</span>
      <span className="text-base mono font-semibold" style={{ color }}>{value}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export function DashboardTodayFocused() {
  return (
    <div className="cc-scope p-6 space-y-5" style={{ width: "100%" }}>
      <PageHeader title="Command center" search={false} accent="blue" />

      {/* PERSONALIZED READOUT — the very top line that orients the user */}
      <div className="cc-card px-5 py-4">
        <div className="text-base">
          You have{" "}
          <span className="font-bold mono" style={{ color: "var(--cc-destructive)" }}>3</span> to file,{" "}
          <span className="font-bold mono" style={{ color: "var(--cc-primary)" }}>12</span> responses to review, and{" "}
          <span className="font-bold mono" style={{ color: "var(--cc-amber-fg)" }}>3</span> reattests pending.
        </div>
        <div className="text-sm mt-1" style={{ color: "var(--cc-muted-fg)" }}>
          Start with filing — <span className="mono">INV-1855844580</span> expires today.
        </div>
      </div>

      {/* TODAY'S WORK — three hero columns */}
      <div>
        <div className="text-xs uppercase tracking-wide font-bold mb-2" style={{ color: "var(--cc-muted-fg)" }}>
          Today's work
        </div>
        <div className="grid grid-cols-3 gap-3">
          <HeroCard
            tone="red"
            icon={<AlertTriangle className="w-4 h-4" />}
            eyebrow="File today"
            count={3}
            title="must be submitted before EOD"
            items={fileToday.map(g => ({
              left: <span className="mono">{g.num}</span>,
              right: g.amount,
              sub: <>{g.service} · {g.note}</>,
            }))}
            footer={<>+ <span className="mono font-semibold">{fileSoonCount}</span> more in next 3 days · {fileSoonTotal}</>}
          />
          <HeroCard
            tone="blue"
            icon={<Mail className="w-4 h-4" />}
            eyebrow="Responses to review"
            count={12}
            title="payor responses awaiting outcome"
            items={responses.map(r => ({
              left: <span className="mono">{r.num}</span>,
              right: <StatusPill tone={r.conf === "low" ? "amber" : r.conf === "high" ? "green" : "muted"}>
                {r.conf} conf
              </StatusPill>,
              sub: <>{r.payor} · received {r.received}</>,
            }))}
            footer={<>+ {responsesMore} more in queue</>}
          />
          <HeroCard
            tone="amber"
            icon={<Stamp className="w-4 h-4" />}
            eyebrow="MAS reattest pending"
            count={3}
            title="awaiting billing admin in MAS portal"
            items={reattest.map(r => ({
              left: <span className="mono">{r.num}</span>,
              right: r.amount,
              sub: <>approved {r.approved} · waiting {r.waiting}</>,
            }))}
            footer={<>Open Attestation Queue →</>}
          />
        </div>
      </div>

      {/* ALERTS STRIP — only shown when something is wrong */}
      <div className="cc-card flex items-center gap-3 px-4 py-2.5 text-sm"
           style={{ borderColor: "var(--cc-amber-border)", background: "var(--cc-amber-bg)" }}>
        <AlertTriangle className="w-4 h-4 shrink-0" style={{ color: "var(--cc-amber-fg)" }} />
        <span className="font-medium" style={{ color: "var(--cc-amber-fg)" }}>System health: 1 component needs attention</span>
        <span style={{ color: "var(--cc-amber-fg)", opacity: 0.85 }}>· Portal worker has not run today</span>
        <a href="#" className="ml-auto text-xs font-medium" style={{ color: "var(--cc-amber-fg)" }}>System health →</a>
      </div>

      {/* BACKLOG STRIP — context, not action */}
      <div className="cc-card">
        <div className="px-4 py-2 flex items-center gap-2 text-[11px] uppercase tracking-wide font-semibold"
             style={{ color: "var(--cc-muted-fg)", borderBottom: "1px solid var(--cc-border)" }}>
          <Clock className="w-3.5 h-3.5" /> Backlog
        </div>
        <div className="grid grid-cols-4 divide-x" style={{ borderColor: "var(--cc-border)" }}>
          <BacklogTile label="needs evidence"        value="852" />
          <BacklogTile label="awaiting response"     value="27" />
          <BacklogTile label="in MAS reattest queue" value="14" />
          <BacklogTile label="portal queue"          value="5" />
        </div>
      </div>

      {/* MONEY STRIP — quiet row */}
      <div className="cc-card grid grid-cols-4 divide-x" style={{ borderColor: "var(--cc-border)" }}>
        <MoneyCell label="Total exposure" value="$172,520.13" tone="danger" />
        <MoneyCell label="Recovered"      value="$0.00"        tone="good" />
        <MoneyCell label="Denied (4)"     value="$2,140.10" />
        <MoneyCell label="Withdrawn (0)"  value="$0.00" />
      </div>

      {/* RECENT ACTIVITY */}
      <div className="cc-card">
        <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: "1px solid var(--cc-border)" }}>
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Activity className="w-4 h-4" /> Recent activity
          </div>
          <a href="#" className="text-xs" style={{ color: "var(--cc-primary)" }}>See all →</a>
        </div>
        <div>
          {recent.map((r, i) => (
            <div key={i} className="px-4 py-2 flex items-center justify-between text-sm"
                 style={{ borderTop: i === 0 ? "none" : "1px solid var(--cc-border)" }}>
              <div className="min-w-0">
                <span className="font-medium">{r.who}</span>{" "}
                <span style={{ color: "var(--cc-muted-fg)" }}>{r.action}</span>
              </div>
              <span className="text-xs ml-3 shrink-0" style={{ color: "var(--cc-muted-fg)" }}>{r.when}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Footer hint */}
      <div className="flex items-center gap-2 text-xs px-1" style={{ color: "var(--cc-muted-fg)" }}>
        <Server className="w-3 h-3" />
        Past-due items are no longer shown here. View them on the Queue page.
        <ChevronRight className="w-3 h-3" />
      </div>
    </div>
  );
}
