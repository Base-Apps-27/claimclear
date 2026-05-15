import { Frame, ICONS, STATE, TablePeek } from "./_shared";

export default function V2Split() {
  return (
    <Frame
      label="V2 — Controls / State Split"
      note="Two clean rows. Row 1 = controls (filter, search, sort, bulk). Row 2 = a single state strip showing what's narrowing the view (active filters + hidden items + clear-all). Page subtitle stays as one short line."
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

      <div
        className="rh-row"
        style={{
          gap: "0.5rem",
          padding: "0.5rem 0.75rem",
          borderRadius: 8,
          background: "hsl(214 100% 96% / 0.5)",
          border: "1px solid var(--rh-blue-border)",
        }}
      >
        <span style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--rh-blue-fg)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
          Showing
        </span>
        {STATE.activeFilters.map((f) => (
          <span key={f.key} className="rh-chip rh-chip-blue">
            {f.label} <span className="rh-chip-x">{ICONS.x}</span>
          </span>
        ))}
        <span style={{ width: 1, height: 18, background: "var(--rh-blue-border)" }} />
        <span style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--rh-slate-fg)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
          Hiding
        </span>
        <span className="rh-chip rh-chip-slate rh-chip-dashed">
          {STATE.hiddenAcknowledgmentOnly} acknowledgment/abstain only
        </span>
        <span className="rh-spacer" />
        <button className="rh-btn rh-btn-ghost rh-btn-sm">Clear all</button>
      </div>

      <TablePeek />
    </Frame>
  );
}
