import { RailHead, RailShell, RailToolbar, RailTRow, ROWS } from "./_rail";

export default function D_Table_Compact() {
  const today = ROWS.filter((r) => !r.onHold && r.tier === "today").length;
  const open = ROWS.filter((r) => !r.onHold).length;
  const hold = ROWS.filter((r) => r.onHold).length;
  return (
    <RailShell>
      <RailHead open={open} hold={hold} todayCount={today} />
      <RailToolbar />
      <div className="qv-rail-list">
        {ROWS.map((r) => <RailTRow key={r.id} row={r} />)}
      </div>
    </RailShell>
  );
}
