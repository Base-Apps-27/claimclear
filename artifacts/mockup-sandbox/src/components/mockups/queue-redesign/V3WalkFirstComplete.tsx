import {
  HeaderStrip, ClassificationStrip, MasterList,
  CountsStrip, FrameLabel, Annotation, legs, groupSummary, Icons,
} from "./_shared";

/**
 * V3 — Walk-first wizard, terminal state.
 * Companion to V3WalkFirst that shows what the wizard looks like once
 * the operator has walked all 3 legs to completion. The segmented
 * switcher turns into a green "all-done" indicator, the hero collapses
 * into a 3-leg verdict summary (every leg visible at once now that
 * none of them needs walking), and the sticky footer flips from
 * "1 of 3 ready" to a Submit-ready gauntlet with the primary CTA live.
 */
export default function V3WalkFirstComplete() {
  const completedLegs = [
    {
      ...legs[0],
      verdict: "Approved — GPS confirmed 14.2 mi for rate code R-12",
      tone: "green" as const,
      walkSummary: "Op confirmed mileage matches GPS export · 3 evidence files attached",
    },
    {
      ...legs[1],
      verdict: "Ready to submit — no dispute needed",
      tone: "green" as const,
      walkSummary: "Auto-marked ready by SOP §4.1 (no exceptions) · 1 evidence file",
    },
    {
      ...legs[2],
      verdict: "Approved after walk — auth window verified",
      tone: "green" as const,
      walkSummary: "Op confirmed prior auth covers Apr 25 · screenshot attached",
    },
  ];

  return (
    <div className="cc-scope" style={{ width: 1280, minHeight: 900 }}>
      <FrameLabel
        tag="V3·done"
        title="Walk-first wizard · terminal state · all 3 legs walked · footer flips to Submit-ready"
        principles={["P1", "P3", "P4", "P5", "P6", "P9"]}
      />
      <HeaderStrip />
      <ClassificationStrip count={0} />

      <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", height: 760 }}>
        <MasterList dense />

        <div style={{ display: "flex", flexDirection: "column", padding: "0.75rem", gap: "0.625rem", overflow: "hidden" }}>
          {/* One-line group summary — segmented switcher now reads as "all done" */}
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
            Terminal state: the wizard's "one question on screen" rule relaxes once
            every leg has a verdict. The hero turns into a verdict summary that
            shows all 3 legs at once — no walking left to do, so no need to hide
            anything. Footer (P4) flips from "1 of 3 ready" to a live Submit CTA
            without moving location.
          </Annotation>

          {/* Hero — verdict summary, all 3 legs visible at once */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "0.625rem", padding: "0 1.25rem", justifyContent: "center" }}>
            <div style={{ maxWidth: 880, margin: "0 auto", width: "100%", display: "flex", flexDirection: "column", gap: "0.625rem" }}>
              <div className="flex items-center gap-2" style={{ marginBottom: "0.25rem" }}>
                <Icons.CheckCircle2 className="w-4 h-4" style={{ color: "var(--cc-green-fg)" }} />
                <span className="font-semibold text-sm">Walk complete · review verdicts</span>
                <span className="cc-meta text-xs ml-auto">3 of 3 legs · $1,402.10 total</span>
              </div>

              {completedLegs.map((leg, i) => (
                <div
                  key={leg.id}
                  className="cc-card"
                  style={{
                    background: "var(--cc-card)",
                    border: "1px solid var(--cc-border)",
                    borderLeft: "3px solid var(--cc-green-fg)",
                    borderRadius: "var(--cc-radius)",
                    padding: "0.625rem 0.875rem",
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.25rem",
                  }}
                >
                  <div className="flex items-center gap-2">
                    <span className="cc-meta text-[10px] font-semibold uppercase tracking-wider">Leg {i + 1}</span>
                    <span className="mono text-[12px] font-semibold">{leg.conf}</span>
                    <span className="cc-meta text-[11px]">{leg.date} · {leg.amount}</span>
                    <span className="cc-pill cc-pill-green ml-auto">
                      <Icons.CheckCircle2 className="w-2.5 h-2.5 inline" /> {leg.verdict}
                    </span>
                  </div>
                  <div className="cc-meta text-[11px]">{leg.walkSummary}</div>
                  <div style={{ marginTop: "0.25rem" }}>
                    <CountsStrip evidence={3} notes={1} thread={0} activity={4} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Sticky footer — same physical slot, but the gauntlet has advanced */}
          <div className="cc-footer-card cc-footer-pinned" style={{ padding: "0.5rem 0.875rem" }}>
            <span className="cc-pill cc-pill-green">3 of 3 ready</span>
            <span className="cc-meta text-xs flex-1">All legs walked · preview ready to generate · then submit to MAS portal.</span>
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
