import { CalendarDays, ChevronDown, Clock, PauseCircle } from "lucide-react";
import { RailHead, RailRow, RailShell, RailToolbar, ROWS } from "./_rail";

export default function C_LaneStack_Compact() {
  const today = ROWS.filter((r) => !r.onHold && (r.tier === "today" || r.tier === "tomorrow"));
  const week = ROWS.filter((r) => !r.onHold && (r.tier === "soon" || r.tier === "week" || r.tier === "later"));
  const hold = ROWS.filter((r) => r.onHold);
  return (
    <RailShell>
      <RailHead open={today.length + week.length} hold={hold.length} />
      <RailToolbar />
      <div className="qv-rail-list">
        <div className="qv-rail-divider qv-rail-divider-today">
          <ChevronDown className="w-3 h-3" />
          <Clock className="w-3 h-3" />
          On the clock
          <span className="qv-pill qv-pill-red qv-pill-strong">{today.length}</span>
        </div>
        {today.map((r) => <RailRow key={r.id} row={r} />)}

        <div className="qv-rail-divider">
          <ChevronDown className="w-3 h-3" />
          <CalendarDays className="w-3 h-3" />
          This week &amp; later
          <span className="qv-pill qv-pill-muted qv-pill-strong">{week.length}</span>
        </div>
        {week.map((r) => <RailRow key={r.id} row={r} />)}

        <div className="qv-rail-divider qv-rail-divider-hold">
          <ChevronDown className="w-3 h-3" />
          <PauseCircle className="w-3 h-3" />
          On hold
          <span className="qv-pill qv-pill-muted qv-pill-strong">{hold.length}</span>
        </div>
        {hold.map((r) => <RailRow key={r.id} row={r} />)}
      </div>
    </RailShell>
  );
}
