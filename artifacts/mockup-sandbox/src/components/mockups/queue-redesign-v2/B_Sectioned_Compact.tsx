import { ChevronDown } from "lucide-react";
import { RailHead, RailRow, RailShell, RailToolbar, ROWS } from "./_rail";

export default function B_Sectioned_Compact() {
  const active = ROWS.filter((r) => !r.onHold);
  const hold = ROWS.filter((r) => r.onHold);
  const today = active.filter((r) => r.tier === "today").length;
  return (
    <RailShell>
      <RailHead open={active.length} hold={hold.length} todayCount={today} />
      <RailToolbar />
      <div className="qv-rail-list">
        <div className="qv-rail-divider">
          <ChevronDown className="w-3 h-3" />
          Action required
          <span className="qv-pill qv-pill-blue qv-pill-strong">{active.length}</span>
        </div>
        {active.map((r) => <RailRow key={r.id} row={r} />)}

        <div className="qv-rail-divider qv-rail-divider-hold">
          <ChevronDown className="w-3 h-3" />
          On hold
          <span className="qv-pill qv-pill-muted qv-pill-strong">{hold.length}</span>
        </div>
        {hold.map((r) => <RailRow key={r.id} row={r} />)}
      </div>
    </RailShell>
  );
}
