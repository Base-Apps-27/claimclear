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
 * Round 3 · Q2 — In-context "AI Inputs Summary" hero, with one leg expanded.
 * Same compact rows as Q1, but each row has a chevron — clicking opens an
 * inline body showing the SOP transcript, evidence chips, and the operator's
 * per-leg context note. Demonstrated state: Leg 1 expanded, Legs 2/3 collapsed.
 * This is the "trust but verify" pattern — the operator can crack open any leg
 * to see exactly what the AI will read for it.
 */
export default function Q2() {
  return (
    <div className="cc-scope" style={{ width: 1280, minHeight: 900 }}>
      <FrameLabel
        tag="V3·Q2"
        title="Walk-complete hero · AI Inputs Summary · expand-to-inspect (PRE-generate)"
        principles={["P1", "P3", "P4", "P5", "P9"]}
      />
      <HeaderStrip />
      <ClassificationStrip count={0} />

      <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", height: 760 }}>
        <MasterList dense />

        <div style={{ display: "flex", flexDirection: "column", padding: "0.75rem", gap: "0.625rem", overflow: "hidden" }}>
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
            Each leg can be expanded inline to show the SOP walk, evidence files, and the operator's
            context note — exactly the substring of the prompt the AI will see for that leg. Leg 1 is
            shown open below for demonstration.
          </Annotation>

          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "0.625rem", padding: "0 1.25rem", overflow: "auto" }}>
            <div style={{ maxWidth: 880, margin: "0 auto", width: "100%", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              <div className="flex items-center gap-2" style={{ marginBottom: "0.125rem" }}>
                <Icons.Sparkles className="w-4 h-4" style={{ color: "var(--cc-blue-fg)" }} />
                <span className="font-semibold text-sm">What the AI will see · 3 of 3 legs walked</span>
                <span className="cc-meta text-xs ml-auto">2 in prompt · 1 filtered · 1 custom override</span>
              </div>

              {/* Leg 1 — expanded */}
              <div className="cc-leg-row cc-leg-row-expanded" style={{ borderLeft: "3px solid var(--cc-green-fg)" }}>
                <div className="cc-leg-row-head" style={{ cursor: "default" }}>
                  <Icons.ChevronDown className="w-3.5 h-3.5 cc-leg-chev" />
                  <span className="cc-meta text-[10px] font-semibold uppercase tracking-wider">Leg 1</span>
                  <span className="mono text-[12px] font-medium">{legs[0].conf}</span>
                  <span className="cc-meta text-[11px]">{legs[0].date} · {legs[0].amount}</span>
                  <span className="cc-tag" style={{ marginLeft: "0.25rem" }}>Time at Facility</span>
                  <span className="cc-pill cc-pill-green ml-auto">
                    <Icons.CheckCircle2 className="w-2.5 h-2.5 inline" /> Ready · Disputable
                  </span>
                  <span className="cc-pill cc-pill-muted">Default phrasing</span>
                </div>
                <div className="cc-leg-row-body" style={{ gap: "0.5rem" }}>
                  <div>
                    <div className="cc-meta text-[10px] uppercase tracking-wider font-semibold" style={{ marginBottom: "0.25rem" }}>SOP walk · 4 of 4</div>
                    <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "0.2rem" }}>
                      {[
                        ["Was the rider on dialysis or appointment time?", "Yes — appointment per facility log"],
                        ["Did the facility document the rider's actual release time?", "Yes — 14:42 on signed sheet"],
                        ["Is the documented time after the scheduled pickup?", "Yes — pickup scheduled 14:15"],
                        ["Is the gap > 15 minutes?", "Yes — 27 minutes"],
                      ].map(([q, a], i) => (
                        <li key={i} style={{ display: "flex", gap: "0.4rem", fontSize: "0.75rem", lineHeight: 1.35 }}>
                          <Icons.CheckCircle2 className="w-3 h-3" style={{ color: "var(--cc-green-fg)", marginTop: 2, flexShrink: 0 }} />
                          <span className="cc-meta">{q}</span>
                          <span style={{ marginLeft: "auto", textAlign: "right", fontWeight: 500 }}>{a}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="flex items-center gap-1 flex-wrap">
                    <span className="cc-meta text-[10px] uppercase tracking-wider font-semibold" style={{ marginRight: "0.25rem" }}>Evidence</span>
                    {["facility-release-sheet.pdf", "gps-trace-04812.json", "driver-log-04-24.txt"].map((f) => (
                      <span key={f} className="cc-count-pill" style={{ cursor: "default" }}>
                        <Icons.Paperclip className="w-3 h-3" />
                        <span className="mono text-[11px]">{f}</span>
                      </span>
                    ))}
                  </div>
                  <div className="cc-meta text-[11px]" style={{ fontStyle: "italic", borderTop: "1px dashed var(--cc-border)", paddingTop: "0.4rem" }}>
                    <strong>Op note:</strong> Driver waited curbside from 14:18; facility intake desk confirmed delay.
                  </div>
                </div>
              </div>

              {/* Leg 2 — collapsed, filtered */}
              <div className="cc-leg-row" style={{ borderLeft: "3px solid var(--cc-amber-fg)", opacity: 0.78 }}>
                <div className="cc-leg-row-head" style={{ cursor: "default" }}>
                  <Icons.ChevronRight className="w-3.5 h-3.5 cc-leg-chev" />
                  <span className="cc-meta text-[10px] font-semibold uppercase tracking-wider">Leg 2</span>
                  <span className="mono text-[12px] font-medium">{legs[1].conf}</span>
                  <span className="cc-meta text-[11px]">{legs[1].date} · {legs[1].amount}</span>
                  <span className="cc-tag" style={{ marginLeft: "0.25rem" }}>Driver No-Show</span>
                  <span className="cc-pill cc-pill-amber ml-auto">
                    <Icons.AlertTriangle className="w-2.5 h-2.5 inline" /> Non-contestable · will cancel
                  </span>
                  <span className="cc-pill cc-pill-amber">Not in prompt</span>
                </div>
              </div>

              {/* Leg 3 — collapsed, custom override */}
              <div className="cc-leg-row" style={{ borderLeft: "3px solid var(--cc-green-fg)" }}>
                <div className="cc-leg-row-head" style={{ cursor: "default" }}>
                  <Icons.ChevronRight className="w-3.5 h-3.5 cc-leg-chev" />
                  <span className="cc-meta text-[10px] font-semibold uppercase tracking-wider">Leg 3</span>
                  <span className="mono text-[12px] font-medium">{legs[2].conf}</span>
                  <span className="cc-meta text-[11px]">{legs[2].date} · {legs[2].amount}</span>
                  <span className="cc-tag" style={{ marginLeft: "0.25rem" }}>GPS Deviation</span>
                  <span className="cc-pill cc-pill-green ml-auto">
                    <Icons.CheckCircle2 className="w-2.5 h-2.5 inline" /> Ready · Disputable
                  </span>
                  <span className="cc-pill" style={{ background: "var(--cc-purple-bg)", color: "var(--cc-purple-fg)", borderColor: "var(--cc-purple-bg)" }}>
                    Custom phrasing
                  </span>
                </div>
              </div>

              <Annotation>
                <strong>How this will be written:</strong>{" "}
                2 dispute paragraphs from the contestable legs. Leg 3 uses your custom GPS-Deviation
                override — lead with the closure source, state the mileage delta, no driver-intent speculation.
              </Annotation>
            </div>
          </div>

          <div className="cc-footer-card cc-footer-pinned" style={{ padding: "0.5rem 0.875rem" }}>
            <span className="cc-pill cc-pill-blue">Inputs ready</span>
            <span className="cc-meta text-xs flex-1">Expand any leg to verify what the AI will read.</span>
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
