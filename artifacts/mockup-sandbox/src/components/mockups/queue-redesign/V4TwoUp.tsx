import {
  HeaderStrip, ClassificationStrip, SopActiveCard,
  CountsStrip, SubmissionFooter, FrameLabel, Annotation,
  legs, groupSummary, Icons,
} from "./_shared";

/**
 * V4 — "Two-up" variant.
 * Leg list moves out of the right pane and into a horizontal chip
 * row above the workspace. The freed left rail becomes a richer
 * Queue navigator: filters, saved views, urgency buckets. Tests
 * whether the leg list belongs with the group, not the queue.
 */
export default function V4TwoUp() {
  return (
    <div className="cc-scope" style={{ width: 1280, minHeight: 900 }}>
      <FrameLabel
        tag="V4"
        title="Two-up · leg chips above workspace · richer queue navigator on the left"
        principles={["P1", "P5", "P7", "P8", "P9"]}
      />
      <HeaderStrip />
      <ClassificationStrip count={3} />

      <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", height: 760 }}>
        {/* Richer left navigator */}
        <aside style={{ background: "var(--cc-card)", borderRight: "1px solid var(--cc-border)", padding: "0.75rem", display: "flex", flexDirection: "column", gap: "0.875rem" }}>
          <NavSection title="Saved views">
            <NavItem label="My queue" count={42} />
            <NavItem label="High-dollar" count={6} />
            <NavItem label="Awaiting reply" count={4} active />
          </NavSection>
          <NavSection title="Urgency">
            <NavItem label="Due today" count={8} tone="red" />
            <NavItem label="Due tomorrow" count={30} tone="amber" />
            <NavItem label="Next 3 days" count={17} tone="green" />
          </NavSection>
          <NavSection title="Payor">
            <NavItem label="MAS Medicaid" count={28} />
            <NavItem label="Logisticare" count={9} />
            <NavItem label="Verida" count={5} />
          </NavSection>
          <NavSection title="Error type">
            <NavItem label="Mileage" count={12} />
            <NavItem label="Auth window" count={7} />
            <NavItem label="Duplicate" count={4} />
          </NavSection>
        </aside>

        <div style={{ display: "flex", flexDirection: "column", padding: "0.75rem", gap: "0.625rem", overflow: "hidden" }}>
          {/* Group header with leg chips replacing the accordion */}
          <div style={{ background: "var(--cc-card)", border: "1px solid var(--cc-border)", borderRadius: "var(--cc-radius)", padding: "0.625rem 0.875rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            <div className="flex items-center gap-3 flex-wrap">
              <span className="mono font-semibold">{groupSummary.invoice}</span>
              <span className="cc-pill cc-pill-amber">{groupSummary.status}</span>
              <span className="cc-meta text-xs">{groupSummary.payor} · {groupSummary.total}</span>
              <a href="#" className="cc-btn cc-btn-ghost cc-btn-sm ml-auto">Full Details <Icons.ChevronRight className="w-3 h-3" /></a>
            </div>
            <div className="cc-leg-chips">
              <button className="cc-leg-chip cc-leg-chip-active">
                <Icons.Circle className="w-2.5 h-2.5" /> Leg 1 · C-…04812 · $184.50
              </button>
              <button className="cc-leg-chip cc-leg-chip-ready">
                <Icons.CheckCircle2 className="w-2.5 h-2.5" /> Leg 2 · C-…04813 · $612.40 · Ready
              </button>
              <button className="cc-leg-chip">
                <Icons.HelpCircle className="w-2.5 h-2.5" /> Leg 3 · C-…04814 · $605.20 · Needs walk
              </button>
            </div>
          </div>

          <Annotation>
            Leg list lives <strong>with the group</strong>, not the queue (P7).
            Left rail is freed up for filters/views/urgency buckets — the kind of
            navigation operators actually want when they're picking what to work on next.
          </Annotation>

          {/* Active leg workspace */}
          <div className="cc-card" style={{ background: "var(--cc-card)", border: "1px solid var(--cc-border)", borderRadius: "var(--cc-radius)", padding: "0.875rem", flex: 1, display: "flex", flexDirection: "column", gap: "0.625rem" }}>
            <div className="flex items-center gap-2">
              <span className="mono text-[12px] font-semibold">{legs[0].conf}</span>
              <span className="cc-meta text-[11px]">{legs[0].date} · {legs[0].amount}</span>
              <span className="cc-pill cc-pill-blue ml-auto">In progress</span>
            </div>
            <SopActiveCard question={legs[0].question} />
            <CountsStrip evidence={3} notes={1} thread={0} activity={4} />
          </div>

          <SubmissionFooter variant="gauntlet" pinned />
        </div>
      </div>
    </div>
  );
}

function NavSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="cc-meta text-[10px] font-semibold uppercase tracking-wider mb-1">{title}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>{children}</div>
    </div>
  );
}

function NavItem({ label, count, active = false, tone }: { label: string; count: number; active?: boolean; tone?: "red" | "amber" | "green" }) {
  const dot = tone ? <span className={`cc-tier-bar cc-tier-${tone}`} style={{ width: 6, height: 6, borderRadius: 3 }} /> : null;
  return (
    <button
      style={{
        display: "flex", alignItems: "center", gap: 6,
        padding: "0.25rem 0.5rem",
        background: active ? "var(--cc-blue-bg)" : "transparent",
        color: active ? "var(--cc-blue-fg)" : "var(--cc-fg)",
        border: 0, borderRadius: 4, cursor: "pointer",
        fontSize: "0.75rem", textAlign: "left",
      }}
    >
      {dot}
      <span className="flex-1">{label}</span>
      <span className="cc-meta text-[10px]">{count}</span>
    </button>
  );
}
