import "./_group.css";
import { useState } from "react";
import {
  Sparkles, ShieldCheck, AlertTriangle, CheckCircle2, ChevronDown, ChevronRight,
  Settings, Map, FileCheck2, FileText, StickyNote, XCircle,
} from "lucide-react";
import { WizardShell, legs, promptLegs, droppedLegs, type MockLeg, type LegEvidence } from "./_shared";

// VARIANT C — Confidence ledger
// Hypothesis: operators want to know what could go wrong BEFORE they hit
// Generate, not just what's in the package. Each in-prompt leg gets a
// risk read (Strong / Watch / Risk) derived from heuristics — evidence
// count, SOP terminal, context note presence. The instruction-layer is
// shown as a "what could surprise you" callout. Filtered legs are not
// hidden; they're shown as line items so the operator sees the cancel
// happening in plain sight.

type RiskTone = "green" | "amber" | "red";

function legRisk(leg: MockLeg): { tone: RiskTone; label: string; reason: string } {
  if (!leg.inPrompt) {
    return { tone: "amber", label: "Not in prompt", reason: leg.reasonExcluded ?? "" };
  }
  // Strong: 2+ evidence files AND context note AND green verdict
  const hasContext = !!leg.contextNote && leg.contextNote !== "—";
  if (leg.evidence.length >= 2 && hasContext && leg.verdict.tone === "green") {
    return { tone: "green", label: "Strong", reason: `${leg.evidence.length} files · operator note attached · clear SOP terminal` };
  }
  if (leg.evidence.length === 1 || !hasContext) {
    return { tone: "amber", label: "Watch", reason: hasContext ? "Single attachment — AI has thin source material" : "No operator context note — AI will lean entirely on SOP answers" };
  }
  return { tone: "red", label: "Risk", reason: "SOP terminal node is contested for this error type" };
}

function evIcon(kind: LegEvidence["kind"]) {
  if (kind === "gps") return <Map className="w-3 h-3" />;
  if (kind === "log") return <FileCheck2 className="w-3 h-3" />;
  return <FileText className="w-3 h-3" />;
}

function PrimaryRiskCallout() {
  const overrideCount = promptLegs.filter((l) => l.instructionLayer.kind === "override").length;
  return (
    <div className="cc-card" style={{ padding: "0.625rem 0.75rem", display: "flex", alignItems: "flex-start", gap: "0.5rem", background: "var(--cc-blue-bg)", border: "1px solid var(--cc-blue-border)" }}>
      <ShieldCheck className="w-4 h-4" style={{ color: "var(--cc-blue-fg)", marginTop: "0.0625rem", flexShrink: 0 }} />
      <div style={{ flex: 1, fontSize: "0.75rem", color: "var(--cc-blue-fg)", lineHeight: 1.5 }}>
        <b>What could surprise you:</b>{" "}
        {overrideCount > 0 ? (
          <>1 leg uses a <b>custom GPS-Deviation override</b> — its phrasing rules differ from the rest. Default applies to the others.</>
        ) : (
          <>All in-prompt legs use the <b>Default Dispute Instructions</b>. No leg-specific overrides active.</>
        )}
      </div>
      <button className="cc-btn cc-btn-ghost cc-btn-sm" style={{ flexShrink: 0 }}>
        <Settings className="w-3 h-3" /> Manage
      </button>
    </div>
  );
}

export function VariantC() {
  const [openId, setOpenId] = useState<number | null>(null);

  return (
    <WizardShell helper="Pre-flight check the AI inputs, then generate the preview.">
      <div style={{ display: "flex", flexDirection: "column", gap: "0.625rem" }}>
        {/* Hero header */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <Sparkles className="w-4 h-4" style={{ color: "var(--cc-primary)" }} />
          <div style={{ fontWeight: 600, fontSize: "0.875rem" }}>Pre-flight · AI inputs</div>
          <span className="cc-meta" style={{ marginLeft: "auto" }}>{promptLegs.length} in prompt · {droppedLegs.length} filtered</span>
        </div>

        <PrimaryRiskCallout />

        {/* Ledger — every leg gets a row, in-prompt and not */}
        <div className="cc-card" style={{ overflow: "hidden" }}>
          {legs.map((leg, i) => {
            const r = legRisk(leg);
            const isOpen = openId === leg.legNumber;
            const isDropped = !leg.inPrompt;
            return (
              <div key={leg.legNumber} style={{ borderTop: i === 0 ? "none" : "1px solid var(--cc-border)", opacity: isDropped ? 0.78 : 1 }}>
                <button
                  onClick={() => setOpenId(isOpen ? null : leg.legNumber)}
                  style={{
                    width: "100%", display: "flex", alignItems: "center", gap: "0.5rem",
                    padding: "0.625rem 0.75rem", background: "transparent", border: 0, cursor: "pointer",
                    textAlign: "left", color: "inherit", fontFamily: "inherit",
                  }}
                >
                  {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                  <span className="cc-meta" style={{ fontSize: "0.625rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                    Leg {leg.legNumber}
                  </span>
                  <span className="mono" style={{ fontWeight: 500 }}>{leg.confNumber}</span>
                  <span className="cc-meta" style={{ fontSize: "0.6875rem" }}>{leg.errorTypeName}</span>

                  <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "0.375rem" }}>
                    {/* Risk pill */}
                    <span className={`cc-pill cc-pill-${r.tone}`}>
                      {r.tone === "green" && <CheckCircle2 className="w-3 h-3" />}
                      {r.tone === "amber" && <AlertTriangle className="w-3 h-3" />}
                      {r.tone === "red"   && <XCircle className="w-3 h-3" />}
                      {r.label}
                    </span>
                    {/* Quick stats */}
                    {!isDropped && (
                      <>
                        <span className="cc-pill cc-pill-muted" title="evidence files">{leg.evidence.length} ev</span>
                        <span className="cc-pill cc-pill-muted" title="SOP questions">{leg.sopTranscript.length} Q</span>
                        {leg.instructionLayer.kind === "override" ? (
                          <span className="cc-pill cc-pill-purple">Override</span>
                        ) : (
                          <span className="cc-pill cc-pill-blue">Default</span>
                        )}
                      </>
                    )}
                  </span>
                </button>

                {/* One-liner risk reason always visible */}
                <div style={{ padding: "0 0.75rem 0.5rem 1.875rem", fontSize: "0.6875rem", color: "var(--cc-muted-fg)", display: "flex", alignItems: "center", gap: "0.25rem" }}>
                  {r.tone === "green" ? <CheckCircle2 className="w-3 h-3" style={{ color: "var(--cc-green-fg)" }} /> : <AlertTriangle className="w-3 h-3" style={{ color: r.tone === "red" ? "var(--cc-red-fg)" : "var(--cc-amber-fg)" }} />}
                  {r.reason}
                </div>

                {/* Expanded detail */}
                {isOpen && !isDropped && (
                  <div style={{ padding: "0.5rem 0.75rem 0.75rem 1.875rem", background: "var(--cc-muted)", display: "flex", flexDirection: "column", gap: "0.5rem", borderTop: "1px solid var(--cc-border)" }}>
                    {/* SOP transcript */}
                    <div style={{ fontSize: "0.75rem", lineHeight: 1.5 }}>
                      <div className="cc-meta" style={{ fontSize: "0.625rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.25rem" }}>SOP walk</div>
                      {leg.sopTranscript.map((qa, idx) => (
                        <div key={idx} style={{ display: "flex", gap: "0.375rem" }}>
                          <span className="cc-meta mono" style={{ minWidth: "1.25rem" }}>Q{idx + 1}</span>
                          <span style={{ color: "var(--cc-muted-fg)" }}>{qa.question}</span>
                          <span style={{ marginLeft: "0.25rem", fontWeight: 500 }}>→ {qa.answer}</span>
                        </div>
                      ))}
                    </div>
                    {/* Evidence */}
                    <div>
                      <div className="cc-meta" style={{ fontSize: "0.625rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.25rem" }}>Evidence</div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem" }}>
                        {leg.evidence.map((e) => (
                          <span key={e.name} className="cc-pill cc-pill-muted mono" style={{ fontSize: "0.625rem" }}>
                            {evIcon(e.kind)} {e.name}
                          </span>
                        ))}
                      </div>
                    </div>
                    {/* Context */}
                    {leg.contextNote && leg.contextNote !== "—" && (
                      <div style={{ fontSize: "0.75rem" }}>
                        <div className="cc-meta" style={{ fontSize: "0.625rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.25rem", display: "flex", alignItems: "center", gap: "0.25rem" }}>
                          <StickyNote className="w-3 h-3" /> Operator context
                        </div>
                        <div style={{ fontStyle: "italic" }}>"{leg.contextNote}"</div>
                      </div>
                    )}
                    {/* Instructions */}
                    <div style={{ fontSize: "0.75rem" }}>
                      <div className="cc-meta" style={{ fontSize: "0.625rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.25rem", display: "flex", alignItems: "center", gap: "0.25rem" }}>
                        <ShieldCheck className="w-3 h-3" /> {leg.instructionLayer.label}
                      </div>
                      <div style={{ color: "var(--cc-muted-fg)", lineHeight: 1.45 }}>
                        {leg.instructionLayer.preview}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* CTA */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", paddingTop: "0.25rem" }}>
          <span className="cc-meta" style={{ fontSize: "0.6875rem", display: "flex", alignItems: "center", gap: "0.25rem" }}>
            <CheckCircle2 className="w-3 h-3" style={{ color: "var(--cc-green-fg)" }} /> 1 Strong · 1 Watch · 1 Filtered
          </span>
          <button className="cc-btn cc-btn-primary" style={{ marginLeft: "auto" }}>
            <Sparkles className="w-3.5 h-3.5" /> Generate preview
          </button>
        </div>
      </div>
    </WizardShell>
  );
}
