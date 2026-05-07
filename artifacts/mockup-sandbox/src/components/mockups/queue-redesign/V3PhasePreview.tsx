import {
  HeaderStrip, ClassificationStrip, MasterList,
  FrameLabel, Annotation, legs, groupSummary, Icons,
} from "./_shared";

/**
 * V3 — Wizard phase 2 of 4: "Generate preview" complete.
 * Shows the assembled MAS dispute package the system just rendered
 * from the operator's walk verdicts + attached evidence. Nothing has
 * been sent to the portal yet — this is the operator's last chance
 * to read the artifact before committing on Review/Submit.
 */
export default function V3PhasePreview() {
  return (
    <div className="cc-scope" style={{ width: 1280, minHeight: 900 }}>
      <FrameLabel
        tag="V3·preview"
        title="Wizard phase 2 of 4 · Preview generated · package assembled, not yet submitted"
        principles={["P1", "P3", "P4", "P5"]}
      />
      <HeaderStrip />
      <ClassificationStrip count={0} />

      <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", height: 760 }}>
        <MasterList dense />

        <div style={{ display: "flex", flexDirection: "column", padding: "0.75rem", gap: "0.625rem", overflow: "hidden" }}>
          {/* Group bar — same as terminal walk state */}
          <div style={{ display: "flex", alignItems: "center", gap: "0.625rem", padding: "0.5rem 0.75rem", background: "var(--cc-card)", border: "1px solid var(--cc-border)", borderRadius: "var(--cc-radius)" }}>
            <span className="mono text-[12px] font-semibold">{groupSummary.invoice}</span>
            <span className="cc-meta text-[11px]">{groupSummary.payor} · {groupSummary.total}</span>
            <span className="cc-pill cc-pill-green" style={{ marginLeft: "0.5rem" }}>
              <Icons.Sparkles className="w-3 h-3 inline" /> Preview ready · 2.4s
            </span>
            <div className="cc-segmented" style={{ marginLeft: "auto" }}>
              <button><Icons.CheckCircle2 className="w-2.5 h-2.5 inline mr-1" />Walk ✓</button>
              <button className="is-active"><Icons.FileText className="w-2.5 h-2.5 inline mr-1" />Preview</button>
              <button>Review</button>
              <button>Submit</button>
            </div>
          </div>

          <Annotation>
            What you're looking at <strong>is the actual MAS submission payload</strong> —
            the cover sheet + 3 per-leg justifications + evidence manifest that will be
            POSTed to the portal when you click Submit. Nothing has left ClaimClear yet.
            Read once, then advance to Review (where you can edit) or skip straight to Submit.
          </Annotation>

          {/* Hero — the rendered submission document */}
          <div style={{ flex: 1, overflow: "auto", padding: "0 0.5rem" }}>
            <div style={{ maxWidth: 880, margin: "0 auto", background: "white", border: "1px solid var(--cc-border)", borderRadius: "var(--cc-radius)", boxShadow: "0 1px 3px rgba(0,0,0,0.04)", padding: "1.25rem 1.5rem", fontSize: "0.8125rem", lineHeight: 1.5 }}>
              {/* Cover */}
              <div style={{ borderBottom: "1px solid var(--cc-border)", paddingBottom: "0.75rem", marginBottom: "0.875rem" }}>
                <div className="cc-meta text-[10px] uppercase tracking-wider font-semibold">MAS Medicaid · Provider Dispute Submission</div>
                <div style={{ fontWeight: 700, fontSize: "1rem", marginTop: 4 }}>Invoice {groupSummary.invoice} · 3 ride legs · {groupSummary.total}</div>
                <div className="cc-meta text-[11px] mt-1">Provider: Agape Transport (NPI 1234567890) · Submitted by M. Rivera · Tue May 7, 2026</div>
              </div>

              {/* Per-leg sections */}
              <PreviewLeg n={1} conf={legs[0].conf} amount={legs[0].amount} narrative="Operator confirmed billed mileage of 14.2 mi for rate code R-12 against GPS export from dispatch (file: gps-2026-04-24.csv). Distance variance under tolerance threshold (±0.5 mi). Trip logged in dispatch system at 09:12 AM, completed 09:34 AM. Ride was authorized under prior auth PA-2026-1188." evidence={["gps-2026-04-24.csv", "dispatch-log-04812.pdf", "prior-auth-PA-2026-1188.pdf"]} />
              <PreviewLeg n={2} conf={legs[1].conf} amount={legs[1].amount} narrative="No exceptions found during walk. Standard rate-code R-08 applied per fee schedule §3.2. Auto-marked ready by SOP §4.1." evidence={["dispatch-log-04813.pdf"]} />
              <PreviewLeg n={3} conf={legs[2].conf} amount={legs[2].amount} narrative="Trip authorized under prior auth PA-2026-1192, valid Apr 18 – Apr 26. Apr 25 trip falls within authorization window. Operator attached portal screenshot of authorization status as evidence." evidence={["prior-auth-PA-2026-1192.pdf", "portal-screenshot-2026-05-07.png"]} />

              {/* Footer */}
              <div style={{ borderTop: "1px solid var(--cc-border)", paddingTop: "0.625rem", marginTop: "0.5rem" }}>
                <div className="cc-meta text-[11px]"><strong>Total disputed:</strong> $1,402.10 across 3 legs · <strong>Evidence files:</strong> 6 attachments · <strong>Cover citations:</strong> SOP §4.1, §4.2 · Fee schedule §3.2</div>
              </div>
            </div>
          </div>

          {/* Sticky footer — gauntlet advanced one step */}
          <div className="cc-footer-card cc-footer-pinned" style={{ padding: "0.5rem 0.875rem" }}>
            <span className="cc-pill cc-pill-green">Preview ready</span>
            <span className="cc-meta text-xs flex-1">Read the assembled package above. Review lets you edit narratives or swap evidence; Submit sends as-is.</span>
            <div className="cc-gauntlet-row" style={{ margin: 0 }}>
              <span className="cc-gauntlet-step cc-gauntlet-done"><Icons.CheckCircle2 className="w-3 h-3" /> Walk legs</span>
              <span className="cc-gauntlet-step cc-gauntlet-done"><Icons.CheckCircle2 className="w-3 h-3" /> Preview</span>
              <span className="cc-gauntlet-step cc-gauntlet-active">Review &amp; edit</span>
              <span className="cc-gauntlet-step"><Icons.Send className="w-3 h-3" /> Submit</span>
            </div>
            <button className="cc-btn">Skip review</button>
            <button className="cc-btn cc-btn-primary"><Icons.FileText className="w-3.5 h-3.5" /> Review &amp; edit</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function PreviewLeg({ n, conf, amount, narrative, evidence }: { n: number; conf: string; amount: string; narrative: string; evidence: string[] }) {
  return (
    <div style={{ marginBottom: "0.875rem", paddingLeft: "0.625rem", borderLeft: "2px solid var(--cc-border)" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: "0.5rem", marginBottom: "0.25rem" }}>
        <span style={{ fontWeight: 700 }}>Leg {n}</span>
        <span className="mono text-[12px]">{conf}</span>
        <span className="cc-meta text-[11px] tabular-nums" style={{ marginLeft: "auto" }}>{amount}</span>
      </div>
      <p style={{ margin: "0 0 0.375rem 0", color: "var(--cc-fg)" }}>{narrative}</p>
      <div className="cc-meta text-[11px]">
        <strong>Evidence:</strong>{" "}
        {evidence.map((e, i) => (
          <span key={e}>
            <a href="#" className="cc-link mono text-[11px]">{e}</a>{i < evidence.length - 1 ? " · " : ""}
          </span>
        ))}
      </div>
    </div>
  );
}
