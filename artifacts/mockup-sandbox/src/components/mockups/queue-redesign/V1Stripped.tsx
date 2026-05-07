import {
  HeaderStrip, ClassificationStrip, MasterList, GroupHeaderCard,
  LegRow, SubmissionFooter, FrameLabel, Annotation, legs, Icons,
} from "./_shared";

/**
 * V1 — "Stripped" baseline.
 * Single-column right pane. Accordion legs (one open at a time).
 * Submission footer pinned at the bottom of the right pane regardless
 * of which leg is open. MAS / Activity / Thread live in a slide-over
 * drawer triggered from the group header.
 */
export default function V1Stripped() {
  return (
    <div className="cc-scope" style={{ width: 1280, minHeight: 900 }}>
      <FrameLabel
        tag="V1"
        title="Stripped baseline · single column · pinned footer · drawer"
        principles={["P1", "P2", "P3", "P4", "P5", "P9"]}
      />
      <HeaderStrip />
      <ClassificationStrip count={3} />

      <div style={{ position: "relative", display: "grid", gridTemplateColumns: "320px 1fr", height: 760 }}>
        {/* Master list */}
        <MasterList />

        {/* Right pane — single column, single scroll context */}
        <div style={{ display: "flex", flexDirection: "column", padding: "0.75rem", gap: "0.625rem", position: "relative", overflow: "hidden" }}>
          <GroupHeaderCard
            trailing={
              <div className="flex items-center gap-1">
                <button className="cc-btn cc-btn-sm"><Icons.Activity className="w-3 h-3" /> Activity 11</button>
                <button className="cc-btn cc-btn-sm"><Icons.Bot className="w-3 h-3" /> MAS</button>
              </div>
            }
          />

          <Annotation>
            All ancillary content (Activity, MAS rail, full Thread) opens in the slide-over
            drawer on the right when those header chips are clicked. Closed by default — P3.
          </Annotation>

          {/* Legs accordion — one expanded at a time */}
          <div style={{ display: "flex", flexDirection: "column" }}>
            <LegRow leg={legs[0]} expanded showHint />
            <LegRow leg={legs[1]} />
            <LegRow leg={legs[2]} />
          </div>

          <div style={{ flex: 1 }} />

          {/* Pinned submission footer — never moves */}
          <SubmissionFooter variant="gauntlet" pinned />

          {/* Slide-over drawer (preview, not interactive) */}
          <Drawer />
        </div>
      </div>
    </div>
  );
}

function Drawer() {
  return (
    <div className="cc-drawer">
      <div className="cc-drawer-head">
        <div className="font-semibold text-sm flex items-center gap-2">
          <Icons.Activity className="w-4 h-4" /> Activity &amp; MAS
        </div>
        <button className="cc-btn cc-btn-ghost cc-btn-sm" aria-label="Close"><Icons.X className="w-3.5 h-3.5" /></button>
      </div>
      <div className="cc-drawer-body">
        <div className="cc-tabs">
          <button className="cc-tab cc-tab-active">Activity</button>
          <button className="cc-tab">MAS rail</button>
          <button className="cc-tab">Thread</button>
        </div>
        <ul style={{ marginTop: "0.625rem", display: "flex", flexDirection: "column", gap: "0.5rem", fontSize: "0.75rem", padding: 0, listStyle: "none" }}>
          <li><strong>10:14a</strong> · M. Rivera added Trip Log evidence to C-2026-04812</li>
          <li><strong>09:56a</strong> · System advanced SOP to "GPS log captured"</li>
          <li><strong>Apr 24 4:48p</strong> · M. Rivera moved group to In Dispute</li>
          <li><strong>Apr 24 4:30p</strong> · System imported from INV-2026-0419</li>
        </ul>
      </div>
    </div>
  );
}
