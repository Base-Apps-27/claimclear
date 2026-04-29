import {
  Download, FileText, ChevronRight, TrendingUp, BarChart3, Users, Truck, UserCircle2,
  AlertTriangle, Search, ArrowUpRight,
} from "lucide-react";
import { ReactNode } from "react";
import {
  PageHeader, FilterStrip, Section, StatusPill, MetricTile,
} from "./_shared";

type Range = "7d" | "30d" | "90d" | "QTD" | "YTD";
const ranges: Range[] = ["7d", "30d", "90d", "QTD", "YTD"];
const rangeCounts: Record<Range, number> = { "7d": 0, "30d": 0, "90d": 0, "QTD": 0, "YTD": 0 };

const errorTypeBars = [
  { name: "Mileage Mismatch",    pct: 38, recovered: "$11,420", denied: "$ 1,640" },
  { name: "Outside Auth Window", pct: 24, recovered: "$ 6,840", denied: "$   420" },
  { name: "GPS Deviation",       pct: 18, recovered: "$ 4,210", denied: "$   980" },
  { name: "Duplicate Charge",    pct: 12, recovered: "$ 2,890", denied: "$   140" },
  { name: "Other",               pct:  8, recovered: "$ 1,610", denied: "$ 1,000" },
];

const team = [
  { who: "M. Rivera",  filed: 84, won: 71, rate: 85 },
  { who: "L. Chen",    filed: 62, won: 51, rate: 82 },
  { who: "A. Patel",   filed: 38, won: 34, rate: 89 },
  { who: "system bot", filed: 24, won: 22, rate: 92 },
];

// Repeat-offender drivers (carNumber acts as the vehicle/driver identifier in the data)
const repeatDrivers = [
  { car: "VAN-118", driver: "D. Ortiz",  rejections: 19, total: "$3,612.40", topReason: "Mileage Mismatch", trend: "up" as const, last: "Apr 24", winRate: 68 },
  { car: "VAN-204", driver: "K. Nguyen", rejections: 14, total: "$2,288.10", topReason: "Outside Auth Window", trend: "up" as const, last: "Apr 23", winRate: 79 },
  { car: "VAN-091", driver: "R. Singh",  rejections: 12, total: "$2,184.50", topReason: "GPS Deviation", trend: "flat" as const, last: "Apr 22", winRate: 88 },
  { car: "VAN-156", driver: "J. Brooks", rejections:  9, total: "$1,498.20", topReason: "Mileage Mismatch", trend: "down" as const, last: "Apr 20", winRate: 84 },
  { car: "VAN-118", driver: "M. Lopez",  rejections:  7, total: "$1,210.60", topReason: "Outside Auth Window", trend: "flat" as const, last: "Apr 19", winRate: 90 },
];

// Repeat-offender members (clientNumber)
const repeatMembers = [
  { id: "CLT-44210", trips: 22, rejections: 14, total: "$2,640.80", topReason: "Outside Auth Window",  flag: "Frequent late pickups", winRate: 71 },
  { id: "CLT-43984", trips: 18, rejections: 11, total: "$2,015.40", topReason: "Mileage Mismatch",     flag: "Address verified short", winRate: 82 },
  { id: "CLT-44089", trips: 15, rejections:  9, total: "$1,680.90", topReason: "GPS Deviation",        flag: "Multiple route variances", winRate: 78 },
  { id: "CLT-43811", trips: 12, rejections:  7, total: "$1,310.20", topReason: "Duplicate Charge",     flag: "Possible double-billing", winRate: 60 },
  { id: "CLT-44512", trips: 10, rejections:  6, total: "$1,090.50", topReason: "Mileage Mismatch",     flag: "—", winRate: 88 },
];

const sparkline = [40, 45, 38, 52, 60, 58, 64, 70, 68, 72, 80, 84];
const sparkW = 280, sparkH = 64;
const sparkPath = (() => {
  const max = Math.max(...sparkline);
  const min = Math.min(...sparkline);
  const dx = sparkW / (sparkline.length - 1);
  return sparkline.map((v, i) => {
    const x = i * dx;
    const y = sparkH - ((v - min) / (max - min || 1)) * (sparkH - 8) - 4;
    return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
})();

function TrendArrow({ d }: { d: "up" | "down" | "flat" }) {
  if (d === "up")   return <span title="more rejections vs last period" style={{ color: "var(--cc-destructive)" }}>▲</span>;
  if (d === "down") return <span title="fewer rejections vs last period" style={{ color: "var(--cc-success)" }}>▼</span>;
  return <span style={{ color: "var(--cc-muted-fg)" }}>—</span>;
}

function MiniBar({ pct, tone = "blue" }: { pct: number; tone?: "blue" | "amber" | "red" | "green" }) {
  const map = { blue: "var(--cc-primary)", amber: "var(--cc-warning)", red: "var(--cc-destructive)", green: "var(--cc-success)" };
  return (
    <div className="h-1.5 rounded flex-1" style={{ background: "var(--cc-muted)" }}>
      <div className="h-full rounded" style={{ width: `${pct}%`, background: map[tone] }} />
    </div>
  );
}

function DrillIn({ children }: { children: ReactNode }) {
  return (
    <button className="cc-btn cc-btn-sm cc-btn-ghost text-[11px]" style={{ color: "var(--cc-primary)" }}>
      {children}<ArrowUpRight className="w-3 h-3" />
    </button>
  );
}

export function SummaryRedesign() {
  return (
    <div className="cc-scope p-6 space-y-5" style={{ width: "100%" }}>
      <PageHeader title="Summary" sub="Recovery analytics and pattern detection · last 30 days" search={false} accent="green" />

      <div className="flex items-center justify-between">
        <FilterStrip tabs={ranges} active="30d" counts={rangeCounts} accent="green" />
        <div className="flex items-center gap-3">
          <span className="text-xs" style={{ color: "var(--cc-muted-fg)" }}>Mar 30 – Apr 28, 2026</span>
          <button className="cc-btn cc-btn-sm"><Download className="w-3 h-3" />Export view</button>
          <button className="cc-btn cc-btn-sm"><FileText className="w-3 h-3" />Monthly report (PDF)</button>
        </div>
      </div>

      {/* Topline */}
      <div className="grid grid-cols-5 gap-3">
        <MetricTile label="Total claims"   value="412"     sub="this period" />
        <MetricTile label="Disputed"       value="$56,840" sub="filed across 38 groups" tone="blue" />
        <MetricTile label="Recovered"      value="$26,840" sub="↑ 22% vs prior 30d" tone="green" />
        <MetricTile label="Total exposure" value="$72,180" sub="claim + 70% vendor prepay" tone="red" />
        <MetricTile label="Recovery rate"  value="84%"     sub="rolling 30 days" tone="muted" />
      </div>

      {/* Trend block — full width */}
      <Section title={<><TrendingUp className="w-4 h-4" />Recovery over time</>}>
        <div className="flex items-center gap-6">
          <div>
            <div className="text-3xl font-bold mono" style={{ color: "var(--cc-success)" }}>$26,840</div>
            <div className="text-xs" style={{ color: "var(--cc-success)" }}>↑ 22% vs prior 30 days</div>
            <div className="text-xs mt-2" style={{ color: "var(--cc-muted-fg)" }}>Best day: <strong>Apr 18</strong> · $4,210 recovered</div>
          </div>
          <div className="flex-1 flex justify-end">
            <svg width={sparkW} height={sparkH}>
              <defs>
                <linearGradient id="sparkfill2" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="var(--cc-green-fg)" stopOpacity="0.25" />
                  <stop offset="100%" stopColor="var(--cc-green-fg)" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path d={`${sparkPath} L${sparkW},${sparkH} L0,${sparkH} Z`} fill="url(#sparkfill2)" />
              <path d={sparkPath} stroke="var(--cc-green-fg)" strokeWidth="2" fill="none" />
            </svg>
          </div>
        </div>
      </Section>

      {/* Repeat-offender block — the deep-dive payoff */}
      <div className="cc-card overflow-hidden" style={{ borderColor: "var(--cc-amber-border)", borderWidth: 2 }}>
        <div className="px-5 py-3 flex items-center justify-between" style={{ background: "var(--cc-amber-bg)", borderBottom: "1px solid var(--cc-amber-border)" }}>
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5" style={{ color: "var(--cc-warning)" }} />
            <span className="text-sm font-bold uppercase tracking-wide" style={{ color: "var(--cc-amber-fg)" }}>Repeat offenders</span>
            <span className="text-xs" style={{ color: "var(--cc-amber-fg)", opacity: 0.85 }}>· vehicles & members generating most rejected claims</span>
          </div>
          <div className="flex items-center gap-1">
            <input placeholder="Filter…" className="cc-input text-xs" style={{
              background: "white", border: "1px solid var(--cc-amber-border)", borderRadius: 6,
              padding: "0.25rem 0.5rem", width: 160, fontSize: 12,
            }} />
          </div>
        </div>

        <div className="grid grid-cols-2" style={{ borderTop: "none" }}>
          {/* DRIVERS / VEHICLES */}
          <div style={{ borderRight: "1px solid var(--cc-border)" }}>
            <div className="px-4 py-2.5 flex items-center justify-between" style={{ background: "var(--cc-bg)", borderBottom: "1px solid var(--cc-border)" }}>
              <div className="flex items-center gap-2 text-xs font-semibold uppercase" style={{ color: "var(--cc-muted-fg)" }}>
                <Truck className="w-3.5 h-3.5" />Drivers / vehicles
                <span className="text-[10px] font-normal normal-case" style={{ opacity: 0.8 }}>(by car #)</span>
              </div>
              <a href="#" className="text-[11px]" style={{ color: "var(--cc-primary)" }}>Browse all 38 →</a>
            </div>
            <div className="text-[10px] uppercase font-semibold px-4 py-1.5 flex items-center gap-3" style={{ background: "var(--cc-muted)", color: "var(--cc-muted-fg)" }}>
              <span style={{ minWidth: 84 }}>Vehicle</span>
              <span className="flex-1">Driver</span>
              <span style={{ minWidth: 56, textAlign: "right" }}>Rejected</span>
              <span style={{ minWidth: 84, textAlign: "right" }}>$ at risk</span>
              <span style={{ minWidth: 28, textAlign: "right" }}>vs</span>
              <span style={{ width: 64 }} />
            </div>
            {repeatDrivers.map((d, i) => (
              <div key={i} className="px-4 py-2.5 flex items-center gap-3 text-sm" style={{ borderBottom: i === repeatDrivers.length - 1 ? "none" : "1px solid var(--cc-border)" }}>
                <span className="mono text-xs font-semibold" style={{ minWidth: 84 }}>{d.car}</span>
                <div className="flex-1 min-w-0">
                  <div className="truncate">{d.driver}</div>
                  <div className="text-[10px] truncate" style={{ color: "var(--cc-muted-fg)" }}>top: {d.topReason}</div>
                </div>
                <span className="mono font-semibold" style={{ minWidth: 56, textAlign: "right" }}>{d.rejections}</span>
                <span className="mono text-xs" style={{ minWidth: 84, textAlign: "right", color: "var(--cc-destructive)" }}>{d.total}</span>
                <span style={{ minWidth: 28, textAlign: "right", fontSize: 12 }}><TrendArrow d={d.trend} /></span>
                <DrillIn>Open</DrillIn>
              </div>
            ))}
          </div>

          {/* MEMBERS */}
          <div>
            <div className="px-4 py-2.5 flex items-center justify-between" style={{ background: "var(--cc-bg)", borderBottom: "1px solid var(--cc-border)" }}>
              <div className="flex items-center gap-2 text-xs font-semibold uppercase" style={{ color: "var(--cc-muted-fg)" }}>
                <UserCircle2 className="w-3.5 h-3.5" />Members
                <span className="text-[10px] font-normal normal-case" style={{ opacity: 0.8 }}>(by client #)</span>
              </div>
              <a href="#" className="text-[11px]" style={{ color: "var(--cc-primary)" }}>Browse all 64 →</a>
            </div>
            <div className="text-[10px] uppercase font-semibold px-4 py-1.5 flex items-center gap-3" style={{ background: "var(--cc-muted)", color: "var(--cc-muted-fg)" }}>
              <span style={{ minWidth: 92 }}>Member</span>
              <span style={{ minWidth: 50, textAlign: "right" }}>Trips</span>
              <span style={{ minWidth: 56, textAlign: "right" }}>Rejected</span>
              <span style={{ minWidth: 84, textAlign: "right" }}>$ at risk</span>
              <span className="flex-1" />
              <span style={{ width: 64 }} />
            </div>
            {repeatMembers.map((m, i) => (
              <div key={i} className="px-4 py-2.5 flex items-center gap-3 text-sm" style={{ borderBottom: i === repeatMembers.length - 1 ? "none" : "1px solid var(--cc-border)" }}>
                <span className="mono text-xs font-semibold" style={{ minWidth: 92, color: "var(--cc-fg)" }}>{m.id}</span>
                <span className="mono text-xs" style={{ minWidth: 50, textAlign: "right", color: "var(--cc-muted-fg)" }}>{m.trips}</span>
                <span className="mono font-semibold" style={{ minWidth: 56, textAlign: "right" }}>{m.rejections}</span>
                <span className="mono text-xs" style={{ minWidth: 84, textAlign: "right", color: "var(--cc-destructive)" }}>{m.total}</span>
                <div className="flex-1 min-w-0 flex items-center gap-2">
                  <span className="text-[10px] truncate" style={{ color: "var(--cc-muted-fg)" }}>{m.flag}</span>
                </div>
                <DrillIn>Open</DrillIn>
              </div>
            ))}
          </div>
        </div>

        <div className="px-5 py-2 flex items-center gap-2 text-xs" style={{ background: "var(--cc-bg)", borderTop: "1px solid var(--cc-border)", color: "var(--cc-muted-fg)" }}>
          <Search className="w-3 h-3" />
          <span>Tip: click <strong>Open</strong> on any row to see all rejected claims for that vehicle or member, with their outcomes.</span>
        </div>
      </div>

      {/* Two-column lower deck: error type breakdown + team productivity */}
      <div className="grid grid-cols-2 gap-5">
        <Section title={<><BarChart3 className="w-4 h-4" />Recovered by error type</>} action={<a href="#" className="text-xs" style={{ color: "var(--cc-primary)" }}>Open Error Types →</a>}>
          <div className="space-y-2.5">
            {errorTypeBars.map(b => (
              <div key={b.name} className="text-sm">
                <div className="flex items-center gap-2 mb-1">
                  <span className="flex-1">{b.name}</span>
                  <span className="text-xs mono" style={{ color: "var(--cc-muted-fg)" }}>{b.pct}%</span>
                  <span className="text-xs font-medium mono" style={{ color: "var(--cc-success)" }}>+{b.recovered}</span>
                  <span className="text-xs mono" style={{ color: "var(--cc-destructive)", opacity: 0.7 }}>-{b.denied}</span>
                </div>
                <MiniBar pct={b.pct * 2} tone="green" />
              </div>
            ))}
          </div>
        </Section>

        <Section title={<><Users className="w-4 h-4" />Team productivity</>} padded={false}>
          <div className="text-[10px] uppercase font-semibold px-4 py-1.5 flex items-center gap-3" style={{ background: "var(--cc-muted)", borderBottom: "1px solid var(--cc-border)", color: "var(--cc-muted-fg)" }}>
            <span style={{ minWidth: 110 }}>Owner</span>
            <span style={{ minWidth: 50, textAlign: "right" }}>Filed</span>
            <span style={{ minWidth: 50, textAlign: "right" }}>Won</span>
            <span className="flex-1">Win rate</span>
          </div>
          {team.map(t => (
            <div key={t.who} className="px-4 py-2.5 flex items-center gap-3 text-sm" style={{ borderBottom: "1px solid var(--cc-border)" }}>
              <span className="font-medium" style={{ minWidth: 110 }}>{t.who}</span>
              <span className="mono" style={{ minWidth: 50, textAlign: "right" }}>{t.filed}</span>
              <span className="mono" style={{ minWidth: 50, textAlign: "right" }}>{t.won}</span>
              <div className="flex-1 flex items-center gap-2">
                <MiniBar pct={t.rate} tone={t.rate >= 85 ? "green" : t.rate >= 75 ? "blue" : "amber"} />
                <span className="text-xs mono" style={{ minWidth: 32, textAlign: "right", color: t.rate >= 85 ? "var(--cc-success)" : "var(--cc-fg)" }}>{t.rate}%</span>
              </div>
            </div>
          ))}
        </Section>
      </div>

      {/* Closed mix — small footer */}
      <div className="grid grid-cols-3 gap-3">
        <div className="cc-card p-3.5">
          <div className="text-[11px] uppercase font-semibold mb-1" style={{ color: "var(--cc-muted-fg)" }}>By status (in flight)</div>
          <div className="text-xs space-y-1">
            <div className="flex justify-between"><span>Needs Review</span><span className="mono">24</span></div>
            <div className="flex justify-between"><span>Needs Evidence</span><span className="mono">18</span></div>
            <div className="flex justify-between"><span>In Dispute</span><span className="mono">92</span></div>
            <div className="flex justify-between"><span>On Hold</span><span className="mono">6</span></div>
          </div>
        </div>
        <div className="cc-card p-3.5">
          <div className="text-[11px] uppercase font-semibold mb-1" style={{ color: "var(--cc-muted-fg)" }}>By outcome (closed)</div>
          <div className="text-xs space-y-1">
            <div className="flex justify-between"><span style={{ color: "var(--cc-success)" }}>Approved</span><span className="mono">31</span></div>
            <div className="flex justify-between"><span style={{ color: "var(--cc-destructive)" }}>Denied</span><span className="mono">14</span></div>
            <div className="flex justify-between"><span style={{ color: "var(--cc-muted-fg)" }}>Withdrawn</span><span className="mono">8</span></div>
          </div>
        </div>
        <div className="cc-card p-3.5">
          <div className="text-[11px] uppercase font-semibold mb-1" style={{ color: "var(--cc-muted-fg)" }}>By payor</div>
          <div className="text-xs space-y-1">
            <div className="flex justify-between"><span>MAS / NY Medicaid</span><span className="mono">388</span></div>
            <div className="flex justify-between"><span>Other</span><span className="mono">24</span></div>
          </div>
        </div>
      </div>
    </div>
  );
}
