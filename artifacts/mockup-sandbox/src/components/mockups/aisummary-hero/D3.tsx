import "./_group.css";
import {
  WizardShell,
  legs,
  promptLegs,
  droppedLegs,
  type MockLeg,
} from "./_shared";
import {
  CheckCircle2,
  XCircle,
  FileText,
  MapPin,
  ScrollText,
  Sparkles,
  ArrowRight,
  Ban,
} from "lucide-react";

function evIcon(kind: MockLeg["evidence"][number]["kind"]) {
  if (kind === "gps") return <MapPin className="w-3 h-3" />;
  if (kind === "log") return <ScrollText className="w-3 h-3" />;
  return <FileText className="w-3 h-3" />;
}

const previewByLeg: Record<number, string> = {
  1: `On April 24, ride 8847291 was held at the dialysis facility past the scheduled 14:15 pickup. The driver waited curbside from 14:18. The facility's signed release sheet documents the rider's actual release at 14:42 — a delay of 27 minutes attributable to facility intake.

We respectfully request reversal of the offset on this leg.`,
  3: `Ride 8847298 on April 24 deviated from the most direct path due to an active municipal closure. The attached DOT closure notice covers the entire ride window. The alternate path added 1.4 miles. The rider arrived on time.

Per the custom GPS-Deviation guidance, no inference is drawn about driver intent.`,
};

function PairedRow({ leg }: { leg: MockLeg }) {
  const filtered = !leg.inPrompt;
  return (
    <div
      className="cc-card"
      style={{
        padding: 0,
        overflow: "hidden",
        opacity: filtered ? 0.78 : 1,
        borderStyle: filtered ? "dashed" : "solid",
      }}
    >
      <div
        style={{
          padding: "0.5rem 0.75rem",
          borderBottom: "1px solid var(--cc-border)",
          background: "var(--cc-subtle-bg)",
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          flexWrap: "wrap",
        }}
      >
        <span className="cc-meta-strong" style={{ fontSize: "0.7rem" }}>LEG {leg.legNumber}</span>
        <span className="mono font-semibold" style={{ fontSize: "0.82rem" }}>{leg.confNumber}</span>
        <span className="cc-chip cc-chip-quiet" style={{ fontSize: "0.7rem" }}>{leg.errorTypeName}</span>
        <span className="cc-meta" style={{ fontSize: "0.72rem" }}>· {leg.amount}</span>
        <span style={{ marginLeft: "auto" }}>
          {filtered ? (
            <span className="cc-pill cc-pill-amber" style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem" }}>
              <Ban className="w-3 h-3" /> Not in prompt · will cancel
            </span>
          ) : leg.instructionLayer.kind === "override" ? (
            <span className="cc-pill cc-pill-purple">Custom phrasing</span>
          ) : (
            <span className="cc-pill cc-pill-quiet">Default phrasing</span>
          )}
        </span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: filtered ? "1fr" : "minmax(0,1fr) 1.1fr", gap: 0 }}>
        {/* INPUT side */}
        <div style={{ padding: "0.625rem 0.75rem", display: "flex", flexDirection: "column", gap: "0.4rem", borderRight: filtered ? "none" : "1px solid var(--cc-border)" }}>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "0.2rem" }}>
            {leg.sopTranscript.map((t, i) => {
              const yes = t.answer.toLowerCase().startsWith("yes");
              return (
                <li key={i} style={{ display: "flex", alignItems: "flex-start", gap: "0.35rem", fontSize: "0.74rem", lineHeight: 1.35 }}>
                  {yes ? (
                    <CheckCircle2 className="w-3 h-3" style={{ color: "var(--cc-success)", marginTop: 2, flexShrink: 0 }} />
                  ) : (
                    <XCircle className="w-3 h-3" style={{ color: "var(--cc-warn)", marginTop: 2, flexShrink: 0 }} />
                  )}
                  <span style={{ color: "var(--cc-muted-fg)" }}>{t.question}</span>
                  <span style={{ marginLeft: "auto", fontWeight: 500, color: "var(--cc-fg)", textAlign: "right" }}>
                    {t.answer.split(" — ")[0]}
                  </span>
                </li>
              );
            })}
          </ul>
          <div style={{ display: "flex", alignItems: "center", gap: "0.3rem", flexWrap: "wrap" }}>
            {leg.evidence.map((e) => (
              <span key={e.name} className="cc-chip cc-chip-quiet" style={{ fontSize: "0.68rem", gap: "0.2rem", padding: "0.1rem 0.4rem" }}>
                {evIcon(e.kind)}
                <span className="mono">{e.name}</span>
              </span>
            ))}
          </div>
          {!filtered && (
            <div className="cc-meta" style={{ fontSize: "0.7rem", fontStyle: "italic" }}>
              Operator: “{leg.contextNote}”
            </div>
          )}
          {filtered && leg.reasonExcluded && (
            <div className="cc-meta" style={{ fontSize: "0.72rem" }}>
              {leg.reasonExcluded}
            </div>
          )}
        </div>

        {/* OUTPUT side (only for in-prompt legs) */}
        {!filtered && (
          <div style={{ padding: "0.625rem 0.75rem", background: "var(--cc-canvas-bg)", display: "flex", flexDirection: "column", gap: "0.3rem" }}>
            <div className="cc-meta" style={{ fontSize: "0.68rem", display: "flex", alignItems: "center", gap: "0.3rem" }}>
              <ArrowRight className="w-3 h-3" /> Generated paragraph
            </div>
            <pre
              style={{
                margin: 0,
                fontFamily: "Inter, system-ui, sans-serif",
                fontSize: "0.76rem",
                lineHeight: 1.55,
                whiteSpace: "pre-wrap",
                color: "var(--cc-fg)",
              }}
            >
              {previewByLeg[leg.legNumber]}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

export default function D3() {
  return (
    <WizardShell helper="Inputs paired with the generated draft · review then submit.">
      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <Sparkles className="w-4 h-4" style={{ color: "var(--cc-accent)" }} />
          <h2 style={{ margin: 0, fontSize: "0.95rem", fontWeight: 600 }}>What the AI sees · what it wrote</h2>
          <span className="cc-meta" style={{ marginLeft: "auto", fontSize: "0.78rem" }}>
            {promptLegs.length} legs in prompt · {droppedLegs.length} filtered · 1 custom override
          </span>
        </div>

        {/* Processing banner up top */}
        <div
          className="cc-card"
          style={{
            padding: "0.55rem 0.75rem",
            background: "var(--cc-info-bg)",
            borderColor: "var(--cc-info-border)",
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            fontSize: "0.76rem",
            color: "var(--cc-info-fg)",
            lineHeight: 1.45,
          }}
        >
          <ScrollText className="w-3.5 h-3.5" style={{ flexShrink: 0 }} />
          <span>
            <strong>How this gets written:</strong> one paragraph per contestable leg. Leg 1 uses the default Time-at-Facility phrasing.
            Leg 3 uses your custom GPS-Deviation override. Leg 2 is filtered — the AI never sees it, so it can't be claimed as a win.
          </span>
          <button className="cc-btn cc-btn-ghost cc-btn-sm" style={{ marginLeft: "auto", flexShrink: 0 }}>
            Regenerate
          </button>
        </div>

        {/* Paired rows */}
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {legs.map((leg) => (
            <PairedRow key={leg.legNumber} leg={leg} />
          ))}
        </div>
      </div>
    </WizardShell>
  );
}
