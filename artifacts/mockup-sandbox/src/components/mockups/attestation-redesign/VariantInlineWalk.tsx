import "./_attest.css";
import { useState } from "react";
import { Icons, FrameLabel, SELECTED_BUCKET, QUEUE, Pill, Checkbox, StepNumber } from "./_shared";

export default function VariantInlineWalk() {
  const b = SELECTED_BUCKET;
  const denied = b.legs.find((l) => l.outcome === "Denied")!;
  const [step1Done, setStep1Done] = useState(false);
  const [step2Done, setStep2Done] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);

  return (
    <div className="cc-scope" style={{ width: 1180, minHeight: 880, display: "flex", flexDirection: "column" }}>
      <FrameLabel
        tag="VARIANT C"
        title="Inline Walkthrough with Disclosed Detail"
        principles={["Recipe card execution", "Composite panel", "Disclosure for noise"]}
      />

      {/* Page header */}
      <div style={{ padding: "24px 32px 16px" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 16 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 10, background: "var(--cc-blue-bg)",
            color: "var(--cc-blue-fg)", display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <Icons.Shield style={{ width: 18, height: 18 }} />
          </div>
          <div style={{ flex: 1 }}>
            <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, letterSpacing: "-0.01em" }}>Attestation</h1>
            <p style={{ fontSize: 14, color: "var(--cc-muted-fg)", margin: "4px 0 0" }}>
              Confirm in MAS that the surviving Approved legs were re-attested after each verdict.
            </p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Pill tone="amber">14 open</Pill>
            <Pill tone="green">62 completed</Pill>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 24, borderBottom: "1px solid var(--cc-border)", marginTop: 24 }}>
          <div style={{
            padding: "8px 0", fontSize: 14, fontWeight: 600,
            borderBottom: "2px solid var(--cc-primary)", color: "var(--cc-fg)",
            display: "flex", alignItems: "center", gap: 8, marginBottom: -1,
          }}>
            Open <span style={{
              background: "var(--cc-muted)", color: "var(--cc-muted-fg)",
              padding: "2px 8px", borderRadius: 999, fontSize: 11, fontWeight: 700,
            }}>14</span>
          </div>
          <div style={{
            padding: "8px 0", fontSize: 14, color: "var(--cc-muted-fg)", fontWeight: 500,
            display: "flex", alignItems: "center", gap: 8, cursor: "pointer",
          }}>
            Completed re-attestations <span style={{
              background: "transparent", color: "var(--cc-muted-fg)",
              padding: "2px 8px", borderRadius: 999, fontSize: 11, fontWeight: 700,
            }}>62</span>
          </div>
        </div>
      </div>

      {/* Master / detail */}
      <div style={{
        display: "grid", gridTemplateColumns: "340px 1fr",
        gap: 24, padding: "0 32px 32px", alignItems: "start",
        flex: 1,
      }}>
        {/* Left rail */}
        <div className="cc-card" style={{ overflow: "hidden", border: "1px solid var(--cc-border)", background: "var(--cc-card)", boxShadow: "0 1px 3px rgba(0,0,0,0.02)" }}>
          <div className="cc-section-head" style={{ padding: "14px 16px", background: "var(--cc-muted)", borderBottom: "1px solid var(--cc-border)" }}>
            <span className="cc-section-title" style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--cc-muted-fg)" }}>Queue</span>
          </div>
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {QUEUE.map((q) => (
              <li key={q.invoice} style={{
                padding: "16px", borderBottom: "1px solid var(--cc-border)",
                background: q.selected ? "white" : "transparent",
                boxShadow: q.selected ? "inset 3px 0 0 var(--cc-blue-fg)" : "none",
                cursor: "pointer", transition: "background 0.15s",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span className="mono" style={{ fontSize: 14, fontWeight: 600, color: "var(--cc-fg)" }}>{q.invoice}</span>
                  <span style={{ fontSize: 12, color: "var(--cc-muted-fg)", fontWeight: 500 }}>{q.legCount} legs</span>
                </div>
                <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <Pill tone={q.selected ? "amber" : "muted"}>{q.pillLabel}</Pill>
                </div>
                <div style={{ marginTop: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 12, color: "var(--cc-muted-fg)", fontWeight: 500 }}>{q.payor}</span>
                  <span className="meta" style={{ fontSize: 11 }}>{q.ago}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* Detail Pane */}
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          {/* Top summary band */}
          <div className="cc-card" style={{ padding: "20px 24px", background: "var(--cc-card)", border: "1px solid var(--cc-border)", boxShadow: "0 1px 3px rgba(0,0,0,0.02)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
                  <h2 className="mono" style={{ fontSize: 24, fontWeight: 700, margin: 0, letterSpacing: "-0.02em" }}>{b.invoice}</h2>
                  <span className="cc-tag" style={{ background: "var(--cc-amber-bg)", color: "var(--cc-amber-fg)", borderColor: "var(--cc-amber-border)" }}>Attention required</span>
                </div>
                <div style={{ fontSize: 14, color: "var(--cc-fg)", display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontWeight: 600 }}>{b.payor}</span>
                  <span style={{ color: "var(--cc-muted-fg)" }}>·</span>
                  <span>{b.legs.length} legs</span>
                </div>
              </div>
              <button className="cc-btn cc-btn-ghost cc-btn-sm" style={{ color: "var(--cc-primary)", fontWeight: 600 }}>
                Open invoice group <Icons.External style={{ width: 14, height: 14, marginLeft: 4 }} />
              </button>
            </div>
            
            <div style={{ padding: "12px 16px", background: "var(--cc-blue-bg)", borderRadius: 8, border: "1px solid var(--cc-blue-border)", display: "flex", gap: 12, alignItems: "flex-start" }}>
              <Icons.Mail style={{ width: 16, height: 16, color: "var(--cc-blue-fg)", marginTop: 2 }} />
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-blue-fg)", marginBottom: 2 }}>Payor accepted 2 of 3</div>
                <div style={{ fontSize: 13, color: "var(--cc-blue-fg)", opacity: 0.9 }}>Received {b.payorReply!.ago} — {b.payorReply!.subject}</div>
              </div>
            </div>
          </div>

          {/* Execution Flow Panel */}
          <div className="cc-card" style={{ overflow: "hidden", border: "1px solid var(--cc-border)", boxShadow: "0 2px 8px rgba(0,0,0,0.04)" }}>
            <div style={{ padding: "16px 24px", borderBottom: "1px solid var(--cc-border)", background: "var(--cc-muted)", display: "flex", alignItems: "center", gap: 8 }}>
              <Icons.Refresh style={{ width: 16, height: 16, color: "var(--cc-muted-fg)" }} />
              <span style={{ fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--cc-muted-fg)" }}>Do this in MAS</span>
            </div>
            
            <div style={{ padding: 24, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
              {/* Step 1 Card */}
              <div style={{
                border: "1px solid",
                borderColor: step1Done ? "var(--cc-green-border)" : "var(--cc-blue-border)",
                background: step1Done ? "var(--cc-green-bg)" : "white",
                borderRadius: 8, padding: 20, position: "relative",
                transition: "all 0.2s ease"
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
                  <StepNumber n={1} done={step1Done} />
                  <span style={{ fontSize: 15, fontWeight: 600, color: step1Done ? "var(--cc-green-fg)" : "var(--cc-fg)" }}>
                    Cancel leg <span className="mono">#{denied.id}</span>
                  </span>
                </div>
                
                <div style={{ fontSize: 13, color: "var(--cc-muted-fg)", lineHeight: 1.5, marginBottom: 20, paddingLeft: 36 }}>
                  In MAS, locate this leg and apply the <strong style={{ color: "var(--cc-fg)" }}>{denied.errorType}</strong> cancellation reason. Save the change.
                </div>

                <div style={{ paddingLeft: 36 }}>
                  <button
                    onClick={() => setStep1Done(!step1Done)}
                    className="cc-btn"
                    style={{
                      background: step1Done ? "var(--cc-card)" : "var(--cc-blue-fg)",
                      color: step1Done ? "var(--cc-fg)" : "white",
                      borderColor: step1Done ? "var(--cc-border)" : "var(--cc-blue-fg)",
                      width: "100%", justifyContent: "center"
                    }}
                  >
                    {step1Done ? (
                      <><Icons.Check style={{ width: 14, height: 14 }} /> Cancelled in MAS</>
                    ) : (
                      "Mark cancelled"
                    )}
                  </button>
                </div>
              </div>

              {/* Step 2 Card */}
              <div style={{
                border: "1px solid",
                borderColor: step2Done ? "var(--cc-green-border)" : (step1Done ? "var(--cc-amber-border)" : "var(--cc-border)"),
                background: step2Done ? "var(--cc-green-bg)" : (step1Done ? "var(--cc-amber-bg)" : "var(--cc-muted)"),
                borderRadius: 8, padding: 20, position: "relative",
                opacity: step1Done ? 1 : 0.6,
                transition: "all 0.2s ease"
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
                  <StepNumber n={2} done={step2Done} locked={!step1Done} />
                  <span style={{ fontSize: 15, fontWeight: 600, color: step2Done ? "var(--cc-green-fg)" : (step1Done ? "var(--cc-amber-fg)" : "var(--cc-muted-fg)") }}>
                    Re-attest invoice
                  </span>
                </div>

                <div style={{ fontSize: 13, color: step1Done ? "var(--cc-amber-fg)" : "var(--cc-muted-fg)", lineHeight: 1.5, marginBottom: 20, paddingLeft: 36 }}>
                  {step1Done ? 
                    <><strong style={{ color: "var(--cc-amber-fg)" }}>Ready.</strong> Re-attest the entire invoice to resubmit the remaining approved legs.</> : 
                    "Step 1 must be completed first."}
                </div>

                <div style={{ paddingLeft: 36 }}>
                  <button
                    onClick={() => setStep2Done(!step2Done)}
                    disabled={!step1Done}
                    className="cc-btn"
                    style={{
                      background: step2Done ? "var(--cc-card)" : (step1Done ? "var(--cc-amber-fg)" : "var(--cc-card)"),
                      color: step2Done ? "var(--cc-fg)" : (step1Done ? "white" : "var(--cc-muted-fg)"),
                      borderColor: step2Done ? "var(--cc-border)" : (step1Done ? "var(--cc-amber-fg)" : "var(--cc-border)"),
                      width: "100%", justifyContent: "center"
                    }}
                  >
                    {step2Done ? (
                      <><Icons.Check style={{ width: 14, height: 14 }} /> Re-attested in MAS</>
                    ) : (
                      "Confirm re-attestation"
                    )}
                  </button>
                </div>
              </div>
            </div>

            {/* Disclosure */}
            <div style={{ borderTop: "1px solid var(--cc-border)", background: "var(--cc-card)" }}>
              <button 
                onClick={() => setDetailsOpen(!detailsOpen)}
                style={{
                  width: "100%", padding: "12px 24px", background: "transparent", border: "none",
                  display: "flex", alignItems: "center", gap: 8, cursor: "pointer",
                  fontSize: 13, color: "var(--cc-muted-fg)", fontWeight: 500
                }}
              >
                <Icons.Chevron style={{ width: 14, height: 14, transform: detailsOpen ? "rotate(180deg)" : "rotate(0)", transition: "transform 0.2s" }} />
                Add MAS reference or note (optional)
              </button>
              {detailsOpen && (
                <div style={{ padding: "0 24px 20px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                  <div>
                    <label className="meta" style={{ display: "block", marginBottom: 6 }}>MAS reference</label>
                    <input className="cc-input" placeholder="e.g. MAS-CXL-12345" />
                  </div>
                  <div>
                    <label className="meta" style={{ display: "block", marginBottom: 6 }}>Internal note</label>
                    <input className="cc-input" placeholder="Additional context..." />
                  </div>
                </div>
              )}
            </div>
            
            {/* Action Bar */}
            <div style={{ padding: "16px 24px", borderTop: "1px solid var(--cc-border)", background: "var(--cc-muted)", display: "flex", justifyContent: "flex-end" }}>
              <button className="cc-btn cc-btn-primary" disabled={!step1Done || !step2Done} style={{ padding: "8px 24px", fontSize: 14 }}>
                Complete and load next
              </button>
            </div>
          </div>

          {/* Legs list */}
          <div>
            <div className="label-cap" style={{ marginBottom: 12 }}>Surviving legs in this group</div>
            <div className="cc-card" style={{ overflow: "hidden" }}>
              {b.legs.filter(l => l.outcome !== "Denied").map((leg, i, arr) => (
                <div key={leg.id} style={{
                  display: "flex", alignItems: "center", gap: 16, padding: "12px 16px",
                  borderBottom: i < arr.length - 1 ? "1px solid var(--cc-border)" : "none",
                  background: "white"
                }}>
                  <span className="mono" style={{ fontWeight: 600, fontSize: 13 }}>{leg.id}</span>
                  <Pill tone="green">{leg.outcome}</Pill>
                </div>
              ))}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
