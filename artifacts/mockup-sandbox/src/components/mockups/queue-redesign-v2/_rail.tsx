import "./_queue_v2.css";
import { AlertCircle, Filter, Search, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import { ROWS, type RowData } from "./_data";

export { ROWS };
export type { RowData };

export function RailShell({ children }: { children: ReactNode }) {
  return <div className="qv-scope qv-rail">{children}</div>;
}

export function RailHead({
  open,
  hold,
  todayCount,
}: {
  open: number;
  hold: number;
  todayCount?: number;
}) {
  return (
    <>
      <div className="qv-rail-head">
        <h3>Invoice queue</h3>
        <span className="qv-rail-counts">
          {open} open · {hold} hold
        </span>
        <span className="qv-rail-spacer" />
        <button className="qv-btn qv-btn-sm qv-btn-ghost" title="Expand">
          ⤢
        </button>
      </div>
      {todayCount != null && todayCount > 0 && (
        <div className="qv-rail-urgency">
          <span className="qv-rail-urgency-num">{todayCount}</span>
          <span>must file today · EOD</span>
        </div>
      )}
      <div className="qv-rail-class">
        <AlertCircle className="w-3 h-3" />
        Classification Inbox · 3 unclassified
        <button className="qv-link qv-link-xs qv-rail-class-link">Open</button>
      </div>
    </>
  );
}

export function RailToolbar() {
  return (
    <>
      <div className="qv-rail-toolbar">
        <div className="qv-segmented" role="group">
          <button className="is-active">Needs</button>
          <button>All</button>
        </div>
        <button className="qv-btn qv-btn-sm">
          <Filter className="w-3 h-3" />
          Filters
          <span className="qv-tag">2</span>
        </button>
        <span style={{ flex: 1 }} />
        <button className="qv-btn qv-btn-sm qv-btn-ghost" title="Hide past-deadline">⏷</button>
      </div>
      <div className="qv-rail-search">
        <Search className="w-3 h-3" style={{ color: "var(--qv-muted-fg)" }} />
        <input placeholder="Search invoice, error…" />
      </div>
      <div className="qv-rail-chips">
        <span className="qv-chip qv-chip-blue">Ready to review ×</span>
        <span className="qv-chip qv-chip-amber">Mileage mismatch ×</span>
        <button className="qv-link qv-link-xs">Clear</button>
      </div>
    </>
  );
}

function tierShort(t: RowData["tier"], service: string) {
  switch (t) {
    case "today":
      return { label: "TODAY", date: service, cls: "qv-rail-tier-today" };
    case "tomorrow":
      return { label: "TMRW", date: service, cls: "qv-rail-tier-tomorrow" };
    case "soon":
      return { label: "≤3D", date: service, cls: "qv-rail-tier-soon" };
    case "week":
      return { label: "≤7D", date: service, cls: "qv-rail-tier-week" };
    case "later":
      return { label: "LATER", date: service, cls: "qv-rail-tier-later" };
  }
}

function MiniBreakdown({ row }: { row: RowData }) {
  const cells: Array<[number, string, string]> = [
    [row.ready, "qv-tone-green", "Ready"],
    [row.investigating, "qv-tone-amber", "Investigating"],
    [row.nonContestable, "qv-tone-purple", "Non-contestable"],
    [row.nonIssue, "qv-tone-muted", "Non-issue"],
  ];
  return (
    <span className="qv-rail-mini-bd">
      {cells.map(([n, tone, title], i) => (
        <span
          key={i}
          className={`qv-rail-mini-cell ${n === 0 ? "qv-mini-zero" : ""}`}
          title={`${title}: ${n}`}
        >
          <span className={`qv-dot ${tone}`} />
          {n}
        </span>
      ))}
    </span>
  );
}

export function RailRow({ row }: { row: RowData }) {
  const t = tierShort(row.tier, row.service);
  const cls = [
    "qv-rail-row",
    row.selected ? "qv-rail-row-selected" : "",
    row.onHold
      ? "qv-rail-row-hold"
      : row.tier === "today"
      ? "qv-rail-row-urgent"
      : row.tier === "tomorrow"
      ? "qv-rail-row-tomorrow"
      : "",
  ].join(" ");
  return (
    <div className={cls}>
      <div className={`qv-rail-tier ${t.cls}`}>
        <span>{t.label}</span>
        {t.date && <span className="qv-rail-tier-date">{t.date}</span>}
      </div>
      <div className="qv-rail-body">
        <div className="qv-rail-line1">
          <span className="qv-rail-invoice">{row.invoice}</span>
          <span className="qv-rail-rides">{row.rides} rides</span>
        </div>
        <div className="qv-rail-line2">
          <MiniBreakdown row={row} />
        </div>
        <div className="qv-rail-line3">
          <span className="qv-rail-err" title={row.errorType}>
            {row.errorType}
          </span>
          {row.needsClassification > 0 && (
            <span className="qv-rail-needs">
              <AlertCircle className="w-2.5 h-2.5" />
              {row.needsClassification}
            </span>
          )}
          {row.readyToGenerate && (
            <span className="qv-rail-ready">
              <Sparkles className="w-2.5 h-2.5" />
              Ready
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export function RailTRow({ row }: { row: RowData }) {
  const t = tierShort(row.tier, row.service);
  const cls = [
    "qv-rail-trow",
    row.selected ? "qv-rail-trow-selected" : "",
    row.onHold ? "qv-rail-trow-hold" : row.tier === "today" ? "qv-rail-trow-urgent" : "",
  ].join(" ");
  return (
    <div className={cls} title={row.errorType}>
      <span className={`qv-rail-tier ${t.cls}`} style={{ minHeight: 22, padding: "1px 4px", flexDirection: "row", gap: 4 }}>
        {t.label}
        <span className="qv-rail-tier-date" style={{ marginTop: 0 }}>{t.date}</span>
      </span>
      <span className="qv-rail-invoice">{row.invoice}</span>
      <span className="qv-rail-mini-bd">
        <MiniBreakdown row={row} />
        {row.needsClassification > 0 && (
          <span className="qv-rail-needs" style={{ marginLeft: 4 }}>
            <AlertCircle className="w-2.5 h-2.5" />
            {row.needsClassification}
          </span>
        )}
      </span>
      <span className="qv-rail-trow-err">
        {row.onHold ? `hold · ${row.holdReason?.split(" · ")[1] ?? ""}` : row.errorType}
      </span>
    </div>
  );
}
