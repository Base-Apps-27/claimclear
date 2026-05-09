import { useState } from "react";
import "./_attest.css";
import { FrameLabel, Icons, SELECTED_BUCKET, QUEUE, Pill } from "./_shared";

export default function VariantSingleAction() {
  const b = SELECTED_BUCKET;
  const denied = b.legs.find((l) => l.outcome === "Denied")!;
  const [done, setDone] = useState(false);

  return (
    <div className="cc-scope" style={{ width: 1180, minHeight: 880, paddingBottom: 64 }}>
      <FrameLabel
        tag="VARIANT A"
        title="Single Action Card (one screen, one verb)"
        principles={["Focus on one thing at a time", "Walk-through MAS gesture", "No useless inputs"]}
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

        {/* Detail area - showing stacked states for mockup purposes */}
        <div style={{ display: "flex", flexDirection: "column", gap: 48 }}>
          
          {/* STATE 1: CANCEL INSTRUCTION */}
          <div>
            <div className="label-cap" style={{ marginBottom: 12, color: "var(--cc-amber-fg)" }}>State 1: Initial landing</div>
            <div className="cc-card" style={{ padding: "32px 40px" }}>
              <div style={{ textAlign: "center", marginBottom: 32 }}>
                <div className="meta" style={{ marginBottom: 8 }}>You're working on</div>
                <h2 className="mono" style={{ fontSize: 28, margin: 0, fontWeight: 600, letterSpacing: -0.5 }}>{b.invoice}</h2>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, marginTop: 12 }}>
                  <span style={{ fontSize: 14, fontWeight: 500 }}>Payor {b.payor}</span>
                  <span style={{ width: 4, height: 4, borderRadius: "50%", background: "var(--cc-border)" }} />
                  <span className="meta">{b.legs.length} legs</span>
                  <span style={{ width: 4, height: 4, borderRadius: "50%", background: "var(--cc-border)" }} />
                  <span className="meta">{b.enteredHours} entered hours</span>
                </div>
                
                <div style={{
                  display: "inline-flex", alignItems: "center", gap: 8, marginTop: 16,
                  background: "var(--cc-muted)", padding: "6px 12px", borderRadius: 8, fontSize: 13
                }}>
                  <Icons.Mail style={{ width: 14, height: 14, color: "var(--cc-muted-fg)" }} />
                  <span>Last reply: <span style={{ fontWeight: 500 }}>{b.payorReply!.subject}</span> ({b.payorReply!.ago})</span>
                </div>
              </div>

              <div style={{ borderTop: "1px solid var(--cc-border)", margin: "0 -40px 32px" }} />

              <div style={{ maxWidth: 500, margin: "0 auto" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
                  <div style={{
                    width: 32, height: 32, borderRadius: "50%", background: "var(--cc-amber-bg)",
                    color: "var(--cc-amber-fg)", display: "flex", alignItems: "center", justifyContent: "center",
                    fontWeight: 600, fontSize: 15, border: "1px solid var(--cc-amber-border)"
                  }}>1</div>
                  <h3 style={{ fontSize: 18, margin: 0, fontWeight: 600 }}>Cancel leg in MAS</h3>
                </div>

                <div style={{ 
                  background: "var(--cc-card)", border: "1px solid var(--cc-border)", 
                  borderRadius: 12, overflow: "hidden", marginBottom: 24,
                  boxShadow: "0 2px 8px rgba(0,0,0,0.04)"
                }}>
                  <div style={{ background: "var(--cc-muted)", padding: "10px 16px", borderBottom: "1px solid var(--cc-border)", display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ width: 10, height: 10, borderRadius: "50%", background: "var(--cc-red-border)" }} />
                    <div style={{ width: 10, height: 10, borderRadius: "50%", background: "var(--cc-amber-border)" }} />
                    <div style={{ width: 10, height: 10, borderRadius: "50%", background: "var(--cc-green-border)" }} />
                    <span className="meta mono" style={{ marginLeft: 8 }}>MAS / {b.invoice} / R-7733</span>
                  </div>
                  <div style={{ padding: "20px 24px" }}>
                    <p style={{ margin: "0 0 16px 0", fontSize: 14, lineHeight: 1.5 }}>
                      The payor denied leg <strong className="mono">#{denied.id}</strong> due to <strong>{denied.errorType}</strong>.
                    </p>
                    <ol style={{ margin: 0, paddingLeft: 20, fontSize: 14, lineHeight: 1.6, color: "var(--cc-muted-fg)" }}>
                      <li>Open this invoice in MAS.</li>
                      <li>Navigate to the line item for <strong>#{denied.id}</strong>.</li>
                      <li>Select <strong>Cancel</strong> and choose reason <strong>{denied.errorType}</strong>.</li>
                      <li>Save changes.</li>
                    </ol>
                    <div style={{ marginTop: 20 }}>
                      <a href="#" style={{ color: "var(--cc-primary)", fontSize: 13, display: "inline-flex", alignItems: "center", gap: 4, fontWeight: 500 }}>
                        Open {b.invoice} in MAS <Icons.External style={{ width: 14, height: 14 }} />
                      </a>
                    </div>
                  </div>
                </div>

                <button 
                  className={`cc-btn ${done ? "cc-btn-ghost" : "cc-btn-primary"}`} 
                  style={{ width: "100%", justifyContent: "center", padding: "12px", fontSize: 15 }}
                  onClick={() => setDone(true)}
                >
                  {done ? (
                    <><Icons.Check style={{ width: 18, height: 18 }} /> Cancel done in MAS</>
                  ) : (
                    "Cancel done in MAS"
                  )}
                </button>
              </div>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 16, opacity: 0.5 }}>
            <div style={{ flex: 1, height: 1, background: "var(--cc-border)" }} />
            <div className="label-cap" style={{ color: "var(--cc-muted-fg)" }}>→ becomes</div>
            <div style={{ flex: 1, height: 1, background: "var(--cc-border)" }} />
          </div>

          {/* STATE 2: RE-ATTEST INSTRUCTION */}
          <div>
            <div className="label-cap" style={{ marginBottom: 12, color: "var(--cc-green-fg)" }}>State 2: After canceling</div>
            <div className="cc-card" style={{ padding: "32px 40px" }}>
              <div style={{ textAlign: "center", marginBottom: 32 }}>
                <div className="meta" style={{ marginBottom: 8 }}>You're working on</div>
                <h2 className="mono" style={{ fontSize: 28, margin: 0, fontWeight: 600, letterSpacing: -0.5 }}>{b.invoice}</h2>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, marginTop: 12 }}>
                  <span style={{ fontSize: 14, fontWeight: 500 }}>Payor {b.payor}</span>
                  <span style={{ width: 4, height: 4, borderRadius: "50%", background: "var(--cc-border)" }} />
                  <span className="meta">{b.legs.length} legs</span>
                  <span style={{ width: 4, height: 4, borderRadius: "50%", background: "var(--cc-border)" }} />
                  <span className="meta">{b.enteredHours} entered hours</span>
                </div>
              </div>

              <div style={{ borderTop: "1px solid var(--cc-border)", margin: "0 -40px 32px" }} />

              <div style={{ maxWidth: 500, margin: "0 auto" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24, opacity: 0.5 }}>
                  <div style={{
                    width: 32, height: 32, borderRadius: "50%", background: "var(--cc-card)",
                    color: "var(--cc-fg)", display: "flex", alignItems: "center", justifyContent: "center",
                    fontWeight: 600, fontSize: 15, border: "1px solid var(--cc-border)"
                  }}>
                    <Icons.Check style={{ width: 16, height: 16 }} />
                  </div>
                  <h3 style={{ fontSize: 18, margin: 0, fontWeight: 600, textDecoration: "line-through" }}>Cancel leg in MAS</h3>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
                  <div style={{
                    width: 32, height: 32, borderRadius: "50%", background: "var(--cc-blue-bg)",
                    color: "var(--cc-blue-fg)", display: "flex", alignItems: "center", justifyContent: "center",
                    fontWeight: 600, fontSize: 15, border: "1px solid var(--cc-blue-border)"
                  }}>2</div>
                  <h3 style={{ fontSize: 18, margin: 0, fontWeight: 600 }}>Now re-attest the invoice</h3>
                </div>

                <div style={{ 
                  background: "var(--cc-card)", border: "1px solid var(--cc-border)", 
                  borderRadius: 12, overflow: "hidden", marginBottom: 24,
                  boxShadow: "0 2px 8px rgba(0,0,0,0.04)"
                }}>
                  <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--cc-border)", background: "var(--cc-muted)" }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: "var(--cc-fg)" }}>Surviving legs to re-attest</div>
                  </div>
                  <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                    {b.legs.filter(l => l.outcome !== "Denied").map((leg, i, arr) => (
                      <li key={leg.id} style={{
                        display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 20px",
                        borderBottom: i < arr.length - 1 ? "1px solid var(--cc-border)" : undefined,
                      }}>
                        <span className="mono" style={{ fontWeight: 500 }}>{leg.id}</span>
                        <span className="cc-tag">{leg.outcome}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <button 
                  className="cc-btn cc-btn-primary" 
                  style={{ width: "100%", justifyContent: "center", padding: "12px", fontSize: 15 }}
                >
                  Re-attestation confirmed in MAS
                </button>
                <div style={{ textAlign: "center", marginTop: 12 }}>
                  <button className="cc-btn cc-btn-ghost" style={{ fontSize: 13, color: "var(--cc-muted-fg)" }}>
                    Add optional notes
                  </button>
                </div>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
