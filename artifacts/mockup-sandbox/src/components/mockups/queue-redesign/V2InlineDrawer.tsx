import {
  HeaderStrip, ClassificationStrip, MasterList, GroupHeaderCard,
  LegRow, SubmissionFooter, FrameLabel, Annotation, legs, Icons,
} from "./_shared";

/**
 * V2 — "Inline drawer" variant.
 * Same right-pane spine as V1, but ancillary content (MAS, Activity,
 * Thread) lives in a tab strip inside the group header card instead
 * of a slide-over. Tests whether tabs feel lighter than a drawer
 * when the operator wants to glance at history without losing place.
 */
export default function V2InlineDrawer() {
  return (
    <div className="cc-scope" style={{ width: 1280, minHeight: 900 }}>
      <FrameLabel
        tag="V2"
        title="Inline tabs · group header carries Activity/MAS/Thread"
        principles={["P1", "P2", "P3", "P4", "P5"]}
      />
      <HeaderStrip />
      <ClassificationStrip count={3} />

      <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", height: 760 }}>
        <MasterList />

        <div style={{ display: "flex", flexDirection: "column", padding: "0.75rem", gap: "0.625rem", overflow: "hidden" }}>
          <GroupHeaderCard />
          <div className="cc-card" style={{ background: "var(--cc-card)", border: "1px solid var(--cc-border)", borderRadius: "var(--cc-radius)" }}>
            <div className="cc-tabs" style={{ paddingLeft: "0.5rem" }}>
              <button className="cc-tab cc-tab-active">Walk (3)</button>
              <button className="cc-tab">Activity <span className="cc-pill cc-pill-muted" style={{ marginLeft: 4 }}>11</span></button>
              <button className="cc-tab">MAS rail <span className="cc-pill cc-pill-amber" style={{ marginLeft: 4 }}>1 step</span></button>
              <button className="cc-tab">Thread <span className="cc-pill cc-pill-muted" style={{ marginLeft: 4 }}>0</span></button>
            </div>
            <div style={{ padding: "0.625rem" }}>
              <Annotation>
                Tabs replace the slide-over. The Walk tab holds the legs accordion.
                Other tabs swap in over the same column — single scroll context preserved (P2).
              </Annotation>

              <div style={{ marginTop: "0.625rem", display: "flex", flexDirection: "column" }}>
                <LegRow leg={legs[0]} expanded showHint />
                <LegRow leg={legs[1]} />
                <LegRow leg={legs[2]} />
              </div>
            </div>
          </div>

          <div style={{ flex: 1 }} />

          <SubmissionFooter variant="gauntlet" pinned />
        </div>
      </div>
    </div>
  );
}
