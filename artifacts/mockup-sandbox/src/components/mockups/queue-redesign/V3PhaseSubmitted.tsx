import {
  HeaderStrip, ClassificationStrip, MasterList,
  FrameLabel, Annotation, legs, groupSummary, Icons,
} from "./_shared";

/**
 * V3 — Wizard phase 4 of 4: "Submitted · awaiting MAS reply".
 * Terminal state of the wizard. Package has been POSTed to the MAS
 * portal, MAS returned a tracking ID for each leg, and ClaimClear is
 * now polling for status. The hero turns into a tracking receipt; the
 * footer becomes a status bar (no further action until MAS responds);
 * group sits in the "Awaiting payor reply" queue chip until then.
 */
export default function V3PhaseSubmitted() {
  return (
    <div className="cc-scope" style={{ width: 1280, minHeight: 900 }}>
      <FrameLabel
        tag="V3·submitted"
        title="Wizard phase 4 of 4 · Submitted to MAS · awaiting payor reply (5–10 business days)"
        principles={["P1", "P3", "P4", "P6", "P9"]}
      />
      <HeaderStrip />
      <ClassificationStrip count={0} />

      <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", height: 760 }}>
        <MasterList dense />

        <div style={{ display: "flex", flexDirection: "column", padding: "0.75rem", gap: "0.625rem", overflow: "hidden" }}>
          {/* Group bar — submitted state */}
          <div style={{ display: "flex", alignItems: "center", gap: "0.625rem", padding: "0.5rem 0.75rem", background: "var(--cc-card)", border: "1px solid var(--cc-border)", borderRadius: "var(--cc-radius)" }}>
            <span className="mono text-[12px] font-semibold">{groupSummary.invoice}</span>
            <span className="cc-meta text-[11px]">{groupSummary.payor} · {groupSummary.total}</span>
            <span className="cc-pill cc-pill-blue" style={{ marginLeft: "0.5rem" }}>
              <Icons.Send className="w-3 h-3 inline" /> Submitted Tue 2:14 PM
            </span>
            <div className="cc-segmented" style={{ marginLeft: "auto" }}>
              <button><Icons.CheckCircle2 className="w-2.5 h-2.5 inline mr-1" />Walk</button>
              <button><Icons.CheckCircle2 className="w-2.5 h-2.5 inline mr-1" />Preview</button>
              <button><Icons.CheckCircle2 className="w-2.5 h-2.5 inline mr-1" />Review</button>
              <button className="is-active"><Icons.CheckCircle2 className="w-2.5 h-2.5 inline mr-1" />Submitted</button>
            </div>
          </div>

          <Annotation tone="muted">
            Group has moved into the <strong>"Awaiting payor reply"</strong> queue chip
            (4 → 5 in the header). No operator action available until MAS responds —
            ClaimClear polls the portal every 4 hours and will surface the reply in
            the Classification Inbox when it arrives. Track status below.
          </Annotation>

          {/* Hero — submission receipt */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "0.875rem", padding: "0.5rem 1.25rem", overflow: "auto" }}>
            <div style={{ maxWidth: 880, margin: "0 auto", width: "100%", display: "flex", flexDirection: "column", gap: "0.875rem" }}>

              {/* Receipt header */}
              <div className="cc-card" style={{ background: "var(--cc-blue-bg)", border: "1px solid var(--cc-blue-border)", borderRadius: "var(--cc-radius)", padding: "1rem 1.125rem", display: "flex", alignItems: "center", gap: "0.875rem" }}>
                <div style={{ background: "var(--cc-blue-fg)", color: "white", borderRadius: "999px", width: 40, height: 40, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <Icons.CheckCircle2 className="w-6 h-6" />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: "1rem", color: "var(--cc-blue-fg)" }}>Submitted to MAS Medicaid portal</div>
                  <div className="cc-meta text-[12px]" style={{ marginTop: 2 }}>
                    Submission ID <span className="mono font-semibold">MAS-2026-DSP-04812-A</span> · Tue May 7, 2026 at 2:14 PM EDT · by M. Rivera
                  </div>
                  <div className="cc-meta text-[12px]" style={{ marginTop: 2 }}>
                    Expected reply: <strong>May 14 – May 21</strong> (5–10 business days · Logisticare median: 6.2 days)
                  </div>
                </div>
                <button className="cc-btn"><Icons.FileText className="w-3.5 h-3.5" /> Download receipt</button>
              </div>

              {/* Per-leg tracking */}
              <div className="cc-card" style={{ background: "var(--cc-card)", border: "1px solid var(--cc-border)", borderRadius: "var(--cc-radius)", padding: "0.875rem 1rem" }}>
                <div style={{ fontWeight: 600, fontSize: "0.875rem", marginBottom: "0.625rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <Icons.Activity className="w-4 h-4" />
                  Per-leg tracking
                  <span className="cc-meta text-[11px] ml-auto">Last polled 5 min ago · next poll in 3h 55m</span>
                </div>
                <TrackingRow n={1} conf={legs[0].conf} amount={legs[0].amount} mas="MAS-04812-A1" status="Received" tone="blue" detail="Acknowledged by portal at 2:14 PM" />
                <TrackingRow n={2} conf={legs[1].conf} amount={legs[1].amount} mas="MAS-04813-A2" status="Received" tone="blue" detail="Acknowledged by portal at 2:14 PM" />
                <TrackingRow n={3} conf={legs[2].conf} amount={legs[2].amount} mas="MAS-04814-A3" status="In review" tone="amber" detail="Routed to claims examiner queue" />
              </div>

              {/* What happens next */}
              <div className="cc-card" style={{ background: "var(--cc-muted)", border: "1px dashed var(--cc-border)", borderRadius: "var(--cc-radius)", padding: "0.625rem 0.875rem", fontSize: "0.75rem", color: "var(--cc-muted-fg)" }}>
                <strong style={{ color: "var(--cc-fg)" }}>What happens next:</strong> When MAS responds (approve, deny, or request more info),
                ClaimClear will create a Classification Inbox entry and move this group out of "Awaiting payor reply"
                back into your action queue. You'll get a notification.
              </div>
            </div>
          </div>

          {/* Sticky footer — status only, no action */}
          <div className="cc-footer-card cc-footer-pinned cc-footer-blue" style={{ padding: "0.5rem 0.875rem" }}>
            <Icons.Clock className="w-4 h-4" style={{ color: "var(--cc-blue-fg)" }} />
            <span className="cc-pill cc-pill-blue">Awaiting MAS reply</span>
            <span className="cc-meta text-xs flex-1">No action required · group will return to your queue when MAS responds (~6 business days).</span>
            <div className="cc-gauntlet-row" style={{ margin: 0 }}>
              <span className="cc-gauntlet-step cc-gauntlet-done"><Icons.CheckCircle2 className="w-3 h-3" /> Walk</span>
              <span className="cc-gauntlet-step cc-gauntlet-done"><Icons.CheckCircle2 className="w-3 h-3" /> Preview</span>
              <span className="cc-gauntlet-step cc-gauntlet-done"><Icons.CheckCircle2 className="w-3 h-3" /> Review</span>
              <span className="cc-gauntlet-step cc-gauntlet-done"><Icons.CheckCircle2 className="w-3 h-3" /> Submitted</span>
            </div>
            <button className="cc-btn">Open next in queue <Icons.ArrowRight className="w-3.5 h-3.5" /></button>
          </div>
        </div>
      </div>
    </div>
  );
}

function TrackingRow({ n, conf, amount, mas, status, tone, detail }: { n: number; conf: string; amount: string; mas: string; status: string; tone: "blue" | "amber" | "green"; detail: string }) {
  const pillClass = tone === "green" ? "cc-pill-green" : tone === "amber" ? "cc-pill-amber" : "cc-pill-blue";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.625rem", padding: "0.5rem 0", borderTop: "1px solid var(--cc-border)" }}>
      <span className="cc-meta text-[10px] font-semibold uppercase tracking-wider" style={{ minWidth: 36 }}>Leg {n}</span>
      <span className="mono text-[12px] font-medium">{conf}</span>
      <span className="cc-meta text-[11px] tabular-nums">{amount}</span>
      <span className="cc-meta text-[11px]">→</span>
      <span className="mono text-[11px]">{mas}</span>
      <span className="cc-meta text-[11px]" style={{ flex: 1 }}>{detail}</span>
      <span className={`cc-pill ${pillClass}`}>{status}</span>
    </div>
  );
}
