import { Frame, ICONS, STATE, TablePeek } from "./_shared";

export default function V2SplitMixedSelection() {
  return (
    <Frame
      label="V2 — Adverse selection (mixed eligibility)"
      note="Operator selected 14 rows but only 9 pass the AI/approval/HC gate; 5 would be skipped. Bulk Approve stays enabled but the eligibility math is loud, and a tooltip explains the disabled cap behaviour when reached."
    >
      <div className="rh-row" style={{ alignItems: "baseline" }}>
        <h1 className="rh-h1">Responses Awaiting Review</h1>
        <span className="rh-badge rh-badge-blue" style={{ fontWeight: 600 }}>
          {STATE.groupCount} verdict pending
        </span>
        <span className="rh-spacer" />
        <span style={{ color: "var(--rh-muted-fg)", fontSize: "0.8125rem" }}>
          Stage 2 inbox · oldest first
        </span>
      </div>

      <div className="rh-toolbar">
        <button className="rh-btn rh-btn-sm">
          {ICONS.filter}
          Filter
          {ICONS.caret}
        </button>
        <div className="rh-input" style={{ maxWidth: 360 }}>
          {ICONS.search}
          <span>Search invoice #, client, error…</span>
        </div>
        <span className="rh-spacer" />
        <button className="rh-btn rh-btn-sm" style={{ color: "var(--rh-muted-fg)" }}>
          {ICONS.sort}
          {STATE.sortLabel}
          {ICONS.caret}
        </button>
      </div>

      <div className="rh-bulkbar rh-bulkbar-strong">
        <span style={{ fontSize: "0.875rem", fontWeight: 600 }}>14 selected</span>
        <span style={{ fontSize: "0.75rem", color: "var(--rh-muted-fg)" }}>
          <span style={{ color: "var(--rh-green-fg)", fontWeight: 600 }}>9 eligible</span>
          {" · "}
          <span style={{ color: "var(--rh-amber-fg)", fontWeight: 600 }}>5 would be skipped</span>
          {" · total $11,420.00"}
        </span>
        <span className="rh-spacer" />
        <button className="rh-btn rh-btn-ghost rh-btn-sm">Clear</button>
        <button className="rh-btn rh-btn-primary rh-btn-sm">
          {ICONS.check} Approve 9 eligible
        </button>
      </div>

      <div
        className="rh-row"
        style={{
          gap: "0.375rem",
          padding: "0.4375rem 0.75rem",
          borderRadius: 6,
          background: "var(--rh-amber-bg)",
          border: "1px solid var(--rh-amber-border)",
          fontSize: "0.75rem",
          color: "var(--rh-amber-fg)",
        }}
      >
        {ICONS.info}
        <span>5 selected rows fail the AI/approval/high-confidence gate and won't be approved. They stay selected so you can see which ones.</span>
      </div>

      <TablePeek />
    </Frame>
  );
}
