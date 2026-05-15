import { Frame, ICONS, STATE, TablePeek } from "./_shared";

export default function V2SplitClean() {
  return (
    <Frame
      label="V2 — No filters, nothing hidden (clean state)"
      note="When nothing is filtered or hidden, the entire state strip collapses. The header is just title + count + toolbar. This is the day-to-day default."
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
        <button className="rh-btn rh-btn-sm" style={{ color: "var(--rh-muted-fg)" }}>
          {ICONS.filter}
          Filter
          {ICONS.caret}
        </button>
        <div className="rh-input" style={{ maxWidth: 360 }}>
          {ICONS.search}
          <span>Search invoice #, client, error…</span>
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
