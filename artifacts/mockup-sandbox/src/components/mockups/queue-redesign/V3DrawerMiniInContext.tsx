import "./_queue.css";
import {
  HeaderStrip, ClassificationStrip, MasterList, SopActiveCard,
  legs, groupSummary, Icons,
} from "./_shared";
import V3DrawerMini from "./V3DrawerMini";

/**
 * V3 Mini drawer — IN CONTEXT.
 *
 * Renders the active leg's wizard page (same shell as V3WalkFirst)
 * with the Mini single-section drawer overlaid as a right-hand
 * sheet, opened by clicking one of the counts-strip chips.
 *
 * The chip the user clicked is shown as visually pressed underneath
 * the sheet — proving the chips remain on the page (not duplicated
 * inside the drawer) and act as the primary section switcher.
 *
 * Renders 4 variants by passing `section`:
 *   evidence · notes · comms · activity
 */

type Section = "evidence" | "notes" | "comms" | "activity";

const chipMeta: Record<Section, { label: string; n: number; icon: any }> = {
  evidence: { label: "Evidence", n: 4,  icon: Icons.Paperclip },
  notes:    { label: "Notes",    n: 2,  icon: Icons.StickyNote },
  comms:    { label: "Comms",    n: 1,  icon: Icons.MessageSquare },
  activity: { label: "Activity", n: 11, icon: Icons.Activity },
};

export default function V3DrawerMiniInContext({
  section = "evidence",
}: { section?: Section }) {
  return (
    <div
      className="cc-scope"
      style={{ width: 1280, minHeight: 900, position: "relative", background: "var(--cc-bg)" }}
    >
      {/* ── Underlying queue page (same shell as V3WalkFirst) ── */}
      <HeaderStrip />
      <ClassificationStrip count={3} />

      <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", height: 760 }}>
        <MasterList dense />

        <div style={{ display: "flex", flexDirection: "column", padding: "0.75rem", gap: "0.625rem", overflow: "hidden" }}>
          {/* Group summary bar */}
          <div style={{
            display: "flex", alignItems: "center", gap: "0.625rem",
            padding: "0.5rem 0.75rem",
            background: "var(--cc-card)", border: "1px solid var(--cc-border)",
            borderRadius: "var(--cc-radius)",
          }}>
            <span className="mono text-[12px] font-semibold">{groupSummary.invoice}</span>
            <span className="cc-meta text-[11px]">{groupSummary.payor} · {groupSummary.total}</span>
            <div className="cc-segmented" style={{ marginLeft: "auto" }}>
              <button className="is-active">Leg 1 <Icons.Circle className="w-2.5 h-2.5 inline ml-1" /></button>
              <button>Leg 2 <Icons.CheckCircle2 className="w-2.5 h-2.5 inline ml-1" /></button>
              <button>Leg 3 <Icons.HelpCircle className="w-2.5 h-2.5 inline ml-1" /></button>
            </div>
          </div>

          {/* Hero — active SOP step + the persistent chips */}
          <div style={{
            flex: 1, display: "flex", flexDirection: "column",
            gap: "0.625rem", justifyContent: "center", padding: "0 2rem",
          }}>
            <div style={{ maxWidth: 720, margin: "0 auto", width: "100%" }}>
              <div className="cc-meta text-[11px] mb-2">
                <span className="mono">{legs[0].conf}</span> · {legs[0].date} · {legs[0].amount}
              </div>
              <SopActiveCard question={legs[0].question} />

              {/* Persistent chips (v3-walk-counts-strip in the real app).
                  The clicked chip is shown pressed to make the link
                  between page chip and overlaid sheet obvious. */}
              <div style={{ marginTop: "0.75rem" }}>
                <ChipsStrip active={section} />
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="cc-footer-card cc-footer-pinned" style={{ padding: "0.5rem 0.875rem" }}>
            <span className="cc-pill cc-pill-amber">1 of 3 ready</span>
            <span className="cc-meta text-xs flex-1">Resolve all 3 legs to unlock Generate preview · then Submit.</span>
            <button className="cc-btn cc-btn-primary" disabled>
              <Icons.Send className="w-3.5 h-3.5" /> Submit
            </button>
          </div>
        </div>
      </div>

      {/* ── Sheet scrim ── */}
      <div style={{
        position: "absolute", inset: 0, background: "rgba(15,23,42,0.32)",
        pointerEvents: "none",
      }} />

      {/* ── Mini drawer mounted as a right-side sheet ── */}
      <div style={{
        position: "absolute", top: 0, right: 0, bottom: 0,
        width: 672, background: "var(--cc-card)",
        boxShadow: "-12px 0 32px rgba(15,23,42,0.18)",
        borderLeft: "1px solid var(--cc-border)",
        overflow: "auto",
      }}>
        <V3DrawerMini initialSection={section} />
      </div>
    </div>
  );
}

/* ── Chips strip showing the active chip pressed ─────────────────────── */

function ChipsStrip({ active }: { active: Section }) {
  const items: { key: Section }[] = [
    { key: "evidence" }, { key: "notes" }, { key: "comms" }, { key: "activity" },
  ];
  return (
    <div style={{ display: "flex", gap: "0.375rem", flexWrap: "wrap" }}
         data-testid="v3-walk-counts-strip">
      {items.map(({ key }) => {
        const m = chipMeta[key];
        const I = m.icon;
        const on = key === active;
        return (
          <span
            key={key}
            className={`cc-pill ${on ? "cc-pill-blue" : "cc-pill-muted"}`}
            style={on ? { boxShadow: "inset 0 0 0 1.5px var(--cc-blue-fg)" } : undefined}
          >
            <I className="w-3 h-3" />
            {m.label}{key !== "comms" ? ` · ${m.n}` : ""}
          </span>
        );
      })}
    </div>
  );
}
