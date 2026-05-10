import { ChevronRight, Flame } from "lucide-react";
import {
  Breakdown,
  ClassificationStrip,
  ErrorChip,
  FilterStrip,
  FrameShell,
  HoldRibbon,
  PageTitle,
  ROWS,
  tierPill,
  type RowData,
} from "./_data";

export default function E_TodayBand() {
  const today = ROWS.filter(r => !r.onHold && r.tier === "today");
  const rest = ROWS.filter(r => !(r.tier === "today" && !r.onHold));
  const onHoldCount = ROWS.filter(r => r.onHold).length;
  const openCount = ROWS.filter(r => !r.onHold).length;
  return (
    <FrameShell>
      <PageTitle openCount={openCount} onHoldCount={onHoldCount} />
      <ClassificationStrip count={3} />
      <FilterStrip />

      <div className="qv-today-band">
        <div className="qv-today-head">
          <Flame className="w-4 h-4" />
          File today · {today.length} group{today.length !== 1 ? "s" : ""}
          <span style={{ marginLeft: "auto", fontSize: "0.6875rem", textTransform: "none", letterSpacing: 0, fontWeight: 500 }}>
            Pinned to the top until cleared.
          </span>
        </div>
        <div className="qv-today-body">
          {today.map(r => <TodayRow key={r.id} row={r} />)}
        </div>
      </div>

      <div className="qv-list">
        {rest.map((r) => <Row key={r.id} row={r} />)}
      </div>
    </FrameShell>
  );
}

function TodayRow({ row }: { row: RowData }) {
  return (
    <div className="qv-today-row">
      <span className="mono" style={{ fontWeight: 700, fontSize: "0.875rem", color: "var(--qv-red-fg)" }}>{row.invoice}</span>
      <span style={{ fontSize: "0.6875rem", color: "var(--qv-muted-fg)" }}>{row.rides} rides · Service {row.service}</span>
      <ErrorChip name={row.errorType} />
      <span style={{ flex: 1 }} />
      <Breakdown row={row} />
      <ChevronRight className="w-4 h-4" style={{ color: "var(--qv-red-fg)" }} />
    </div>
  );
}

function Row({ row }: { row: RowData }) {
  const t = tierPill(row.tier);
  const cls = [
    "qv-row",
    row.selected ? "qv-row-selected" : "",
    row.onHold ? "qv-row-hold" : (row.tier === "tomorrow" ? "qv-row-tomorrow" : ""),
  ].join(" ");
  return (
    <div className={cls}>
      <div className="qv-row-top">
        <span className={t.cls}>{t.label}</span>
        <span className="qv-row-invoice">{row.invoice}</span>
        <span className="qv-row-rides">{row.rides} rides</span>
        <span className="qv-row-service">Service {row.service}</span>
        <span className="qv-row-spacer" />
        {row.onHold && <HoldRibbon reason={row.holdReason} />}
        <ErrorChip name={row.errorType} />
      </div>
      <div className="qv-row-bottom">
        <Breakdown row={row} />
      </div>
    </div>
  );
}
