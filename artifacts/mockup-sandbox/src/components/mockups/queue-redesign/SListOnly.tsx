import { HeaderStrip, ClassificationStrip, MasterList, FrameLabel, Annotation, Icons } from "./_shared";

/**
 * State — List-only (no group selected).
 * Operator just landed. The right pane is intentionally a "pick a row"
 * affordance, not a hidden Process Invoice Group card. Hero collapsed
 * to a single chip strip; classification inbox is a one-line strip; the
 * left list is the spine (P7).
 */
export default function SListOnly() {
  return (
    <div className="cc-scope" style={{ width: 1280, minHeight: 760 }}>
      <FrameLabel
        tag="STATE B"
        title="List-only · no group selected · right pane is a 'pick a row' affordance"
        principles={["P1", "P6", "P7", "P8", "P9"]}
      />
      <HeaderStrip />
      <ClassificationStrip count={3} />

      <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", height: 600 }}>
        <MasterList />

        <div style={{ display: "flex", flexDirection: "column", padding: "2rem", gap: "1rem", alignItems: "center", justifyContent: "center", textAlign: "center" }}>
          <Annotation tone="muted">
            No group is selected. Per P9, the right pane does NOT render an
            empty workstation shell. It tells the operator what to do next.
          </Annotation>
          <div style={{ width: 56, height: 56, borderRadius: 9999, background: "var(--cc-blue-bg)", display: "inline-flex", alignItems: "center", justifyContent: "center", color: "var(--cc-blue-fg)" }}>
            <Icons.ArrowLeft className="w-6 h-6" />
          </div>
          <div style={{ maxWidth: 420, display: "flex", flexDirection: "column", gap: "0.375rem" }}>
            <div className="font-semibold text-base">Pick an invoice from the queue</div>
            <div className="cc-meta text-sm">
              The list on the left is sorted by deadline within urgency tier.
              The colored bar at the start of each row shows urgency at a glance —
              red today, amber tomorrow, green within the week.
            </div>
          </div>
          <div style={{ display: "flex", gap: "0.375rem", marginTop: "0.5rem" }}>
            <button className="cc-btn cc-btn-sm">Jump to first red <Icons.ArrowRight className="w-3 h-3" /></button>
            <button className="cc-btn cc-btn-sm">Resume last group</button>
            <button className="cc-btn cc-btn-sm cc-btn-ghost">Keyboard ↓ ↓ ↵</button>
          </div>
        </div>
      </div>
    </div>
  );
}
