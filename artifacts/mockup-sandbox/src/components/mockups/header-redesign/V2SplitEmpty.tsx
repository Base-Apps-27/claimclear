import { Frame, ICONS } from "./_shared";

export default function V2SplitEmpty() {
  return (
    <Frame
      label="V2 — Empty (inbox at zero)"
      note="When there's nothing to review, the header gets out of the way. Big confirming message in the data area instead of empty filter chrome. Filter/sort hide because there's nothing to filter."
    >
      <div className="rh-row" style={{ alignItems: "baseline" }}>
        <h1 className="rh-h1">Responses Awaiting Review</h1>
        <span className="rh-badge rh-badge-green" style={{ fontWeight: 600 }}>
          0 verdict pending
        </span>
        <span className="rh-spacer" />
        <span style={{ color: "var(--rh-muted-fg)", fontSize: "0.8125rem" }}>
          Stage 2 inbox
        </span>
      </div>

      <div
        style={{
          padding: "3rem 1rem",
          borderRadius: 12,
          background: "hsl(141 78% 95% / 0.4)",
          border: "1px dashed var(--rh-green-border)",
          textAlign: "center",
        }}
      >
        <div style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 48, height: 48, borderRadius: 9999, background: "var(--rh-green-bg)", color: "var(--rh-green-fg)", marginBottom: "0.75rem" }}>
          {ICONS.check}
        </div>
        <h2 className="rh-h2" style={{ fontSize: "1.125rem", marginBottom: "0.25rem" }}>
          Inbox clear
        </h2>
        <p className="rh-prose" style={{ margin: "0 auto" }}>
          Every payor reply has a verdict. New responses will appear here as they arrive.
        </p>
        <div className="rh-row" style={{ justifyContent: "center", marginTop: "1rem" }}>
          <a style={{ fontSize: "0.8125rem", color: "var(--rh-primary)", textDecoration: "underline", textUnderlineOffset: 2, cursor: "pointer" }}>
            6 are hidden (acknowledgment/abstain only) — review anyway
          </a>
        </div>
      </div>
    </Frame>
  );
}
