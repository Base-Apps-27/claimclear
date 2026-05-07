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
  ChevronRight,
  Eye,
} from "lucide-react";

function evIcon(kind: MockLeg["evidence"][number]["kind"]) {
  if (kind === "gps") return <MapPin className="w-3 h-3" />;
  if (kind === "log") return <ScrollText className="w-3 h-3" />;
  return <FileText className="w-3 h-3" />;
}

function MiniCard({ leg }: { leg: MockLeg }) {
  const filtered = !leg.inPrompt;
  return (
    <div
      className="cc-card"
      style={{
        padding: "0.75rem 0.875rem",
        opacity: filtered ? 0.72 : 1,
        borderStyle: filtered ? "dashed" : "solid",
        display: "flex",
        flexDirection: "column",
        gap: "0.5rem",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
        <span className="cc-meta-strong">LEG {leg.legNumber}</span>
        <span className="mono font-semibold">{leg.confNumber}</span>
        <span className="cc-chip cc-chip-quiet">{leg.errorTypeName}</span>
        <span className="cc-meta">{leg.amount}</span>
        <span style={{ marginLeft: "auto" }}>
          {filtered ? (
            <span className="cc-pill cc-pill-amber">Not in prompt · will cancel</span>
          ) : leg.instructionLayer.kind === "override" ? (
            <span className="cc-pill cc-pill-purple">Custom phrasing</span>
          ) : (
            <span className="cc-pill cc-pill-quiet">Default phrasing</span>
          )}
        </span>
      </div>

      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "0.25rem" }}>
        {leg.sopTranscript.map((t, i) => {
          const yes = t.answer.toLowerCase().startsWith("yes");
          return (
            <li key={i} style={{ display: "flex", alignItems: "flex-start", gap: "0.4rem", fontSize: "0.78rem", lineHeight: 1.35 }}>
              {yes ? (
                <CheckCircle2 className="w-3 h-3" style={{ color: "var(--cc-success)", marginTop: 2, flexShrink: 0 }} />
              ) : (
                <XCircle className="w-3 h-3" style={{ color: "var(--cc-warn)", marginTop: 2, flexShrink: 0 }} />
              )}
              <span style={{ color: "var(--cc-muted-fg)" }}>{t.question}</span>
              <span style={{ marginLeft: "auto", fontWeight: 500, color: "var(--cc-fg)", textAlign: "right" }}>{t.answer}</span>
            </li>
          );
        })}
      </ul>

      <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", flexWrap: "wrap" }}>
        <span className="cc-meta" style={{ fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.04em" }}>
          Evidence
        </span>
        {leg.evidence.length === 0 && <span className="cc-meta">none</span>}
        {leg.evidence.map((e) => (
          <span key={e.name} className="cc-chip cc-chip-quiet" style={{ fontSize: "0.7rem", gap: "0.25rem" }}>
            {evIcon(e.kind)}
            <span className="mono">{e.name}</span>
          </span>
        ))}
      </div>

      {filtered && leg.reasonExcluded && (
        <div className="cc-meta" style={{ fontSize: "0.72rem", fontStyle: "italic" }}>
          {leg.reasonExcluded}
        </div>
      )}
    </div>
  );
}

const previewByLeg: Record<number, string> = {
  1: `On April 24, ride 8847291 was held at the dialysis facility past the scheduled 14:15 pickup. The driver waited curbside from 14:18. The facility's signed release sheet documents the rider's actual release at 14:42 — a delay of 27 minutes attributable to facility intake.

We respectfully request reversal of the offset on this leg.

Supporting: facility-release-sheet.pdf, gps-trace-8847291.json, driver-log-04-24.txt.`,
  3: `Ride 8847298 on April 24 deviated from the most direct path due to an active municipal closure. The attached DOT closure notice covers the entire ride window. The alternate path added 1.4 miles. The rider arrived on time.

Per the custom GPS-Deviation guidance, no inference is drawn about driver intent.

Supporting: dot-closure-notice.pdf, gps-trace-8847298.json.`,
};

export default function D1() {
  return (
    <WizardShell helper="Inputs and draft generated · review then submit.">
      <div style={{ display: "flex", flexDirection: "column", gap: "0.875rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <Sparkles className="w-4 h-4" style={{ color: "var(--cc-accent)" }} />
          <h2 style={{ margin: 0, fontSize: "0.95rem", fontWeight: 600 }}>What the AI sees · what it wrote</h2>
          <span className="cc-meta" style={{ marginLeft: "auto", fontSize: "0.78rem" }}>
            {promptLegs.length} of {legs.length} legs in prompt · {droppedLegs.length} filtered
          </span>
        </div>

        {/* Mini-card grid */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
            gap: "0.625rem",
          }}
        >
          {legs.map((leg) => (
            <MiniCard key={leg.legNumber} leg={leg} />
          ))}
        </div>

        {/* Processing note */}
        <div
          className="cc-card"
          style={{
            padding: "0.75rem 0.875rem",
            background: "var(--cc-info-bg)",
            borderColor: "var(--cc-info-border)",
            display: "flex",
            flexDirection: "column",
            gap: "0.35rem",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
            <ScrollText className="w-3.5 h-3.5" style={{ color: "var(--cc-info-fg)" }} />
            <span style={{ fontSize: "0.82rem", fontWeight: 600, color: "var(--cc-info-fg)" }}>How this will be written</span>
          </div>
          <p style={{ margin: 0, fontSize: "0.78rem", color: "var(--cc-fg)", lineHeight: 1.5 }}>
            The AI is writing <strong>2 dispute paragraphs</strong> from the {promptLegs.length} contestable legs above.
            Leg 1 follows the <strong>default Time-at-Facility phrasing</strong> — cite documented release time, state the gap in minutes, keep
            it to 2–3 short paragraphs. Leg 3 follows your <strong>custom GPS-Deviation override</strong> — lead with the closure source,
            state the mileage delta, no speculation about driver intent. Leg 2 is excluded so it won't be written up as a win.
          </p>
        </div>

        {/* Generated preview panel */}
        <div className="cc-card" style={{ padding: 0, overflow: "hidden" }}>
          <div
            style={{
              padding: "0.55rem 0.875rem",
              borderBottom: "1px solid var(--cc-border)",
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              background: "var(--cc-subtle-bg)",
            }}
          >
            <Eye className="w-3.5 h-3.5" style={{ color: "var(--cc-muted-fg)" }} />
            <span style={{ fontSize: "0.82rem", fontWeight: 600 }}>Generated dispute draft</span>
            <span className="cc-meta" style={{ fontSize: "0.72rem" }}>To portal · re: INV-2026-04812</span>
            <button className="cc-btn cc-btn-ghost cc-btn-sm" style={{ marginLeft: "auto" }}>
              Regenerate
            </button>
          </div>
          <div style={{ padding: "0.875rem", display: "flex", flexDirection: "column", gap: "0.875rem" }}>
            {promptLegs.map((leg) => (
              <div key={leg.legNumber} style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                  <span className="cc-meta-strong" style={{ fontSize: "0.72rem" }}>LEG {leg.legNumber}</span>
                  <span className="mono" style={{ fontSize: "0.78rem", color: "var(--cc-muted-fg)" }}>
                    {leg.confNumber}
                  </span>
                  <ChevronRight className="w-3 h-3" style={{ color: "var(--cc-muted-fg)" }} />
                  <span className="cc-chip cc-chip-quiet" style={{ fontSize: "0.7rem" }}>
                    {leg.errorTypeName}
                  </span>
                </div>
                <pre
                  style={{
                    margin: 0,
                    padding: "0.625rem 0.75rem",
                    background: "var(--cc-canvas-bg)",
                    border: "1px solid var(--cc-border)",
                    borderRadius: "6px",
                    fontFamily: "Inter, system-ui, sans-serif",
                    fontSize: "0.78rem",
                    lineHeight: 1.5,
                    whiteSpace: "pre-wrap",
                    color: "var(--cc-fg)",
                  }}
                >
                  {previewByLeg[leg.legNumber]}
                </pre>
              </div>
            ))}
          </div>
        </div>
      </div>
    </WizardShell>
  );
}
