import { Frame, ICONS, STATE, TablePeek } from "./_shared";

export default function Current() {
  return (
    <Frame
      label="Current — today (faithful)"
      note="8 stacked strips before the first row (incl. unclassified-responses card when present, two hidden buckets). Two prose blurbs. 'Select all High-confidence Approvals' duplicated in sort row + (when active) bulk bar."
    >
      <div>
        <h1 className="rh-h1">Responses Awaiting Review</h1>
        <p className="rh-sub">
          Pick a verdict on each payor reply. Re-attestation work lives on the
          dedicated Attestation Queue page.
        </p>
      </div>

      <div className="rh-row" style={{ gap: "0.75rem" }}>
        <p className="rh-prose">
          Stage 2 inbox. The payor responded — read what they said, weigh the
          AI hint, and pick the verdict (continue the dispute, mark paid, or
          close as denied). Oldest response first.
        </p>
        <span className="rh-badge">{STATE.groupCount} verdict pending</span>
      </div>

      {/* UnclassifiedResponsesSection (conditional, shown when present) */}
      <div
        style={{
          padding: "0.625rem 0.875rem",
          borderRadius: 8,
          background: "var(--rh-amber-bg)",
          border: "1px solid var(--rh-amber-border)",
          fontSize: "0.8125rem",
          color: "var(--rh-amber-fg)",
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: "0.25rem" }}>
          3 responses need an error type
        </div>
        Pick an error type so they enter the verdict-pending workflow.
        <a style={{ marginLeft: "0.5rem", color: "var(--rh-primary)", textDecoration: "underline", textUnderlineOffset: 2, cursor: "pointer" }}>
          Classify now →
        </a>
      </div>

      <div className="rh-card-strip">
        {ICONS.eyeOff}
        <span style={{ fontSize: "0.8125rem", color: "var(--rh-muted-fg)" }}>
          Hidden from this view:
        </span>
        <span className="rh-chip rh-chip-blue">
          4 waiting for payor again
        </span>
        <span className="rh-chip rh-chip-slate">
          {STATE.hiddenAcknowledgmentOnly} have only acknowledgment/abstain responses
        </span>
      </div>

      <div>
        <div className="rh-row">
          <button className="rh-btn">
            {ICONS.filter}
            Filter
            <span className="rh-badge rh-badge-blue" style={{ padding: "0 0.375rem" }}>
              {STATE.activeFilters.length}
            </span>
          </button>
          <div style={{ position: "relative", flex: 1, maxWidth: 380 }}>
            <div className="rh-input">
              {ICONS.search}
              <span>Search invoice #, client, error description…</span>
            </div>
          </div>
        </div>
        <div className="rh-row" style={{ marginTop: "0.5rem" }}>
          {STATE.activeFilters.map((f) => (
            <span key={f.key} className="rh-chip">
              {f.label} <span className="rh-chip-x">{ICONS.x}</span>
            </span>
          ))}
          <button className="rh-btn rh-btn-ghost rh-btn-sm">Clear all</button>
        </div>
      </div>

      <div className="rh-row" style={{ justifyContent: "flex-end" }}>
        <button className="rh-btn rh-btn-sm">
          Select all High-confidence Approvals
          <span className="rh-badge" style={{ padding: "0 0.25rem" }}>{STATE.highConfidenceEligible}</span>
        </button>
        {ICONS.sort}
        <div className="rh-input" style={{ width: 220, flex: "none", color: "var(--rh-fg)" }}>
          <span>{STATE.sortLabel}</span>
          <span style={{ marginLeft: "auto" }}>{ICONS.caret}</span>
        </div>
      </div>

      <TablePeek />
    </Frame>
  );
}
