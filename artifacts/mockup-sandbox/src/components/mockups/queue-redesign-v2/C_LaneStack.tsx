import { ChevronDown, Clock, CalendarDays, PauseCircle } from "lucide-react";
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

export default function C_LaneStack() {
  const today = ROWS.filter(r => !r.onHold && (r.tier === "today" || r.tier === "tomorrow"));
  const week = ROWS.filter(r => !r.onHold && (r.tier === "soon" || r.tier === "week" || r.tier === "later"));
  const hold = ROWS.filter(r => r.onHold);
  return (
    <FrameShell>
      <PageTitle openCount={today.length + week.length} onHoldCount={hold.length} />
      <ClassificationStrip count={3} />
      <FilterStrip />

      <div className="qv-section qv-lane-today">
        <div className="qv-section-head">
          <ChevronDown className="w-3.5 h-3.5" />
          <Clock className="w-3.5 h-3.5" />
          On the clock
          <span className="qv-pill qv-pill-red qv-pill-strong">{today.length}</span>
          <span className="qv-meta" style={{ textTransform: "none", letterSpacing: 0, fontWeight: 400 }}>
            Today &amp; tomorrow — file these before EOD.
          </span>
        </div>
        <div className="qv-section-body">
          {today.map(r => <Row key={r.id} row={r} />)}
        </div>
      </div>

      <div className="qv-section qv-lane-week">
        <div className="qv-section-head">
          <ChevronDown className="w-3.5 h-3.5" />
          <CalendarDays className="w-3.5 h-3.5" />
          This week &amp; later
          <span className="qv-pill qv-pill-muted qv-pill-strong">{week.length}</span>
        </div>
        <div className="qv-section-body">
          {week.map(r => <Row key={r.id} row={r} />)}
        </div>
      </div>

      <div className="qv-section qv-lane-hold">
        <div className="qv-section-head">
          <ChevronDown className="w-3.5 h-3.5" />
          <PauseCircle className="w-3.5 h-3.5" />
          On hold
          <span className="qv-pill qv-pill-muted qv-pill-strong">{hold.length}</span>
          <span className="qv-meta" style={{ textTransform: "none", letterSpacing: 0, fontWeight: 400 }}>
            Still on the clock — review hold reasons.
          </span>
        </div>
        <div className="qv-section-body">
          {hold.map(r => <Row key={r.id} row={r} />)}
        </div>
      </div>
    </FrameShell>
  );
}

function Row({ row }: { row: RowData }) {
  const t = tierPill(row.tier);
  const cls = [
    "qv-row",
    row.selected ? "qv-row-selected" : "",
    row.onHold ? "qv-row-hold" : (row.tier === "today" ? "qv-row-urgent" : row.tier === "tomorrow" ? "qv-row-tomorrow" : ""),
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
