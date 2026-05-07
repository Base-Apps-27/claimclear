import { HeaderStrip, ClassificationStrip, FrameLabel, Annotation, Icons } from "./_shared";

/**
 * State — Empty queue.
 * Nothing to do. The hero collapses to a one-line confirmation, the
 * Classification Inbox shows "all caught up", and the right pane
 * stops pretending to be a workspace — it shows what the operator
 * could do instead (saved views, recent invoices, training).
 */
export default function SEmpty() {
  return (
    <div className="cc-scope" style={{ width: 1280, minHeight: 760 }}>
      <FrameLabel
        tag="STATE A"
        title="Empty queue · nothing to do · no fake workspace"
        principles={["P1", "P3", "P6", "P9"]}
      />
      <HeaderStrip />
      <ClassificationStrip count={0} />

      <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", height: 600 }}>
        {/* Empty list */}
        <div style={{ background: "var(--cc-card)", borderRight: "1px solid var(--cc-border)", padding: "1.5rem 1rem", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", gap: "0.5rem" }}>
          <Icons.CheckCircle2 className="w-8 h-8" style={{ color: "var(--cc-green-fg)" }} />
          <div className="font-semibold text-sm">Queue is clear</div>
          <div className="cc-meta text-xs">No invoices need action right now. New work will land here as it comes in.</div>
        </div>

        {/* Right pane intentionally NOT a workspace */}
        <div style={{ display: "flex", flexDirection: "column", padding: "1.5rem 2rem", gap: "1rem" }}>
          <Annotation>
            Per P9 (ruthless removal): when there's nothing to walk, the right pane
            does NOT render an empty Process Invoice Group card with placeholder
            chrome. It becomes a quiet next-thing surface — recent activity, saved
            views, training links. No fake workspace.
          </Annotation>

          <div className="cc-card" style={{ background: "var(--cc-card)", border: "1px solid var(--cc-border)", borderRadius: "var(--cc-radius)", padding: "1rem", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            <div className="font-semibold text-sm">Up next</div>
            <Row icon={<Icons.Clock className="w-3.5 h-3.5" />} label="30 invoices due tomorrow" sub="Currently filtered out by Past-deadline: off" />
            <Row icon={<Icons.Send className="w-3.5 h-3.5" />} label="6 invoices submitted, awaiting payor reply" sub="Average response time this month: 3.2 days" />
            <Row icon={<Icons.Activity className="w-3.5 h-3.5" />} label="Last submission: INV-2026-0473 · 11 minutes ago" sub="2 of 4 legs accepted, 2 awaiting determination" />
          </div>

          <div className="cc-card" style={{ background: "var(--cc-muted)", border: "1px dashed var(--cc-border)", borderRadius: "var(--cc-radius)", padding: "0.75rem 1rem", display: "flex", alignItems: "center", gap: "0.625rem" }}>
            <Icons.Sparkles className="w-3.5 h-3.5" style={{ color: "var(--cc-muted-fg)" }} />
            <span className="text-xs">It's a quiet moment — good time to <a className="cc-link" href="#">review SOP §4 changes</a> or <a className="cc-link" href="#">re-classify last week's edge cases</a>.</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ icon, label, sub }: { icon: React.ReactNode; label: string; sub: string }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: "0.625rem" }}>
      <span style={{ width: 24, height: 24, borderRadius: 9999, background: "var(--cc-muted)", display: "inline-flex", alignItems: "center", justifyContent: "center", color: "var(--cc-muted-fg)" }}>{icon}</span>
      <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
        <span className="text-sm font-medium">{label}</span>
        <span className="cc-meta text-xs">{sub}</span>
      </div>
    </div>
  );
}
