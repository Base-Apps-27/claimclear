import { Frame, ICONS, STATE, TablePeek } from "./_shared";

export default function V3CommandBar() {
  return (
    <Frame
      label="V3 — Command Bar"
      note="Search owns the bar. Filters become inline chip-buttons that drop facet menus on click; applied facets stay as active chips in place. Bulk action and hidden items are quiet inline links — they only get loud when actionable."
    >
      <div className="rh-row" style={{ alignItems: "baseline" }}>
        <h1 className="rh-h1">Responses Awaiting Review</h1>
        <span className="rh-badge rh-badge-blue" style={{ fontWeight: 600 }}>
          {STATE.groupCount}
        </span>
        <span style={{ color: "var(--rh-muted-fg)", fontSize: "0.8125rem" }}>verdict pending</span>
      </div>

      <div className="rh-toolbar" style={{ padding: "0.5rem 0.5rem 0.5rem 0.75rem" }}>
        <span style={{ color: "var(--rh-muted-fg)" }}>{ICONS.search}</span>
        <span style={{ flex: 1, color: "var(--rh-muted-fg)", fontSize: "0.875rem" }}>
          Search or type a filter…
        </span>
        <span style={{ fontSize: "0.6875rem", color: "var(--rh-muted-fg)", border: "1px solid var(--rh-border)", padding: "1px 5px", borderRadius: 4, background: "var(--rh-muted)" }}>
          ⌘K
        </span>
      </div>

      <div className="rh-row">
        {/* facet chip-buttons — applied facets show their value, unapplied show the bare label */}
        <span className="rh-chip rh-chip-blue">
          Status · response_pending <span className="rh-chip-x">{ICONS.x}</span>
        </span>
        <span className="rh-chip rh-chip-blue">
          Error · Authorization missing <span className="rh-chip-x">{ICONS.x}</span>
        </span>
        <button className="rh-chip" style={{ borderStyle: "dashed", color: "var(--rh-muted-fg)" }}>
          + Date of service
        </button>
        <button className="rh-chip" style={{ borderStyle: "dashed", color: "var(--rh-muted-fg)" }}>
          + Response received
        </button>
        <button className="rh-chip" style={{ borderStyle: "dashed", color: "var(--rh-muted-fg)" }}>
          + Response type
        </button>
        <button className="rh-chip" style={{ borderStyle: "dashed", color: "var(--rh-muted-fg)" }}>
          + Payor / client
        </button>
      </div>

      <div className="rh-row" style={{ fontSize: "0.8125rem", color: "var(--rh-muted-fg)" }}>
        <a style={{ color: "var(--rh-primary)", textDecoration: "underline", textUnderlineOffset: 2, cursor: "pointer" }}>
          {STATE.highConfidenceEligible} high-confidence approvals — select all
        </a>
        <span>·</span>
        <a style={{ cursor: "pointer" }}>
          {STATE.hiddenAcknowledgmentOnly} hidden (acknowledgment/abstain only)
        </a>
        <span className="rh-spacer" />
        <span>{ICONS.sort}</span>
        <a style={{ cursor: "pointer" }}>{STATE.sortLabel}</a>
        <span>{ICONS.caret}</span>
      </div>

      <TablePeek />
    </Frame>
  );
}
