import { Frame, ICONS, STATE } from "./_shared";

export default function V2SplitFilteredEmpty() {
  return (
    <Frame
      label="V2 — Filtered to zero (no rows match)"
      note="Distinct from inbox-empty: there ARE pending verdicts, but the active filters hide them all. The state strip explains why and offers a one-click 'Clear filters' so the operator isn't stuck."
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
        <span className="rh-chip rh-chip-blue">
          Service date · last 7 days <span className="rh-chip-x">{ICONS.x}</span>
        </span>
        <span className="rh-spacer" />
        <button className="rh-btn rh-btn-ghost rh-btn-sm">Clear all</button>
      </div>

      <div
        style={{
          padding: "2.5rem 1rem",
          borderRadius: 12,
          background: "var(--rh-card)",
          border: "1px dashed var(--rh-border)",
          textAlign: "center",
        }}
      >
        <h2 className="rh-h2" style={{ fontSize: "1rem", marginBottom: "0.25rem" }}>
          No responses match these filters
        </h2>
        <p className="rh-prose" style={{ margin: "0 auto 0.875rem" }}>
          {STATE.groupCount} responses are pending — none match all 3 of your active filters.
        </p>
        <button className="rh-btn">Clear all filters</button>
      </div>
    </Frame>
  );
}
