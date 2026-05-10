import { AlertCircle, PauseCircle, Sparkles } from "lucide-react";
import {
  ClassificationStrip,
  ErrorChip,
  FilterStrip,
  FrameShell,
  PageTitle,
  ROWS,
  UrgencyHero,
  tierPill,
  type RowData,
} from "./_data";

export default function D_Table() {
  const todayCount = ROWS.filter(r => r.tier === "today" && !r.onHold).length;
  const onHoldCount = ROWS.filter(r => r.onHold).length;
  const openCount = ROWS.filter(r => !r.onHold).length;
  return (
    <FrameShell>
      <PageTitle openCount={openCount} onHoldCount={onHoldCount} />
      <UrgencyHero todayCount={todayCount} />
      <ClassificationStrip count={3} />
      <FilterStrip />
      <div className="qv-table-wrap">
        <table className="qv-table">
          <thead>
            <tr>
              <th>Tier</th>
              <th>Invoice</th>
              <th>Rides</th>
              <th>Service</th>
              <th>Error type</th>
              <th>Breakdown</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map(r => <Row key={r.id} row={r} />)}
          </tbody>
        </table>
      </div>
    </FrameShell>
  );
}

function Row({ row }: { row: RowData }) {
  const t = tierPill(row.tier);
  const cls = [
    row.selected ? "qv-table-selected" : "",
    row.onHold ? "qv-table-hold" : (row.tier === "today" ? "qv-table-urgent" : ""),
  ].join(" ");
  return (
    <tr className={cls}>
      <td><span className={t.cls}>{t.label}</span></td>
      <td className="mono" style={{ fontWeight: 700 }}>{row.invoice}</td>
      <td>{row.rides}</td>
      <td>{row.service}</td>
      <td><ErrorChip name={row.errorType} /></td>
      <td>
        <span style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <Cell n={row.ready}          tone="qv-tone-green"  label="Ready" />
          <Cell n={row.investigating}  tone="qv-tone-amber"  label="Inv" />
          <Cell n={row.nonContestable} tone="qv-tone-purple" label="NC" />
          <Cell n={row.nonIssue}       tone="qv-tone-muted"  label="NI" />
          {row.needsClassification > 0 && (
            <span className="qv-pill qv-pill-red qv-pill-strong">
              <AlertCircle className="w-3 h-3" />
              Needs class. {row.needsClassification}
            </span>
          )}
          {row.readyToGenerate && (
            <span className="qv-pill qv-pill-green qv-pill-strong">
              <Sparkles className="w-3 h-3" /> Ready
            </span>
          )}
        </span>
      </td>
      <td>
        {row.onHold ? (
          <span className="qv-pill qv-pill-muted qv-pill-strong">
            <PauseCircle className="w-3 h-3" /> Hold · {row.holdReason}
          </span>
        ) : (
          <span className="qv-meta">—</span>
        )}
      </td>
    </tr>
  );
}

function Cell({ n, tone, label }: { n: number; tone: string; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontWeight: 600, opacity: n === 0 ? 0.4 : 1 }}>
      <span className={`qv-dot ${tone}`} />
      <span className="mono" style={{ fontVariantNumeric: "tabular-nums" }}>{n}</span>
      <span style={{ fontSize: "0.625rem", color: "var(--qv-muted-fg)", textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</span>
    </span>
  );
}
