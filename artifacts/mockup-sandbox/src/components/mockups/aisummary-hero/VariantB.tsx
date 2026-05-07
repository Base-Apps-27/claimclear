import "./_group.css";
import { Sparkles, Quote, Settings, ShieldCheck, Paperclip, ArrowRight } from "lucide-react";
import { WizardShell, legs, promptLegs, droppedLegs } from "./_shared";

// VARIANT B — Conversational digest
// Hypothesis: many operators don't read structured grids. A short narrative
// summary that mirrors how the operator would describe the package out loud
// reads faster and surfaces the same per-leg facts in human prose. The
// instruction-layer note is a single sentence callout, not a chip strip.

export function VariantB() {
  const overrideCount = promptLegs.filter((l) => l.instructionLayer.kind === "override").length;

  return (
    <WizardShell helper="Read the briefing, then generate the preview.">
      <div style={{ display: "flex", flexDirection: "column", gap: "0.625rem" }}>
        {/* Hero header */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <Sparkles className="w-4 h-4" style={{ color: "var(--cc-primary)" }} />
          <div style={{ fontWeight: 600, fontSize: "0.875rem" }}>Briefing for the AI</div>
          <span className="cc-meta" style={{ marginLeft: "auto" }}>{promptLegs.length} legs in prompt · {droppedLegs.length} filtered out</span>
        </div>

        {/* The briefing card — narrative form */}
        <div className="cc-card" style={{ padding: "0.875rem 1rem", lineHeight: 1.65, fontSize: "0.8125rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.375rem", marginBottom: "0.5rem", color: "var(--cc-muted-fg)", fontSize: "0.6875rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>
            <Quote className="w-3 h-3" /> What the AI will see
          </div>

          <p style={{ margin: 0, marginBottom: "0.625rem" }}>
            We're disputing <b>{promptLegs.length} of {legs.length} legs</b> on{" "}
            <span className="mono" style={{ fontWeight: 600 }}>INV-2026-04812</span>.{" "}
            {droppedLegs.length > 0 && (
              <>
                <b>Leg {droppedLegs[0].legNumber}</b> ({droppedLegs[0].confNumber}) is non-contestable
                ({droppedLegs[0].errorTypeName.toLowerCase()}) and is being filtered out so the AI doesn't
                write it up as a win.
              </>
            )}
          </p>

          {promptLegs.map((leg, i) => (
            <p key={leg.legNumber} style={{ margin: 0, marginBottom: i === promptLegs.length - 1 ? 0 : "0.625rem" }}>
              <b>Leg {leg.legNumber}</b> · <span className="mono">{leg.confNumber}</span> · {leg.amount} —{" "}
              classified as <span className="cc-pill cc-pill-muted" style={{ fontSize: "0.625rem" }}>{leg.errorTypeName}</span>,
              walked through {leg.sopTranscript.length} SOP questions ending in{" "}
              <i>"{leg.sopOutcomeNote.replace(/^Terminal: /, "").replace(/\.$/, "")}"</i>.{" "}
              {leg.contextNote && leg.contextNote !== "—" && (
                <>The operator added: <i>"{leg.contextNote}"</i> </>
              )}
              The AI will receive {leg.evidence.length} attached file{leg.evidence.length === 1 ? "" : "s"} (
              {leg.evidence.map((e) => (
                <span key={e.name} className="mono" style={{ fontSize: "0.6875rem" }}>{e.name}</span>
              )).reduce((acc: React.ReactNode[], el, idx) => {
                if (idx > 0) acc.push(<span key={`sep-${idx}`}>, </span>);
                acc.push(el);
                return acc;
              }, [])}
              ) and will follow{" "}
              <b>{leg.instructionLayer.kind === "override" ? "the custom GPS-Deviation instructions" : "the default dispute instructions"}</b>.
            </p>
          ))}
        </div>

        {/* Instruction layer callout */}
        <div className="cc-card" style={{ padding: "0.625rem 0.75rem", display: "flex", alignItems: "flex-start", gap: "0.5rem", background: "var(--cc-blue-bg)", border: "1px solid var(--cc-blue-border)" }}>
          <ShieldCheck className="w-4 h-4" style={{ color: "var(--cc-blue-fg)", marginTop: "0.0625rem", flexShrink: 0 }} />
          <div style={{ flex: 1, fontSize: "0.75rem", color: "var(--cc-blue-fg)", lineHeight: 1.5 }}>
            <b>Instructions in use:</b> default for {promptLegs.length - overrideCount} leg
            {overrideCount > 0 && <>, plus a custom override for the GPS-Deviation leg</>}.
            The AI will keep to your house style — short paragraphs, factual citations, no speculation.
          </div>
          <button className="cc-btn cc-btn-ghost cc-btn-sm" style={{ flexShrink: 0 }}>
            <Settings className="w-3 h-3" /> Manage
          </button>
        </div>

        {/* Tiny per-leg evidence summary so it's scannable too */}
        <div className="cc-card" style={{ padding: "0.5rem 0.75rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.375rem", marginBottom: "0.375rem", color: "var(--cc-muted-fg)", fontSize: "0.6875rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>
            <Paperclip className="w-3 h-3" /> Attachments going in
          </div>
          {promptLegs.map((leg) => (
            <div key={leg.legNumber} style={{ display: "flex", alignItems: "baseline", gap: "0.5rem", fontSize: "0.75rem", paddingTop: "0.25rem" }}>
              <span className="cc-meta" style={{ fontSize: "0.625rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", minWidth: "2.5rem" }}>Leg {leg.legNumber}</span>
              <span className="mono" style={{ fontSize: "0.6875rem", color: "var(--cc-muted-fg)" }}>
                {leg.evidence.map((e) => e.name).join(", ")}
              </span>
            </div>
          ))}
        </div>

        {/* CTA */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", paddingTop: "0.25rem" }}>
          <span className="cc-meta" style={{ fontSize: "0.6875rem" }}>
            Anything off? Re-open a leg before generating.
          </span>
          <button className="cc-btn cc-btn-primary" style={{ marginLeft: "auto" }}>
            <Sparkles className="w-3.5 h-3.5" /> Generate preview <ArrowRight className="w-3 h-3" />
          </button>
        </div>
      </div>
    </WizardShell>
  );
}
