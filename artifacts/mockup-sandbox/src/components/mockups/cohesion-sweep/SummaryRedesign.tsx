import {
  Sparkles, Download, FileText, ChevronRight, TrendingUp, BarChart3, Users, Tag,
} from "lucide-react";
import {
  PageHeader, FilterStrip, StatusStrip, StatusDot, Section, ActionGroup, RowAction, StatusPill, MetricTile, Recommended, PrimaryButton,
} from "./_shared";

type Range = "7d" | "30d" | "90d" | "QTD" | "YTD";
const ranges: Range[] = ["7d", "30d", "90d", "QTD", "YTD"];
const rangeCounts: Record<Range, number> = { "7d": 0, "30d": 0, "90d": 0, "QTD": 0, "YTD": 0 };

const errorTypeBars = [
  { name: "Mileage Mismatch",     pct: 38, recovered: "$11,420" },
  { name: "Outside Auth Window",  pct: 24, recovered: "$ 6,840" },
  { name: "GPS Deviation",        pct: 18, recovered: "$ 4,210" },
  { name: "Duplicate Charge",     pct: 12, recovered: "$ 2,890" },
  { name: "Other",                pct:  8, recovered: "$ 1,610" },
];

const team = [
  { who: "M. Rivera",  filed: 84, won: 71, rate: "85%" },
  { who: "L. Chen",    filed: 62, won: 51, rate: "82%" },
  { who: "A. Patel",   filed: 38, won: 34, rate: "89%" },
  { who: "system bot", filed: 24, won: 22, rate: "92%" },
];

const sparkline = [40, 45, 38, 52, 60, 58, 64, 70, 68, 72, 80, 84];
const sparkW = 220, sparkH = 64;
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

export function SummaryRedesign() {
  return (
    <div className="cc-scope p-6 space-y-4" style={{ width: "100%" }}>
      <PageHeader title="Summary" sub="Recovery performance · last 30 days" search={false} accent="green" />

      <div className="flex items-center justify-between">
        <FilterStrip tabs={ranges} active="30d" counts={rangeCounts} accent="green" />
        <div className="flex items-center gap-2 text-xs" style={{ color: "var(--cc-muted-fg)" }}>
          <span>Mar 30 – Apr 28, 2026</span>
        </div>
      </div>

      <StatusStrip>
        <StatusDot tone="green" />
        <span className="font-medium">On pace to clear $34k this month</span>
        <span style={{ color: "var(--cc-muted-fg)" }}>·</span>
        <span style={{ color: "var(--cc-muted-fg)" }}>$26,840 recovered so far · 3 days remaining</span>
        <a href="#" className="ml-auto" style={{ color: "var(--cc-primary)", fontWeight: 500 }}>Set monthly goal →</a>
      </StatusStrip>

      <div className="grid grid-cols-4 gap-3">
        <MetricTile label="Recovered" value="$26,840" sub="↑ 22% vs prior 30d" tone="green" />
        <MetricTile label="In dispute" value="$24,810" sub="92 claims across 14 groups" tone="blue" />
        <MetricTile label="Lost"      value="$ 4,180" sub="14 denials, all final" tone="red" />
        <MetricTile label="Approval rate" value="84%" sub="rolling 30 days" tone="muted" />
      </div>

      <div className="grid grid-cols-12 gap-5">
        <div className="col-span-8 space-y-4">
          <Section title={<><TrendingUp className="w-4 h-4" />Recovery over time</>} action={<a href="#" className="text-xs" style={{ color: "var(--cc-primary)" }}>Export</a>}>
            <div className="flex items-end gap-6">
              <div>
                <div className="text-3xl font-bold mono">$26,840</div>
                <div className="text-xs" style={{ color: "var(--cc-success)" }}>↑ 22% vs prior 30 days</div>
              </div>
              <svg width={sparkW} height={sparkH} className="ml-auto">
                <defs>
                  <linearGradient id="sparkfill" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="var(--cc-green-fg)" stopOpacity="0.25" />
                    <stop offset="100%" stopColor="var(--cc-green-fg)" stopOpacity="0" />
                  </linearGradient>
                </defs>
                <path d={`${sparkPath} L${sparkW},${sparkH} L0,${sparkH} Z`} fill="url(#sparkfill)" />
                <path d={sparkPath} stroke="var(--cc-green-fg)" strokeWidth="2" fill="none" />
              </svg>
            </div>
          </Section>

          <Section title={<><BarChart3 className="w-4 h-4" />Recovered by error type</>} action={<a href="#" className="text-xs" style={{ color: "var(--cc-primary)" }}>Open Error Types</a>}>
            <div className="space-y-2">
              {errorTypeBars.map(b => (
                <div key={b.name} className="flex items-center gap-3 text-sm">
                  <span style={{ minWidth: 180 }}>{b.name}</span>
                  <div className="flex-1 h-2 rounded" style={{ background: "var(--cc-muted)" }}>
                    <div className="h-full rounded" style={{ width: `${b.pct * 2}%`, background: "var(--cc-green-fg)" }} />
                  </div>
                  <span className="text-xs mono" style={{ color: "var(--cc-muted-fg)", minWidth: 32, textAlign: "right" }}>{b.pct}%</span>
                  <span className="text-sm font-medium mono" style={{ minWidth: 76, textAlign: "right" }}>{b.recovered}</span>
                </div>
              ))}
            </div>
          </Section>

          <Section title={<><Users className="w-4 h-4" />Team productivity</>} padded={false}>
            <div className="text-xs px-4 py-2 flex items-center gap-3" style={{ background: "var(--cc-muted)", borderBottom: "1px solid var(--cc-border)", color: "var(--cc-muted-fg)" }}>
              <span style={{ minWidth: 140 }}>Owner</span>
              <span className="ml-auto" style={{ minWidth: 60, textAlign: "right" }}>Filed</span>
              <span style={{ minWidth: 60, textAlign: "right" }}>Won</span>
              <span style={{ minWidth: 60, textAlign: "right" }}>Win rate</span>
            </div>
            {team.map(t => (
              <div key={t.who} className="flex items-center gap-3 px-4 py-2.5" style={{ borderBottom: "1px solid var(--cc-border)" }}>
                <span className="text-sm font-medium" style={{ minWidth: 140 }}>{t.who}</span>
                <span className="text-sm mono ml-auto" style={{ minWidth: 60, textAlign: "right" }}>{t.filed}</span>
                <span className="text-sm mono" style={{ minWidth: 60, textAlign: "right" }}>{t.won}</span>
                <span className="text-sm mono" style={{ color: "var(--cc-success)", minWidth: 60, textAlign: "right" }}>{t.rate}</span>
              </div>
            ))}
          </Section>
        </div>

        <aside className="col-span-4 space-y-3" style={{ position: "sticky", top: 16, alignSelf: "start" }}>
          <div className="cc-card overflow-hidden">
            <div className="px-4 py-3 text-sm font-semibold flex items-center justify-between" style={{ borderBottom: "1px solid var(--cc-border)", background: "var(--cc-green-bg)", color: "var(--cc-green-fg)" }}>
              <span className="flex items-center gap-2"><Sparkles className="w-4 h-4" />What this tells you</span>
            </div>

            <Recommended
              tone="green"
              title="Mileage Mismatch is your highest-yield error"
              body="38% of recoveries this period. Worth coding new claims for it first."
              cta={<PrimaryButton tone="green"><ChevronRight className="w-4 h-4" />Open coding rules</PrimaryButton>}
            />

            <ActionGroup label="Export">
              <RowAction icon={<Download className="w-3.5 h-3.5" />} label="Export this view (CSV)" />
              <RowAction icon={<FileText className="w-3.5 h-3.5" />} label="Generate monthly PDF report" />
            </ActionGroup>

            <ActionGroup label="Drill into">
              <RowAction icon={<Tag className="w-3.5 h-3.5" />}      label="Browse all denials this month"   muted />
              <RowAction icon={<ChevronRight className="w-3.5 h-3.5" />} label="Filter Claims by error type" muted />
            </ActionGroup>
          </div>
        </aside>
      </div>
    </div>
  );
}
