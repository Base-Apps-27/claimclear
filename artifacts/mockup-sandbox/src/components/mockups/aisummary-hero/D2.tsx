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
  Mail,
  Paperclip,
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
        padding: "0.625rem 0.75rem",
        opacity: filtered ? 0.7 : 1,
        borderStyle: filtered ? "dashed" : "solid",
        display: "flex",
        flexDirection: "column",
        gap: "0.4rem",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", flexWrap: "wrap" }}>
        <span className="cc-meta-strong" style={{ fontSize: "0.7rem" }}>LEG {leg.legNumber}</span>
        <span className="mono font-semibold" style={{ fontSize: "0.8rem" }}>{leg.confNumber}</span>
        <span className="cc-chip cc-chip-quiet" style={{ fontSize: "0.7rem" }}>{leg.errorTypeName}</span>
        <span className="cc-meta" style={{ fontSize: "0.72rem", marginLeft: "auto" }}>{leg.amount}</span>
      </div>

      {filtered && (
        <div
          style={{
            fontSize: "0.72rem",
            color: "var(--cc-warn-fg)",
            background: "var(--cc-warn-bg)",
            padding: "0.3rem 0.5rem",
            borderRadius: "4px",
          }}
        >
          Not sent to AI · {leg.reasonExcluded}
        </div>
      )}

      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "0.18rem" }}>
        {leg.sopTranscript.map((t, i) => {
          const yes = t.answer.toLowerCase().startsWith("yes");
          return (
            <li key={i} style={{ display: "flex", alignItems: "flex-start", gap: "0.35rem", fontSize: "0.74rem", lineHeight: 1.3 }}>
              {yes ? (
                <CheckCircle2 className="w-3 h-3" style={{ color: "var(--cc-success)", marginTop: 2, flexShrink: 0 }} />
              ) : (
                <XCircle className="w-3 h-3" style={{ color: "var(--cc-warn)", marginTop: 2, flexShrink: 0 }} />
              )}
              <span style={{ color: "var(--cc-muted-fg)" }}>{t.question}</span>
              <span style={{ marginLeft: "auto", fontWeight: 500, color: "var(--cc-fg)" }}>
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
        <div className="cc-meta" style={{ fontSize: "0.7rem", fontStyle: "italic", borderTop: "1px dashed var(--cc-border)", paddingTop: "0.3rem" }}>
          “{leg.contextNote}”
        </div>
      )}
    </div>
  );
}

const previewByLeg: Record<number, string> = {
  1: `On April 24, ride 8847291 was held at the dialysis facility past the scheduled 14:15 pickup. The driver waited curbside from 14:18. The facility's signed release sheet documents the rider's actual release at 14:42 — a delay of 27 minutes attributable to facility intake.

We respectfully request reversal of the offset on this leg.`,
  3: `Ride 8847298 on April 24 deviated from the most direct path due to an active municipal closure. The attached DOT closure notice covers the entire ride window. The alternate path added 1.4 miles. The rider arrived on time.

Per the custom GPS-Deviation guidance, no inference is drawn about driver intent.`,
};

export default function D2() {
  return (
    <WizardShell helper="Inputs and draft ready · review then submit.">
      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <Sparkles className="w-4 h-4" style={{ color: "var(--cc-accent)" }} />
          <h2 style={{ margin: 0, fontSize: "0.95rem", fontWeight: 600 }}>What the AI sees · what it wrote</h2>
          <span className="cc-meta" style={{ marginLeft: "auto", fontSize: "0.78rem" }}>
            {promptLegs.length} legs in prompt · {droppedLegs.length} filtered
          </span>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.875rem", alignItems: "start" }}>
          {/* LEFT — inputs */}
          <div style={{ display: "flex", flexDirection: "column", gap: "0.625rem" }}>
            <div className="cc-meta-strong" style={{ fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.04em" }}>
              Inputs · per leg
            </div>
            {legs.map((leg) => (
              <MiniCard key={leg.legNumber} leg={leg} />
            ))}
            <div
              className="cc-card"
              style={{
                padding: "0.625rem 0.75rem",
                background: "var(--cc-info-bg)",
                borderColor: "var(--cc-info-border)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "0.35rem", marginBottom: "0.25rem" }}>
                <ScrollText className="w-3.5 h-3.5" style={{ color: "var(--cc-info-fg)" }} />
                <span style={{ fontSize: "0.78rem", fontWeight: 600, color: "var(--cc-info-fg)" }}>How this will be written</span>
              </div>
              <p style={{ margin: 0, fontSize: "0.74rem", lineHeight: 1.5 }}>
                Two paragraphs · one per contestable leg. Leg 1 uses the default Time-at-Facility phrasing.
                Leg 3 uses your custom GPS-Deviation override (no driver-intent speculation). Leg 2 is filtered
                so it won't be written up as a win.
              </p>
            </div>
          </div>

          {/* RIGHT — generated preview */}
          <div
            className="cc-card"
            style={{
              padding: 0,
              overflow: "hidden",
              position: "sticky",
              top: 0,
            }}
          >
            <div
              style={{
                padding: "0.55rem 0.75rem",
                borderBottom: "1px solid var(--cc-border)",
                display: "flex",
                alignItems: "center",
                gap: "0.4rem",
                background: "var(--cc-subtle-bg)",
              }}
            >
              <Mail className="w-3.5 h-3.5" style={{ color: "var(--cc-muted-fg)" }} />
              <span style={{ fontSize: "0.78rem", fontWeight: 600 }}>Generated draft</span>
              <button className="cc-btn cc-btn-ghost cc-btn-sm" style={{ marginLeft: "auto" }}>
                Regenerate
              </button>
            </div>
            <div style={{ padding: "0.75rem", display: "flex", flexDirection: "column", gap: "0.6rem", fontSize: "0.78rem", lineHeight: 1.55 }}>
              <div style={{ borderBottom: "1px dashed var(--cc-border)", paddingBottom: "0.4rem", display: "flex", flexDirection: "column", gap: "0.15rem" }}>
                <div className="cc-meta" style={{ fontSize: "0.7rem" }}>To: portal-disputes@operator</div>
                <div className="cc-meta" style={{ fontSize: "0.7rem" }}>Re: INV-2026-04812 · 2 legs disputed</div>
              </div>
              {promptLegs.map((leg) => (
                <div key={leg.legNumber} style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.3rem" }}>
                    <span className="cc-meta-strong" style={{ fontSize: "0.7rem" }}>LEG {leg.legNumber}</span>
                    <span className="mono cc-meta" style={{ fontSize: "0.72rem" }}>{leg.confNumber}</span>
                    <span className="cc-meta" style={{ fontSize: "0.72rem" }}>· {leg.amount}</span>
                  </div>
                  <pre
                    style={{
                      margin: 0,
                      fontFamily: "Inter, system-ui, sans-serif",
                      fontSize: "0.78rem",
                      lineHeight: 1.55,
                      whiteSpace: "pre-wrap",
                      color: "var(--cc-fg)",
                    }}
                  >
                    {previewByLeg[leg.legNumber]}
                  </pre>
                </div>
              ))}
              <div
                className="cc-meta"
                style={{
                  fontSize: "0.72rem",
                  display: "flex",
                  alignItems: "center",
                  gap: "0.35rem",
                  borderTop: "1px dashed var(--cc-border)",
                  paddingTop: "0.4rem",
                }}
              >
                <Paperclip className="w-3 h-3" />
                5 attachments · facility-release-sheet.pdf, gps-trace-8847291.json, driver-log-04-24.txt, dot-closure-notice.pdf, gps-trace-8847298.json
              </div>
            </div>
          </div>
        </div>
      </div>
    </WizardShell>
  );
}
