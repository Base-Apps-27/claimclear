import { Flame } from "lucide-react";
import { RailHead, RailRow, RailShell, RailToolbar, ROWS } from "./_rail";

export default function E_TodayBand_Compact() {
  const today = ROWS.filter((r) => !r.onHold && r.tier === "today");
  const rest = ROWS.filter((r) => !(r.tier === "today" && !r.onHold));
  const open = ROWS.filter((r) => !r.onHold).length;
  const hold = ROWS.filter((r) => r.onHold).length;
  return (
    <RailShell>
      <RailHead open={open} hold={hold} />
      <RailToolbar />
      <div className="qv-rail-today-band">
        <div className="qv-rail-today-head">
          <Flame className="w-3 h-3" />
          File today · {today.length}
          <span style={{ marginLeft: "auto", fontWeight: 500, textTransform: "none", letterSpacing: 0 }}>pinned</span>
        </div>
        {today.map((r) => <RailRow key={r.id} row={r} />)}
      </div>
      <div className="qv-rail-list">
        {rest.map((r) => <RailRow key={r.id} row={r} />)}
      </div>
    </RailShell>
  );
}
