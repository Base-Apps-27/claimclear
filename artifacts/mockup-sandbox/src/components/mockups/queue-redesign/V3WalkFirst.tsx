import {
  HeaderStrip, ClassificationStrip, MasterList, SopActiveCard,
  CountsStrip, FrameLabel, Annotation, legs, groupSummary, Icons,
} from "./_shared";

/**
 * V3 — "Walk-first" wizard.
 * The right pane becomes a wizard. Only the active leg's current SOP
 * question is on screen — leg navigation is a thin segmented control
 * at the top, group metadata collapses to a single sticky bar, and
 * the submission footer is a one-line bar that grows when ready.
 * Most aggressive variant — tests how much chrome can disappear
 * before context is lost.
 */
export default function V3WalkFirst() {
  return (
    <div className="cc-scope" style={{ width: 1280, minHeight: 900 }}>
      <FrameLabel
        tag="V3"
        title="Walk-first wizard · one question, segmented leg switcher, single sticky footer"
        principles={["P1", "P3", "P5", "P6", "P9"]}
      />
      <HeaderStrip />
      <ClassificationStrip count={3} />

      <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", height: 760 }}>
        <MasterList dense />

        <div style={{ display: "flex", flexDirection: "column", padding: "0.75rem", gap: "0.625rem", overflow: "hidden" }}>
          {/* One-line group summary — replaces the group header card */}
          <div style={{ display: "flex", alignItems: "center", gap: "0.625rem", padding: "0.5rem 0.75rem", background: "var(--cc-card)", border: "1px solid var(--cc-border)", borderRadius: "var(--cc-radius)" }}>
            <span className="mono text-[12px] font-semibold">{groupSummary.invoice}</span>
            <span className="cc-meta text-[11px]">{groupSummary.payor} · {groupSummary.total}</span>
            <div className="cc-segmented" style={{ marginLeft: "auto" }}>
              <button className="is-active">Leg 1 <Icons.Circle className="w-2.5 h-2.5 inline ml-1" /></button>
              <button>Leg 2 <Icons.CheckCircle2 className="w-2.5 h-2.5 inline ml-1" /></button>
              <button>Leg 3 <Icons.HelpCircle className="w-2.5 h-2.5 inline ml-1" /></button>
            </div>
          </div>

          <Annotation>
            Wizard layout: only the active leg's current SOP step is on screen.
            Switching legs is a segmented control above. No accordion, no
            stacked workstations (P5). Activity/MAS/Thread off-screen by default (P3).
          </Annotation>

          {/* Hero — the active SOP step is the page */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "0.625rem", justifyContent: "center", padding: "0 2rem" }}>
            <div style={{ maxWidth: 720, margin: "0 auto", width: "100%" }}>
              <div className="cc-meta text-[11px] mb-2">
                <span className="mono">{legs[0].conf}</span> · {legs[0].date} · {legs[0].amount}
              </div>
              <SopActiveCard question={legs[0].question} />
              <div style={{ marginTop: "0.75rem" }}>
                <CountsStrip evidence={3} notes={1} thread={0} activity={4} />
              </div>
            </div>
          </div>

          {/* Sticky footer — collapses to one line until ready */}
          <div className="cc-footer-card cc-footer-pinned" style={{ padding: "0.5rem 0.875rem" }}>
            <span className="cc-pill cc-pill-amber">1 of 3 ready</span>
            <span className="cc-meta text-xs flex-1">Resolve all 3 legs to unlock Generate preview · then Submit.</span>
            <div className="cc-gauntlet-row" style={{ margin: 0 }}>
              <span className="cc-gauntlet-step cc-gauntlet-active">Walk legs</span>
              <span className="cc-gauntlet-step">Preview</span>
              <span className="cc-gauntlet-step">Review</span>
              <span className="cc-gauntlet-step">Submit</span>
            </div>
            <button className="cc-btn cc-btn-primary" disabled><Icons.Send className="w-3.5 h-3.5" /> Submit</button>
          </div>
        </div>
      </div>
    </div>
  );
}
