import "./_group.css";
import { CheckCircle2, Sparkles } from "lucide-react";
import { WizardShell, legs } from "./_shared";

// Mirrors today's WalkCompleteHero in inline-group-workspace-v3.tsx (~L709):
// one row per leg with verdict pill + Open button, then a Generate-preview
// button. No transparency into what the AI will receive — this is the gap
// the AI Inputs Summary hero is being designed to close.
export function Current() {
  return (
    <WizardShell>
      <div data-testid="v3-hero-walk-complete" style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <CheckCircle2 className="w-4 h-4" style={{ color: "var(--cc-green-fg)" }} />
          <span style={{ fontWeight: 600, fontSize: "0.875rem" }}>Walk complete · review verdicts</span>
          <span className="cc-meta" style={{ marginLeft: "auto" }}>{legs.length} of {legs.length} legs</span>
        </div>

        {legs.map((leg) => (
          <div key={leg.legNumber} className="cc-card" style={{ padding: "0.625rem 0.75rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span className="cc-meta" style={{ fontSize: "0.625rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>
              Leg {leg.legNumber}
            </span>
            <span className="mono" style={{ fontWeight: 500 }}>{leg.confNumber}</span>
            <span className="cc-meta" style={{ fontSize: "0.6875rem" }}>{leg.date}</span>
            <span className="cc-meta" style={{ fontSize: "0.6875rem", fontVariantNumeric: "tabular-nums" }}>{leg.amount}</span>
            <span className={`cc-pill cc-pill-${leg.verdict.tone}`} style={{ marginLeft: "auto" }}>
              {leg.verdict.label}
            </span>
            <button className="cc-btn cc-btn-ghost cc-btn-sm">Open</button>
          </div>
        ))}

        <div style={{ display: "flex", justifyContent: "flex-end", paddingTop: "0.25rem" }}>
          <button className="cc-btn cc-btn-primary">
            <Sparkles className="w-3.5 h-3.5" /> Generate preview
          </button>
        </div>
      </div>
    </WizardShell>
  );
}
