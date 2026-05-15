import { Frame, ICONS, STATE, TablePeek } from "./_shared";

export default function V4Minimal() {
  return (
    <Frame
      label="V4 — Minimal / Focus"
      note="Aggressive declutter. Title + count + a single large search pill. Filter and sort hide behind icon buttons that open sheets. Active-filter and hidden chips appear ONLY when they exist (and they do here, so they're shown)."
    >
      <div className="rh-row" style={{ alignItems: "baseline" }}>
        <h1 className="rh-h1" style={{ fontSize: "1.75rem" }}>
          Responses Awaiting Review
        </h1>
        <span className="rh-badge rh-badge-blue" style={{ fontWeight: 600, fontSize: "0.8125rem" }}>
          {STATE.groupCount}
        </span>
      </div>

      <div className="rh-row" style={{ gap: "0.5rem" }}>
        <div className="rh-input rh-input-lg" style={{ flex: 1 }}>
          {ICONS.search}
          <span>Search invoice #, client, error description…</span>
        </div>
        <button className="rh-btn" style={{ height: 40, width: 40, padding: 0, justifyContent: "center" }} title="Filter">
          {ICONS.filter}
        </button>
        <button className="rh-btn" style={{ height: 40, width: 40, padding: 0, justifyContent: "center" }} title="Sort">
          {ICONS.sort}
        </button>
      </div>

      <div className="rh-row" style={{ fontSize: "0.8125rem" }}>
        <span style={{ color: "var(--rh-muted-fg)" }}>2 filters:</span>
        {STATE.activeFilters.map((f) => (
          <span key={f.key} className="rh-chip">
            {f.label} <span className="rh-chip-x">{ICONS.x}</span>
          </span>
        ))}
        <span className="rh-spacer" />
        <a style={{ color: "var(--rh-muted-fg)", cursor: "pointer" }}>
          {STATE.hiddenAcknowledgmentOnly} hidden
        </a>
      </div>

      <div
        className="rh-row"
        style={{
          padding: "0.625rem 0.875rem",
          borderRadius: 8,
          background: "hsl(141 78% 95% / 0.5)",
          border: "1px solid var(--rh-green-border)",
        }}
      >
        <span style={{ color: "var(--rh-green-fg)" }}>{ICONS.spark}</span>
        <span style={{ fontSize: "0.8125rem", color: "var(--rh-green-fg)", fontWeight: 500 }}>
          {STATE.highConfidenceEligible} responses look like clean approvals.
        </span>
        <button className="rh-btn rh-btn-sm" style={{ marginLeft: "auto", color: "var(--rh-green-fg)", borderColor: "var(--rh-green-border)" }}>
          Select all & review
        </button>
      </div>

      <TablePeek />
    </Frame>
  );
}
