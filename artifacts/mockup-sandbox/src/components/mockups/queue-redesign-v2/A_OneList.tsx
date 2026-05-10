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

export default function A_OneList() {
  const todayCount = ROWS.filter(r => r.tier === "today" && !r.onHold).length;
  const onHoldCount = ROWS.filter(r => r.onHold).length;
  const openCount = ROWS.filter(r => !r.onHold).length;
  return (
    <FrameShell>
      <PageTitle openCount={openCount} onHoldCount={onHoldCount} />
      <UrgencyHero todayCount={todayCount} />
      <ClassificationStrip count={3} />
      <FilterStrip />
      <div className="qv-list">
        {ROWS.map((r) => <Row key={r.id} row={r} />)}
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
