import "./_group.css";
import { useState } from "react";
import {
  Sparkles, ChevronDown, ChevronRight, FileText, Map, FileCheck2,
  StickyNote, Settings, ShieldCheck, Eye, AlertTriangle, CheckCircle2, XCircle,
} from "lucide-react";
import { WizardShell, legs, promptLegs, droppedLegs, type LegEvidence } from "./_shared";

// VARIANT A — Per-leg cards (structured)
// Hypothesis: operators want to verify per-leg reasoning before generation;
// a leg-first card view lets them spot mismatches quickly. Each card folds
// open to the SOP transcript, evidence chips, per-leg context, and shows
// which writing-instruction layer is in effect. A top "Prompt summary"
// strip names which legs the AI WILL see (and which are filtered out).

function evIcon(kind: LegEvidence["kind"]) {
  if (kind === "gps") return <Map className="w-3 h-3" />;
  if (kind === "log") return <FileCheck2 className="w-3 h-3" />;
  if (kind === "photo") return <FileText className="w-3 h-3" />;
  return <FileText className="w-3 h-3" />;
}

export function VariantA() {
  const [open, setOpen] = useState<Record<number, boolean>>({ 1: true, 3: false });
  const overrideCount = promptLegs.filter((l) => l.instructionLayer.kind === "override").length;

  return (
    <WizardShell helper="Review what the AI will see, then generate the preview.">
      <div style={{ display: "flex", flexDirection: "column", gap: "0.625rem" }}>
        {/* Hero header */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <Sparkles className="w-4 h-4" style={{ color: "var(--cc-primary)" }} />
          <div style={{ fontWeight: 600, fontSize: "0.875rem" }}>What the AI will see</div>
          <span className="cc-meta" style={{ marginLeft: "auto" }}>
            {promptLegs.length} of {legs.length} leg{legs.length === 1 ? "" : "s"} in prompt
          </span>
        </div>

        {/* Prompt-layer summary strip */}
        <div className="cc-card" style={{ padding: "0.625rem 0.75rem", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.625rem", background: "var(--cc-muted)" }}>
          <ShieldCheck className="w-3.5 h-3.5" style={{ color: "var(--cc-muted-fg)" }} />
          <div style={{ display: "flex", flexDirection: "column", gap: "0.125rem", flex: 1, minWidth: "12rem" }}>
            <div style={{ fontSize: "0.75rem", fontWeight: 600 }}>Writing instructions in use</div>
            <div className="cc-meta" style={{ fontSize: "0.6875rem" }}>
              Default applies to {promptLegs.length - overrideCount} leg · {overrideCount} custom override
            </div>
          </div>
          <span className="cc-pill cc-pill-blue">Default · global</span>
          {overrideCount > 0 && <span className="cc-pill cc-pill-purple">Custom · GPS Deviation</span>}
          <button className="cc-btn cc-btn-ghost cc-btn-sm"><Settings className="w-3 h-3" /> Manage</button>
        </div>

        {/* Per-leg cards — only legs going INTO the prompt */}
        {promptLegs.map((leg) => {
          const isOpen = !!open[leg.legNumber];
          return (
            <div key={leg.legNumber} className="cc-card" style={{ overflow: "hidden" }}>
              {/* Header row */}
              <button
                onClick={() => setOpen((s) => ({ ...s, [leg.legNumber]: !s[leg.legNumber] }))}
                style={{
                  width: "100%", display: "flex", alignItems: "center", gap: "0.5rem",
                  padding: "0.625rem 0.75rem", background: "transparent", border: 0,
                  borderBottom: isOpen ? "1px solid var(--cc-border)" : "none",
                  cursor: "pointer", textAlign: "left", color: "inherit", fontFamily: "inherit",
                }}
              >
                {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                <span className="cc-meta" style={{ fontSize: "0.625rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  Leg {leg.legNumber}
                </span>
                <span className="mono" style={{ fontWeight: 500 }}>{leg.confNumber}</span>
                <span className="cc-pill cc-pill-muted" style={{ fontSize: "0.625rem" }}>{leg.errorTypeName}</span>
                <span className="cc-meta" style={{ fontSize: "0.6875rem", fontVariantNumeric: "tabular-nums" }}>{leg.amount}</span>
                <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "0.375rem" }}>
                  {leg.instructionLayer.kind === "override" ? (
                    <span className="cc-pill cc-pill-purple"><Settings className="w-3 h-3" />Override</span>
                  ) : (
                    <span className="cc-pill cc-pill-blue">Default</span>
                  )}
                  <span className={`cc-pill cc-pill-${leg.verdict.tone}`}>{leg.verdict.label}</span>
                </span>
              </button>

              {isOpen && (
                <div style={{ padding: "0.75rem", display: "flex", flexDirection: "column", gap: "0.625rem" }}>
                  {/* SOP transcript */}
                  <div>
                    <div style={{ fontSize: "0.6875rem", fontWeight: 600, color: "var(--cc-muted-fg)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.375rem" }}>
                      SOP walk · {leg.sopTranscript.length} questions
                    </div>
                    <ol style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "0.375rem" }}>
                      {leg.sopTranscript.map((qa, i) => (
                        <li key={i} style={{ display: "flex", gap: "0.5rem", fontSize: "0.75rem", lineHeight: 1.45 }}>
                          <span className="cc-meta mono" style={{ minWidth: "1.25rem" }}>Q{i + 1}</span>
                          <span style={{ flex: 1 }}>
                            <span style={{ color: "var(--cc-muted-fg)" }}>{qa.question} </span>
                            <span style={{ fontWeight: 500 }}>→ {qa.answer}</span>
                          </span>
                        </li>
                      ))}
                    </ol>
                    <div style={{ marginTop: "0.375rem", fontSize: "0.6875rem", color: "var(--cc-green-fg)", display: "flex", alignItems: "center", gap: "0.25rem" }}>
                      <CheckCircle2 className="w-3 h-3" /> {leg.sopOutcomeNote}
                    </div>
                  </div>

                  {/* Evidence */}
                  <div>
                    <div style={{ fontSize: "0.6875rem", fontWeight: 600, color: "var(--cc-muted-fg)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.375rem" }}>
                      Evidence in prompt · {leg.evidence.length} file{leg.evidence.length === 1 ? "" : "s"}
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.375rem" }}>
                      {leg.evidence.map((e) => (
                        <span key={e.name} className="cc-pill cc-pill-muted" style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "0.625rem" }}>
                          {evIcon(e.kind)} {e.name}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Per-leg context note */}
                  {leg.contextNote && leg.contextNote !== "—" && (
                    <div>
                      <div style={{ fontSize: "0.6875rem", fontWeight: 600, color: "var(--cc-muted-fg)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.375rem", display: "flex", alignItems: "center", gap: "0.25rem" }}>
                        <StickyNote className="w-3 h-3" /> Per-leg context
                      </div>
                      <div style={{ fontSize: "0.75rem", padding: "0.5rem 0.625rem", background: "var(--cc-amber-bg)", border: "1px solid var(--cc-amber-border)", color: "var(--cc-amber-fg)", borderRadius: "calc(var(--cc-radius) - 2px)", lineHeight: 1.45 }}>
                        {leg.contextNote}
                      </div>
                    </div>
                  )}

                  {/* Writing instructions for this leg */}
                  <div>
                    <div style={{ fontSize: "0.6875rem", fontWeight: 600, color: "var(--cc-muted-fg)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.375rem", display: "flex", alignItems: "center", gap: "0.25rem" }}>
                      <ShieldCheck className="w-3 h-3" /> Writing instructions
                      <span className={`cc-pill ${leg.instructionLayer.kind === "override" ? "cc-pill-purple" : "cc-pill-blue"}`} style={{ marginLeft: "0.25rem" }}>
                        {leg.instructionLayer.label}
                      </span>
                      <button className="cc-btn cc-btn-ghost cc-btn-sm" style={{ marginLeft: "auto" }}>
                        <Eye className="w-3 h-3" /> View full
                      </button>
                    </div>
                    <div style={{ fontSize: "0.75rem", padding: "0.5rem 0.625rem", background: "var(--cc-muted)", borderRadius: "calc(var(--cc-radius) - 2px)", lineHeight: 1.5, color: "var(--cc-muted-fg)" }}>
                      {leg.instructionLayer.preview}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {/* Filtered-out legs */}
        {droppedLegs.length > 0 && (
          <div className="cc-card" style={{ padding: "0.5rem 0.75rem", background: "var(--cc-muted)", borderStyle: "dashed" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.375rem" }}>
              <XCircle className="w-3.5 h-3.5" style={{ color: "var(--cc-muted-fg)" }} />
              <div style={{ fontSize: "0.75rem", fontWeight: 600 }}>Not in prompt · {droppedLegs.length}</div>
              <span className="cc-meta" style={{ marginLeft: "auto", fontSize: "0.6875rem" }}>
                Filtered so the AI doesn't write up uncontestable legs as wins
              </span>
            </div>
            {droppedLegs.map((leg) => (
              <div key={leg.legNumber} style={{ display: "flex", alignItems: "center", gap: "0.5rem", paddingTop: "0.25rem", fontSize: "0.75rem" }}>
                <span className="cc-meta" style={{ fontSize: "0.625rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  Leg {leg.legNumber}
                </span>
                <span className="mono">{leg.confNumber}</span>
                <span className={`cc-pill cc-pill-${leg.verdict.tone}`}>{leg.verdict.label}</span>
                <span className="cc-meta" style={{ fontSize: "0.6875rem", flex: 1, minWidth: 0 }}>{leg.reasonExcluded}</span>
              </div>
            ))}
          </div>
        )}

        {/* CTA */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", paddingTop: "0.25rem" }}>
          <span className="cc-meta" style={{ display: "flex", alignItems: "center", gap: "0.25rem", fontSize: "0.6875rem" }}>
            <AlertTriangle className="w-3 h-3" /> Anything wrong? Open a leg to fix context or evidence.
          </span>
          <button className="cc-btn cc-btn-primary" style={{ marginLeft: "auto" }}>
            <Sparkles className="w-3.5 h-3.5" /> Generate preview
          </button>
        </div>
      </div>
    </WizardShell>
  );
}
