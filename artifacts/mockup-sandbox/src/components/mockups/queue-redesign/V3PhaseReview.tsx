import {
  HeaderStrip, ClassificationStrip, MasterList,
  FrameLabel, Annotation, legs, groupSummary, Icons,
} from "./_shared";

/**
 * V3 — Wizard phase 3 of 4: "Review & edit".
 * Same package as the Preview phase, but every narrative is now an
 * editable field, evidence files have add/remove controls, and the
 * Submit button in the footer is the live primary CTA. This is the
 * operator's commit point — clicking Submit sends the package to the
 * MAS portal in the next phase.
 */
export default function V3PhaseReview() {
  return (
    <div className="cc-scope" style={{ width: 1280, minHeight: 900 }}>
      <FrameLabel
        tag="V3·review"
        title="Wizard phase 3 of 4 · Review &amp; edit · narratives editable, Submit goes live"
        principles={["P1", "P3", "P4", "P5", "P9"]}
      />
      <HeaderStrip />
      <ClassificationStrip count={0} />

      <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", height: 760 }}>
        <MasterList dense />

        <div style={{ display: "flex", flexDirection: "column", padding: "0.75rem", gap: "0.625rem", overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.625rem", padding: "0.5rem 0.75rem", background: "var(--cc-card)", border: "1px solid var(--cc-border)", borderRadius: "var(--cc-radius)" }}>
            <span className="mono text-[12px] font-semibold">{groupSummary.invoice}</span>
            <span className="cc-meta text-[11px]">{groupSummary.payor} · {groupSummary.total}</span>
            <span className="cc-pill cc-pill-amber" style={{ marginLeft: "0.5rem" }}>
              <Icons.FileText className="w-3 h-3 inline" /> 1 unsaved edit · Leg 1
            </span>
            <div className="cc-segmented" style={{ marginLeft: "auto" }}>
              <button><Icons.CheckCircle2 className="w-2.5 h-2.5 inline mr-1" />Walk ✓</button>
              <button><Icons.CheckCircle2 className="w-2.5 h-2.5 inline mr-1" />Preview ✓</button>
              <button className="is-active"><Icons.FileText className="w-2.5 h-2.5 inline mr-1" />Review</button>
              <button>Submit</button>
            </div>
          </div>

          <Annotation>
            Every narrative is an editable text area; evidence files have add/remove
            controls. Edits stay local until you click Submit (no auto-save to the
            portal). Use Diff view to see what changed from the auto-generated draft.
          </Annotation>

          {/* Hero — editable submission package */}
          <div style={{ flex: 1, overflow: "auto", padding: "0 0.5rem" }}>
            <div style={{ maxWidth: 880, margin: "0 auto", background: "white", border: "1px solid var(--cc-border)", borderRadius: "var(--cc-radius)", padding: "1.25rem 1.5rem", fontSize: "0.8125rem", lineHeight: 1.5 }}>
              <div style={{ borderBottom: "1px solid var(--cc-border)", paddingBottom: "0.75rem", marginBottom: "0.875rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <div style={{ flex: 1 }}>
                  <div className="cc-meta text-[10px] uppercase tracking-wider font-semibold">MAS Medicaid · Provider Dispute Submission</div>
                  <div style={{ fontWeight: 700, fontSize: "1rem", marginTop: 4 }}>Invoice {groupSummary.invoice} · 3 ride legs · {groupSummary.total}</div>
                </div>
                <button className="cc-btn cc-btn-sm"><Icons.Activity className="w-3 h-3" /> Diff vs draft</button>
              </div>

              <EditLeg n={1} conf={legs[0].conf} amount={legs[0].amount}
                narrative="Operator confirmed billed mileage of 14.2 mi for rate code R-12 against GPS export from dispatch (file: gps-2026-04-24.csv). Distance variance under tolerance threshold (±0.5 mi). [Edited: added note about R-12 rate change effective Apr 1.]"
                edited
                evidence={["gps-2026-04-24.csv", "dispatch-log-04812.pdf", "prior-auth-PA-2026-1188.pdf"]} />
              <EditLeg n={2} conf={legs[1].conf} amount={legs[1].amount}
                narrative="No exceptions found during walk. Standard rate-code R-08 applied per fee schedule §3.2. Auto-marked ready by SOP §4.1."
                evidence={["dispatch-log-04813.pdf"]} />
              <EditLeg n={3} conf={legs[2].conf} amount={legs[2].amount}
                narrative="Trip authorized under prior auth PA-2026-1192, valid Apr 18 – Apr 26. Apr 25 trip falls within authorization window."
                evidence={["prior-auth-PA-2026-1192.pdf", "portal-screenshot-2026-05-07.png"]} />

              <div style={{ borderTop: "1px solid var(--cc-border)", paddingTop: "0.625rem", marginTop: "0.5rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <div className="cc-meta text-[11px] flex-1"><strong>Total:</strong> $1,402.10 · <strong>Evidence:</strong> 6 files · <strong>Edits:</strong> 1 leg modified</div>
                <button className="cc-btn cc-btn-sm">Revert all to draft</button>
              </div>
            </div>
          </div>

          {/* Sticky footer — Submit goes live */}
          <div className="cc-footer-card cc-footer-pinned" style={{ padding: "0.5rem 0.875rem" }}>
            <span className="cc-pill cc-pill-green">Ready to submit</span>
            <span className="cc-meta text-xs flex-1">Submit POSTs the package to MAS · operator + timestamp recorded · no recall after send.</span>
            <div className="cc-gauntlet-row" style={{ margin: 0 }}>
              <span className="cc-gauntlet-step cc-gauntlet-done"><Icons.CheckCircle2 className="w-3 h-3" /> Walk</span>
              <span className="cc-gauntlet-step cc-gauntlet-done"><Icons.CheckCircle2 className="w-3 h-3" /> Preview</span>
              <span className="cc-gauntlet-step cc-gauntlet-active"><Icons.FileText className="w-3 h-3" /> Review</span>
              <span className="cc-gauntlet-step"><Icons.Send className="w-3 h-3" /> Submit</span>
            </div>
            <button className="cc-btn">Save &amp; close</button>
            <button className="cc-btn cc-btn-primary"><Icons.Send className="w-3.5 h-3.5" /> Submit to MAS portal</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function EditLeg({ n, conf, amount, narrative, evidence, edited = false }: { n: number; conf: string; amount: string; narrative: string; evidence: string[]; edited?: boolean }) {
  return (
    <div style={{ marginBottom: "0.875rem", paddingLeft: "0.625rem", borderLeft: edited ? "2px solid var(--cc-amber-fg)" : "2px solid var(--cc-border)" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: "0.5rem", marginBottom: "0.375rem" }}>
        <span style={{ fontWeight: 700 }}>Leg {n}</span>
        <span className="mono text-[12px]">{conf}</span>
        {edited && <span className="cc-pill cc-pill-amber">Edited</span>}
        <span className="cc-meta text-[11px] tabular-nums" style={{ marginLeft: "auto" }}>{amount}</span>
        <button className="cc-btn cc-btn-ghost cc-btn-sm">⋯</button>
      </div>
      <div style={{ position: "relative" }}>
        <textarea
          defaultValue={narrative}
          style={{
            width: "100%", minHeight: 64, padding: "0.5rem 0.625rem",
            border: "1px solid var(--cc-border)", borderRadius: 4,
            fontSize: "0.8125rem", fontFamily: "inherit", lineHeight: 1.5,
            resize: "vertical", background: "white",
          }}
        />
      </div>
      <div className="cc-meta text-[11px]" style={{ marginTop: "0.375rem", display: "flex", alignItems: "center", gap: "0.375rem", flexWrap: "wrap" }}>
        <strong>Evidence:</strong>
        {evidence.map((e) => (
          <span key={e} style={{ display: "inline-flex", alignItems: "center", gap: 3, padding: "1px 6px", background: "var(--cc-muted)", borderRadius: 4 }}>
            <Icons.Paperclip className="w-2.5 h-2.5" />
            <span className="mono text-[11px]">{e}</span>
            <button style={{ border: 0, background: "transparent", cursor: "pointer", padding: 0, lineHeight: 1, color: "var(--cc-muted-fg)" }} aria-label={`Remove ${e}`}>×</button>
          </span>
        ))}
        <button className="cc-btn cc-btn-ghost cc-btn-sm"><Icons.Paperclip className="w-3 h-3" /> Add evidence</button>
      </div>
    </div>
  );
}
