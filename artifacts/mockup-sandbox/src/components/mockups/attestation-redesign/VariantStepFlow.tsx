import React, { useState } from "react";
import "./_attest.css";
import { Icons, FrameLabel, SELECTED_BUCKET, QUEUE, Pill, StepNumber } from "./_shared";

export default function VariantStepFlow() {
  const b = SELECTED_BUCKET;
  const denied = b.legs.find((l) => l.outcome === "Denied")!;
  const survived = b.legs.filter((l) => l.outcome !== "Denied");

  const [step, setStep] = useState(2);

  return (
    <div className="cc-scope" style={{ width: 1180, minHeight: 880 }}>
      <FrameLabel
        tag="VARIANT B"
        title="Step-by-Step Execution Flow (wizard rail)"
        principles={["Clear sequencing", "Walkthrough instructions", "No wasted space"]}
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

        {/* Detail (Wizard) */}
        <div style={{ padding: "0 10px" }}>
          <div style={{ marginBottom: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <h3 className="mono" style={{ fontSize: 24, fontWeight: 600, margin: 0, letterSpacing: -0.2 }}>
                {b.invoice}
              </h3>
              <Pill tone="blue">Working</Pill>
              <span className="meta">Payor {b.payor} · {b.legs.length} legs · entered {b.enteredHours}h ago</span>
            </div>
            <div style={{
              marginTop: 10, padding: "10px 12px",
              background: "var(--cc-blue-bg)", border: "1px solid var(--cc-blue-border)",
              borderRadius: 8, color: "var(--cc-blue-fg)",
              fontSize: 13, lineHeight: 1.45,
              display: "flex", alignItems: "flex-start", gap: 8,
            }}>
              <Icons.ArrowRight style={{ width: 14, height: 14, marginTop: 2, flexShrink: 0 }} />
              <span>
                <strong>You're working on {b.invoice}.</strong>{" "}
                Cancel <span className="mono">#R-7733</span> in MAS, then re-attest the surviving 2 Approved legs. Three steps below.
              </span>
            </div>
          </div>

          <div style={{ position: "relative" }}>
            {/* Connector line background */}
            <div style={{
              position: "absolute", top: 12, bottom: 24, left: 15,
              width: 2, background: "var(--cc-border)", zIndex: 0
            }} />
            
            <div style={{ display: "flex", flexDirection: "column", gap: 20, position: "relative", zIndex: 1 }}>
              
              {/* Step 1: Read Verdict */}
              <div style={{ display: "flex", gap: 16 }}>
                <div style={{ background: "var(--cc-bg)", padding: "4px 0" }}>
                  <StepNumber n={1} done={step > 1} />
                </div>
                <div className="cc-card" style={{ flex: 1, padding: 16, opacity: step > 1 ? 0.8 : 1 }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <div style={{ fontSize: 15, fontWeight: 600 }}>Read the verdict</div>
                    {step > 1 && <span className="meta" style={{ color: "var(--cc-green-fg)", fontWeight: 500 }}>Auto-checked</span>}
                  </div>
                  <div className="meta" style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 10 }}>
                    <Icons.Mail style={{ width: 13, height: 13 }} />
                    <span>Payor reply · {b.payorReply!.ago}</span>
                  </div>
                  <div style={{
                    marginTop: 8, padding: 12, borderLeft: "3px solid var(--cc-border)",
                    background: "var(--cc-muted)", borderRadius: "0 6px 6px 0",
                    fontStyle: "italic", fontSize: 13, color: "var(--cc-fg)"
                  }}>
                    "{b.payorReply!.subject}"
                  </div>
                  <div style={{ marginTop: 12, display: "flex", gap: 10 }}>
                    <Pill tone="green">{survived.length} Approved</Pill>
                    <Pill tone="red">1 Denied ({denied.errorType})</Pill>
                  </div>
                </div>
              </div>

              {/* Step 2: Cancel in MAS */}
              <div style={{ display: "flex", gap: 16 }}>
                <div style={{ background: "var(--cc-bg)", padding: "4px 0" }}>
                  <StepNumber n={2} done={step > 2} locked={step < 2} />
                </div>
                <div className="cc-card" style={{ 
                  flex: 1, padding: 16, 
                  border: step === 2 ? "2px solid var(--cc-primary)" : "1px solid var(--cc-border)",
                  boxShadow: step === 2 ? "0 4px 12px rgba(0,0,0,0.05)" : "none",
                  opacity: step < 2 ? 0.5 : 1
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ fontSize: 15, fontWeight: 600 }}>Cancel #{denied.id} in MAS</div>
                    {step === 2 && <Pill tone="blue">Current Step</Pill>}
                  </div>
                  
                  {step >= 2 && (
                    <div style={{ marginTop: 16 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>Action required in MAS:</div>
                      <ol style={{ fontSize: 13, lineHeight: 1.6, paddingLeft: 20, margin: 0, color: "var(--cc-muted-fg)" }}>
                        <li>Search for confirmation <span className="mono cc-tag">#{denied.id}</span></li>
                        <li>Open the leg details and hit <strong>Cancel</strong></li>
                        <li>Select reason: <strong>{denied.errorType}</strong></li>
                        <li>Save the cancellation</li>
                      </ol>

                      <div style={{ marginTop: 16, display: "flex", gap: 12, alignItems: "center" }}>
                        {step === 2 ? (
                          <button className="cc-btn cc-btn-primary" onClick={() => setStep(3)}>
                            <Icons.Check style={{ width: 14, height: 14 }} /> I have cancelled this in MAS
                          </button>
                        ) : (
                          <button className="cc-btn cc-btn-ghost cc-btn-sm" onClick={() => setStep(2)}>
                            <Icons.Refresh style={{ width: 14, height: 14 }} /> Undo
                          </button>
                        )}
                        <a href="#" style={{ color: "var(--cc-primary)", fontSize: 13, display: "inline-flex", alignItems: "center", gap: 4, fontWeight: 500 }}>
                          Open MAS <Icons.External style={{ width: 13, height: 13 }} />
                        </a>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Step 3: Re-attest in MAS */}
              <div style={{ display: "flex", gap: 16 }}>
                <div style={{ background: "var(--cc-bg)", padding: "4px 0" }}>
                  <StepNumber n={3} done={step > 3} locked={step < 3} />
                </div>
                <div className="cc-card" style={{ 
                  flex: 1, padding: 16,
                  border: step === 3 ? "2px solid var(--cc-primary)" : "1px solid var(--cc-border)",
                  boxShadow: step === 3 ? "0 4px 12px rgba(0,0,0,0.05)" : "none",
                  opacity: step < 3 ? 0.5 : 1
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ fontSize: 15, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
                      {step < 3 && <Icons.Lock style={{ width: 16, height: 16, color: "var(--cc-muted-fg)" }} />}
                      Re-attest INV-44192 in MAS
                    </div>
                    {step === 3 && <Pill tone="blue">Current Step</Pill>}
                    {step < 3 && <span className="meta">Available after step 2</span>}
                  </div>

                  {step >= 3 && (
                    <div style={{ marginTop: 16 }}>
                      <p style={{ fontSize: 13, margin: "0 0 12px", color: "var(--cc-muted-fg)" }}>
                        Now that the denied leg is cancelled, re-attest the surviving legs together.
                      </p>
                      
                      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                        {survived.map(l => (
                          <div key={l.id} className="cc-tag mono">{l.id}</div>
                        ))}
                      </div>

                      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                        {step === 3 ? (
                          <button className="cc-btn cc-btn-primary" onClick={() => setStep(4)}>
                            <Icons.Check style={{ width: 14, height: 14 }} /> Re-attested in MAS
                          </button>
                        ) : (
                          <button className="cc-btn cc-btn-ghost cc-btn-sm" onClick={() => setStep(3)}>
                            <Icons.Refresh style={{ width: 14, height: 14 }} /> Undo
                          </button>
                        )}
                        <a href="#" style={{ color: "var(--cc-primary)", fontSize: 13, display: "inline-flex", alignItems: "center", gap: 4, fontWeight: 500 }}>
                          Open MAS <Icons.External style={{ width: 13, height: 13 }} />
                        </a>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Step 4: Done */}
              {step === 4 && (
                <div style={{ display: "flex", gap: 16 }}>
                  <div style={{ background: "var(--cc-bg)", padding: "4px 0" }}>
                    <span style={{
                      width: 24, height: 24, borderRadius: 999, background: "var(--cc-green-bg)",
                      color: "var(--cc-green-fg)", display: "inline-flex", alignItems: "center",
                      justifyContent: "center", flexShrink: 0, border: "1px solid var(--cc-green-border)",
                    }}>
                      <Icons.Check style={{ width: 14, height: 14 }} />
                    </span>
                  </div>
                  <div className="cc-card" style={{ 
                    flex: 1, padding: 16, background: "var(--cc-green-bg)",
                    borderColor: "var(--cc-green-border)", display: "flex", alignItems: "center", gap: 12
                  }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 15, fontWeight: 600, color: "var(--cc-green-fg)" }}>All done</div>
                      <div style={{ fontSize: 13, color: "var(--cc-green-fg)", opacity: 0.8 }}>
                        Invoice successfully processed.
                      </div>
                    </div>
                    <button className="cc-btn" style={{ background: "white" }} onClick={() => setStep(2)}>
                      Next Invoice <Icons.ArrowRight style={{ width: 14, height: 14 }} />
                    </button>
                  </div>
                </div>
              )}

            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
