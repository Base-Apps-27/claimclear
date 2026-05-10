import { ChevronDown } from "lucide-react";
import {
  Breakdown,
  ClassificationStrip,
  ErrorChip,
  FilterStrip,
  FrameShell,
  HoldRibbon,
  PageTitle,
  ROWS,
  UrgencyHero,
  tierPill,
  type RowData,
} from "./_data";

export default function B_Sectioned() {
  const active = ROWS.filter(r => !r.onHold);
  const hold = ROWS.filter(r => r.onHold);
  const todayCount = active.filter(r => r.tier === "today").length;
  return (
    <FrameShell>
      <PageTitle openCount={active.length} onHoldCount={hold.length} />
      <UrgencyHero todayCount={todayCount} />
      <ClassificationStrip count={3} />
      <FilterStrip />

      <div className="qv-section">
        <div className="qv-section-head">
          <ChevronDown className="w-3.5 h-3.5" />
          Action required
          <span className="qv-pill qv-pill-blue qv-pill-strong">{active.length}</span>
        </div>
        <div className="qv-section-body">
          {active.map((r) => <Row key={r.id} row={r} />)}
        </div>
      </div>

      <div className="qv-section">
        <div className="qv-section-head">
          <ChevronDown className="w-3.5 h-3.5" />
          On hold
          <span className="qv-pill qv-pill-muted qv-pill-strong">{hold.length}</span>
          <span className="qv-meta" style={{ textTransform: "none", letterSpacing: 0, fontWeight: 400 }}>
            Still on the deadline clock — resume when unblocked.
          </span>
        </div>
        <div className="qv-section-body">
          {hold.map((r) => <Row key={r.id} row={r} />)}
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
    row.onHold ? "qv-row-hold" : (row.tier === "today" ? "qv-row-urgent" : ""),
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
