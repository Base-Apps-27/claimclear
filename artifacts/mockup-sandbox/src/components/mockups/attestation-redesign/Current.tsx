import { Icons, FrameLabel, SELECTED_BUCKET, QUEUE, Pill, Checkbox } from "./_shared";

/**
 * CURRENT — faithful reproduction of today's Attestation page so the
 * pain points the operator complained about are visible side-by-side
 * with the redesigns:
 *
 *   • aesthetic feels different from rest of app (dense, square,
 *     mid-page MAS reference + Notes inputs eat all the space)
 *   • dual checkbox (cancel + re-attest) with implicit dependency
 *     ("gated" alert text only) is unclear — feels like two equal
 *     things rather than 1 → 2
 *   • the cancel instruction itself ("In MAS · cancel / accept GPS
 *     deviation for invoice #INV-44192") is jammed into one line
 *     next to the checkbox; no walk-through, no context
 *   • MAS reference + Notes inputs are wasted space — operator
 *     never fills them, but they dominate each row
 *   • no top-of-pane "you're working on X, here's what to do"
 *     summary like other pages have evolved into
 */
export default function Current() {
  const b = SELECTED_BUCKET;
  const denied = b.legs.find((l) => l.outcome === "Denied")!;
  return (
    <div className="cc-scope" style={{ width: 1180, minHeight: 880 }}>
      <FrameLabel
        tag="NOW"
        title="Current production · Attestation Queue · Open tab"
        principles={["Reproduces today's pain"]}
      />

      {/* Page header */}
      <div style={{ padding: "16px 20px 12px" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          <div style={{
            width: 28, height: 28, borderRadius: 8, background: "var(--cc-blue-bg)",
            color: "var(--cc-blue-fg)", display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <Icons.Shield style={{ width: 16, height: 16 }} />
          </div>
          <div style={{ flex: 1 }}>
            <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0, lineHeight: 1.2 }}>Attestation</h1>
            <p style={{ fontSize: 13, color: "var(--cc-muted-fg)", margin: "2px 0 0" }}>
              Confirm in MAS that the surviving Approved legs were re-attested after each verdict.
            </p>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <Pill tone="amber">14 open</Pill>
            <Pill tone="green">62 completed</Pill>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 0, borderBottom: "1px solid var(--cc-border)", marginTop: 16 }}>
          <div style={{
            padding: "8px 16px", fontSize: 13, fontWeight: 600,
            borderBottom: "2px solid var(--cc-primary)",
            display: "flex", alignItems: "center", gap: 8,
          }}>
            Open <span style={{
              background: "var(--cc-muted)", color: "var(--cc-muted-fg)",
              padding: "1px 7px", borderRadius: 999, fontSize: 11, fontWeight: 700,
            }}>14</span>
          </div>
          <div style={{
            padding: "8px 16px", fontSize: 13, color: "var(--cc-muted-fg)",
            display: "flex", alignItems: "center", gap: 8,
          }}>
            Completed re-attestations <span style={{
              background: "var(--cc-muted)", color: "var(--cc-muted-fg)",
              padding: "1px 7px", borderRadius: 999, fontSize: 11, fontWeight: 700,
            }}>62</span>
          </div>
        </div>
      </div>

      {/* Master / detail */}
      <div style={{
        display: "grid", gridTemplateColumns: "320px 1fr",
        gap: 16, padding: "0 20px 20px", alignItems: "start",
      }}>
        {/* Left rail */}
        <div className="cc-card" style={{ overflow: "hidden" }}>
          <div className="cc-section-head">
            <span className="cc-section-title">Queue</span>
            <span className="cc-tag">14</span>
          </div>
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {QUEUE.map((q) => (
              <li key={q.invoice} style={{
                padding: "12px 14px", borderBottom: "1px solid var(--cc-border)",
                background: q.selected ? "var(--cc-muted)" : undefined,
                borderLeft: q.selected ? "2px solid var(--cc-blue-fg)" : "2px solid transparent",
                cursor: "pointer",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <span className="mono" style={{ fontSize: 13, fontWeight: 600 }}>{q.invoice}</span>
                  <span className="cc-tag">{q.legCount} legs</span>
                </div>
                <div style={{ marginTop: 4, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <span className="meta">Payor {q.payor}</span>
                  <Pill tone={q.tone}>{q.pillLabel}</Pill>
                </div>
                <div className="meta" style={{ marginTop: 3 }}>{q.ago}</div>
              </li>
            ))}
          </ul>
        </div>

        {/* Detail */}
        <div className="cc-card">
          <div style={{ padding: 20 }}>
            {/* Header */}
            <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <h3 className="mono" style={{ fontSize: 22, fontWeight: 600, margin: 0, letterSpacing: -0.2 }}>
                    {b.invoice}
                  </h3>
                  <span className="cc-tag">{b.legs.length} legs</span>
                </div>
                <div className="meta" style={{ marginTop: 4 }}>
                  Payor <span style={{ color: "var(--cc-fg)", fontWeight: 500 }}>{b.payor}</span>
                </div>
              </div>
              <a href="#" style={{ color: "var(--cc-primary)", fontSize: 13, display: "inline-flex", alignItems: "center", gap: 4 }}>
                Open invoice group <Icons.External style={{ width: 13, height: 13 }} />
              </a>
            </div>

            <div style={{ height: 1, background: "var(--cc-border)", margin: "16px 0" }} />

            {/* Last response */}
            <div className="meta" style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <Icons.Mail style={{ width: 13, height: 13 }} />
              <span>Last payor response · Received {b.payorReply!.ago} · {b.payorReply!.source} — {b.payorReply!.subject}</span>
            </div>

            {/* Action checklist label */}
            <div className="label-cap" style={{ marginTop: 18, marginBottom: 10 }}>Action checklist</div>

            {/* The 2 numbered rows the user complained about */}
            <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 12 }}>
              {/* Row 1 — MAS cancel */}
              <li style={{
                display: "flex", gap: 10, padding: "8px 0 8px 12px",
                borderLeft: "2px solid var(--cc-amber-fg)",
                borderRadius: 6,
              }}>
                <span style={{
                  width: 24, height: 24, borderRadius: 999, background: "var(--cc-muted)",
                  color: "var(--cc-muted-fg)", display: "flex", alignItems: "center",
                  justifyContent: "center", fontSize: 11, fontFamily: "JetBrains Mono, monospace", flexShrink: 0,
                }}>1</span>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <Checkbox checked={false} />
                    <span className="mono" style={{ fontSize: 13 }}>#{denied.id}</span>
                    <span className="cc-tag">{denied.errorType}</span>
                    <span className="meta">In MAS · cancel / accept GPS deviation for invoice <span className="mono">#{b.invoice}</span></span>
                  </div>
                  {/* The "wasted space" inputs */}
                  <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    <div>
                      <label className="meta" style={{ display: "block", marginBottom: 3 }}>MAS reference (optional)</label>
                      <input className="cc-input" placeholder="e.g. MAS-CXL-12345" />
                    </div>
                    <div>
                      <label className="meta" style={{ display: "block", marginBottom: 3 }}>Note (optional)</label>
                      <textarea className="cc-input" rows={2} />
                    </div>
                  </div>
                </div>
              </li>

              {/* Row 2 — re-attest */}
              <li style={{
                display: "flex", gap: 10, padding: "8px 0 8px 12px",
                borderLeft: "2px solid var(--cc-muted-fg)",
                borderRadius: 6,
              }}>
                <span style={{
                  width: 24, height: 24, borderRadius: 999, background: "var(--cc-muted)",
                  color: "var(--cc-muted-fg)", display: "flex", alignItems: "center",
                  justifyContent: "center", fontSize: 11, fontFamily: "JetBrains Mono, monospace", flexShrink: 0,
                }}>2</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>Re-attest the invoice.</div>
                  <div style={{
                    marginTop: 8, padding: "8px 10px", border: "1px solid var(--cc-border)",
                    borderRadius: 6, background: "var(--cc-muted)", display: "flex",
                    alignItems: "flex-start", gap: 8, fontSize: 12,
                  }}>
                    <Icons.Alert style={{ width: 14, height: 14, marginTop: 1, flexShrink: 0 }} />
                    <span>Check off the 1 pending MAS cancel above first.</span>
                  </div>
                  <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8 }}>
                    <Checkbox checked={false} disabled />
                    <span style={{ fontSize: 13, fontWeight: 500, color: "var(--cc-muted-fg)" }}>
                      Re-attest confirmed in MAS
                    </span>
                  </div>
                  {/* Wasted space again */}
                  <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, opacity: 0.55 }}>
                    <div>
                      <label className="meta" style={{ display: "block", marginBottom: 3 }}>MAS reference (optional)</label>
                      <input className="cc-input" placeholder="e.g. MAS-REATTEST-12345" disabled />
                    </div>
                    <div>
                      <label className="meta" style={{ display: "block", marginBottom: 3 }}>Note (optional)</label>
                      <textarea className="cc-input" rows={2} disabled />
                    </div>
                  </div>
                </div>
              </li>
            </ol>

            {/* Legs in this group */}
            <div className="label-cap" style={{ marginTop: 22, marginBottom: 6 }}>Legs in this group</div>
            <p className="meta" style={{ marginTop: 0, marginBottom: 8 }}>
              The action above re-attests every leg at once. Use the per-leg button only when finishing legs individually.
            </p>
            <ul className="cc-card" style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {b.legs.map((leg, i) => (
                <li key={leg.id} style={{
                  display: "flex", alignItems: "center", gap: 10, padding: "10px 12px",
                  borderBottom: i < b.legs.length - 1 ? "1px solid var(--cc-border)" : undefined,
                }}>
                  <span className="mono" style={{ fontWeight: 500 }}>{leg.id}</span>
                  <span className="cc-tag">{leg.outcome}</span>
                  <Pill tone={leg.outcome === "Denied" ? "amber" : "amber"}>Owed by you</Pill>
                  <button className="cc-btn cc-btn-sm cc-btn-ghost" style={{ marginLeft: "auto" }}>
                    Confirm just this leg
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {/* Pain callouts (annotated overlay) */}
      <div style={{
        margin: "8px 20px 16px", padding: "10px 12px", background: "var(--cc-red-bg)",
        border: "1px dashed var(--cc-red-border)", borderRadius: 8, color: "var(--cc-red-fg)",
        fontSize: 12, lineHeight: 1.5,
      }}>
        <strong>Review annotation (not in production) — Pain points to fix:</strong>{" "}
        ① the dual-checkbox dependency is implicit (alert text); operator wants step 1 → step 2 sequencing.{" "}
        ② "MAS reference" + "Notes" are wasted — never used.{" "}
        ③ Step 1 cancellation instruction is one squeezed line; no walkthrough.{" "}
        ④ No top-of-pane "you're working on X, here's what to do" summary.
      </div>
    </div>
  );
}
