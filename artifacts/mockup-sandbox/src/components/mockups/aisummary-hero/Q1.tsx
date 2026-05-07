import {
  HeaderStrip,
  ClassificationStrip,
  MasterList,
  FrameLabel,
  Annotation,
  groupSummary,
  legs,
  Icons,
} from "../queue-redesign/_shared";

/**
 * Round 3 · Q1 — In-context "AI Inputs Summary" hero.
 * Lives where today's WalkCompleteHero lives (right pane of the V3 wizard).
 * PRE-generate state: 3 compact verdict rows, each with a second line that
 * surfaces the SOP terminal outcome + evidence count + which writing-instruction
 * layer applies + whether the leg is in-prompt or filtered. Single one-line
 * "How this gets written" callout below the list. Same Generate CTA in footer.
 */
export default function Q1() {
  return (
    <div className="cc-scope" style={{ width: 1280, minHeight: 900 }}>
      <FrameLabel
        tag="V3·Q1"
        title="Walk-complete hero · AI Inputs Summary · compact rows (PRE-generate)"
        principles={["P1", "P3", "P4", "P5", "P9"]}
      />
      <HeaderStrip />
      <ClassificationStrip count={0} />

      <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", height: 760 }}>
        <MasterList dense />

        <div style={{ display: "flex", flexDirection: "column", padding: "0.75rem", gap: "0.625rem", overflow: "hidden" }}>
          {/* Group bar — same as today */}
          <div style={{ display: "flex", alignItems: "center", gap: "0.625rem", padding: "0.5rem 0.75rem", background: "var(--cc-card)", border: "1px solid var(--cc-border)", borderRadius: "var(--cc-radius)" }}>
            <span className="mono text-[12px] font-semibold">{groupSummary.invoice}</span>
            <span className="cc-meta text-[11px]">{groupSummary.payor} · {groupSummary.total}</span>
            <span className="cc-pill cc-pill-green" style={{ marginLeft: "0.5rem" }}>
              <Icons.CheckCircle2 className="w-3 h-3 inline" /> All 3 legs walked
            </span>
            <div className="cc-segmented" style={{ marginLeft: "auto" }}>
              <button><Icons.CheckCircle2 className="w-2.5 h-2.5 inline mr-1" />Leg 1</button>
              <button><Icons.CheckCircle2 className="w-2.5 h-2.5 inline mr-1" />Leg 2</button>
              <button><Icons.CheckCircle2 className="w-2.5 h-2.5 inline mr-1" />Leg 3</button>
            </div>
          </div>

          <Annotation tone="muted">
            Same hero slot as today's "Walk complete · review verdicts." Each leg row is now a two-liner —
            first line is the verdict, second line tells you what the AI will see for that leg (or that it
            won't see this leg at all). One-line callout below summarizes the writing rules in play.
          </Annotation>

          {/* Hero — verdict + AI-inputs rows */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "0.625rem", padding: "0 1.25rem", overflow: "auto" }}>
            <div style={{ maxWidth: 880, margin: "0 auto", width: "100%", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              <div className="flex items-center gap-2" style={{ marginBottom: "0.125rem" }}>
                <Icons.Sparkles className="w-4 h-4" style={{ color: "var(--cc-blue-fg)" }} />
                <span className="font-semibold text-sm">What the AI will see · 3 of 3 legs walked</span>
                <span className="cc-meta text-xs ml-auto">2 in prompt · 1 filtered · 1 custom override</span>
              </div>

              {/* Leg 1 — contestable, default */}
              <LegRow
                n={1}
                conf={legs[0].conf}
                date={legs[0].date}
                amount={legs[0].amount}
                tone="green"
                verdict="Ready · Time at Facility"
                summary="SOP terminal: Disputable — facility-caused delay (4 of 4 yes)."
                evidenceCount={3}
                layer="default"
              />

              {/* Leg 2 — non-contestable, filtered */}
              <LegRow
                n={2}
                conf={legs[1].conf}
                date={legs[1].date}
                amount={legs[1].amount}
                tone="amber"
                verdict="Non-contestable · will cancel"
                summary="Driver signed missed-pickup log on-site — AI never sees this leg, so it can't be claimed as a win."
                evidenceCount={1}
                filtered
              />

              {/* Leg 3 — contestable, custom override */}
              <LegRow
                n={3}
                conf={legs[2].conf}
                date={legs[2].date}
                amount={legs[2].amount}
                tone="green"
                verdict="Ready · GPS Deviation"
                summary="SOP terminal: Disputable — documented construction detour (DOT closure attached)."
                evidenceCount={2}
                layer="override"
              />

              {/* Processing-note callout */}
              <Annotation>
                <strong>How this will be written:</strong>{" "}
                2 dispute paragraphs from the contestable legs above. Leg 1 uses the default Time-at-Facility phrasing.
                Leg 3 uses your custom GPS-Deviation override (lead with closure source, no driver-intent speculation).
              </Annotation>
            </div>
          </div>

          {/* Sticky footer — pinned, gauntlet at Preview */}
          <div className="cc-footer-card cc-footer-pinned" style={{ padding: "0.5rem 0.875rem" }}>
            <span className="cc-pill cc-pill-blue">Inputs ready</span>
            <span className="cc-meta text-xs flex-1">Review the inputs above, then generate the dispute draft.</span>
            <div className="cc-gauntlet-row" style={{ margin: 0 }}>
              <span className="cc-gauntlet-step cc-gauntlet-done"><Icons.CheckCircle2 className="w-3 h-3" /> Walk legs</span>
              <span className="cc-gauntlet-step cc-gauntlet-active"><Icons.Sparkles className="w-3 h-3" /> Preview</span>
              <span className="cc-gauntlet-step">Review</span>
              <span className="cc-gauntlet-step"><Icons.Send className="w-3 h-3" /> Submit</span>
            </div>
            <button className="cc-btn cc-btn-primary"><Icons.Sparkles className="w-3.5 h-3.5" /> Generate preview</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function LegRow({
  n, conf, date, amount, tone, verdict, summary, evidenceCount, layer, filtered,
}: {
  n: number; conf: string; date: string; amount: string;
  tone: "green" | "amber"; verdict: string; summary: string;
  evidenceCount: number; layer?: "default" | "override"; filtered?: boolean;
}) {
  const accent = tone === "green" ? "var(--cc-green-fg)" : "var(--cc-amber-fg)";
  return (
    <div
      className="cc-card"
      style={{
        background: "var(--cc-card)",
        border: "1px solid var(--cc-border)",
        borderLeft: `3px solid ${accent}`,
        borderRadius: "var(--cc-radius)",
        padding: "0.5rem 0.75rem",
        display: "flex",
        flexDirection: "column",
        gap: "0.25rem",
        opacity: filtered ? 0.78 : 1,
      }}
    >
      <div className="flex items-center gap-2">
        <span className="cc-meta text-[10px] font-semibold uppercase tracking-wider">Leg {n}</span>
        <span className="mono text-[12px] font-semibold">{conf}</span>
        <span className="cc-meta text-[11px]">{date} · {amount}</span>
        <span className={`cc-pill cc-pill-${tone} ml-auto`}>
          {tone === "green" ? <Icons.CheckCircle2 className="w-2.5 h-2.5 inline" /> : <Icons.AlertTriangle className="w-2.5 h-2.5 inline" />}
          {" "}{verdict}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <span className="cc-meta text-[11px] flex-1">{summary}</span>
        <span className="cc-count-pill" style={{ cursor: "default" }}>
          <Icons.Paperclip className="w-3 h-3" />
          <span>Evidence</span>
          <span className="cc-count-n">{evidenceCount}</span>
        </span>
        {filtered ? (
          <span className="cc-pill cc-pill-amber">Not in prompt</span>
        ) : layer === "override" ? (
          <span className="cc-pill" style={{ background: "var(--cc-purple-bg)", color: "var(--cc-purple-fg)", borderColor: "var(--cc-purple-bg)" }}>
            Custom phrasing
          </span>
        ) : (
          <span className="cc-pill cc-pill-muted">Default phrasing</span>
        )}
      </div>
    </div>
  );
}
