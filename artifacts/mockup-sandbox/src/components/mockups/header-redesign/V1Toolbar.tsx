import { Frame, ICONS, STATE, TablePeek } from "./_shared";

export default function V1Toolbar() {
  return (
    <Frame
      label="V1 — Compressed Toolbar"
      note="Title + count + all controls collapse to one sticky toolbar. Subtitle moves to a tooltip on the title. Active filters become inline chips on the same line. Bulk action and sort live on the right."
    >
      <div className="rh-row" style={{ alignItems: "baseline" }}>
        <h1 className="rh-h1">Responses Awaiting Review</h1>
        <span className="rh-badge rh-badge-blue" style={{ fontWeight: 600 }}>
          {STATE.groupCount}
        </span>
        <span style={{ color: "var(--rh-muted-fg)", fontSize: "0.8125rem" }}>
          verdict pending
        </span>
        <span title="Stage 2 inbox. Pick a verdict on each payor reply." style={{ color: "var(--rh-muted-fg)", cursor: "help" }}>
          {ICONS.info}
        </span>
        <span className="rh-spacer" />
        <span style={{ fontSize: "0.75rem", color: "var(--rh-muted-fg)" }}>
          {ICONS.eyeOff}
        </span>
        <button className="rh-btn rh-btn-ghost rh-btn-sm" style={{ color: "var(--rh-muted-fg)" }}>
          {STATE.hiddenAcknowledgmentOnly} hidden
        </button>
      </div>

      <div className="rh-toolbar" style={{ position: "sticky", top: 0 }}>
        <button className="rh-btn rh-btn-sm">
          {ICONS.filter}
          Filter
          <span className="rh-badge rh-badge-blue" style={{ padding: "0 0.375rem" }}>
            {STATE.activeFilters.length}
          </span>
          {ICONS.caret}
        </button>

        {STATE.activeFilters.map((f) => (
          <span key={f.key} className="rh-chip rh-chip-blue">
            {f.label} <span className="rh-chip-x">{ICONS.x}</span>
          </span>
        ))}
        <button className="rh-btn rh-btn-ghost rh-btn-sm" style={{ color: "var(--rh-muted-fg)" }}>
          Clear
        </button>

        <div className="rh-divider-v" />

        <div className="rh-input" style={{ maxWidth: 280 }}>
          {ICONS.search}
          <span>Search invoices, clients, errors…</span>
        </div>

        <span className="rh-spacer" />

        <button className="rh-btn rh-btn-sm">
          {ICONS.spark}
          Select {STATE.highConfidenceEligible} HC approvals
        </button>
        <div className="rh-divider-v" />
        <button className="rh-btn rh-btn-sm" style={{ color: "var(--rh-muted-fg)" }}>
          {ICONS.sort}
          {STATE.sortLabel}
          {ICONS.caret}
        </button>
      </div>

      <TablePeek />
    </Frame>
  );
}
