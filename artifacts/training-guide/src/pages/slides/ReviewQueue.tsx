import { AppSidebar, Browser, Callout, SlideShell, StatusPill } from "@/components/slide-ui";

export default function ReviewQueue() {
  return (
    <SlideShell
      step={5}
      totalSteps={24}
      title="The Queue Page: Two Cards, Two Jobs"
      subtitle="Two cards sit side by side at the top of the Queue. Classification Inbox holds brand-new groups that need an error type. Responses Awaiting Review holds payor replies that need a human verdict."
    >
      <div style={{ flex: 1.5 }}>
        <Browser url="/queue">
          <div className="flex h-full">
            <AppSidebar active="queue" />
            <div className="flex-1 bg-bg flex" style={{ padding: "1.2vh 1vw", gap: "0.8vw" }}>
              <div className="bg-white rounded-[0.5vw] border border-primary/10 flex-1 flex flex-col" style={{ padding: "1vh 0.8vw" }}>
                <div className="flex items-center justify-between" style={{ marginBottom: "0.3vh" }}>
                  <p className="font-display text-primary font-bold" style={{ fontSize: "0.95vw" }}>Classification Inbox</p>
                  <span className="bg-orange/15 text-orange rounded-full font-display font-bold" style={{ padding: "0.15vh 0.55vw", fontSize: "0.7vw" }}>14</span>
                </div>
                <p className="font-body text-muted" style={{ fontSize: "0.65vw", lineHeight: "1.4" }}>Stage 1 — fresh uploads with no error type yet. Read the raw payor error and pick what's wrong.</p>
                <div style={{ marginTop: "0.7vh" }} className="space-y-[0.4vh] flex-1">
                  {[
                    { inv: "INV-89421", rides: 4, amt: "$268", err: '"Member name mismatch"', sel: true },
                    { inv: "INV-89418", rides: 1, amt: "$62", err: '"GPS out of range"' },
                    { inv: "INV-89414", rides: 6, amt: "$391", err: '"Missing signature"' },
                    { inv: "INV-89409", rides: 2, amt: "$148", err: '"Service date outside auth"' },
                  ].map((g) => (
                    <div key={g.inv} className={`rounded-[0.4vw] border ${g.sel ? "border-accent bg-accent/5" : "border-primary/10"}`} style={{ padding: "0.6vh 0.55vw" }}>
                      <div className="flex items-center justify-between">
                        <span className="font-mono font-semibold text-primary" style={{ fontSize: "0.72vw" }}>{g.inv}</span>
                        <StatusPill label="Needs Review" kind="amber" />
                      </div>
                      <div className="flex items-center justify-between" style={{ marginTop: "0.2vh" }}>
                        <span className="font-body text-muted" style={{ fontSize: "0.6vw" }}>{g.rides} rides · {g.amt}</span>
                      </div>
                      <p className="font-body text-muted" style={{ fontSize: "0.6vw", marginTop: "0.2vh", lineHeight: "1.3" }}>{g.err}</p>
                    </div>
                  ))}
                </div>
                <button className="bg-orange text-white font-display font-semibold rounded-[0.4vw] w-full" style={{ padding: "0.7vh 0", fontSize: "0.78vw", marginTop: "0.7vh" }}>Classify INV-89421 →</button>
              </div>

              <div className="bg-white rounded-[0.5vw] border border-primary/10 flex-1 flex flex-col" style={{ padding: "1vh 0.8vw" }}>
                <div className="flex items-center justify-between" style={{ marginBottom: "0.3vh" }}>
                  <p className="font-display text-primary font-bold" style={{ fontSize: "0.95vw" }}>Responses Awaiting Review</p>
                  <span className="bg-accent/15 text-accent rounded-full font-display font-bold" style={{ padding: "0.15vh 0.55vw", fontSize: "0.7vw" }}>5</span>
                </div>
                <p className="font-body text-muted" style={{ fontSize: "0.65vw", lineHeight: "1.4" }}>Stage 2 — payor wrote back, AI tagged it. You pick the verdict (continuation or closure).</p>
                <div style={{ marginTop: "0.7vh" }} className="space-y-[0.4vh] flex-1">
                  {[
                    { inv: "CC-2026-04-1138", amt: "$68", hint: "Denial · 87%", kind: "red" as const },
                    { inv: "CC-2026-04-1131", amt: "$92", hint: "Approval · 71%", kind: "green" as const },
                    { inv: "CC-2026-04-1112", amt: "$71", hint: "Info Request", kind: "blue" as const },
                    { inv: "CC-2026-04-1098", amt: "$118", hint: "Partial · 64%", kind: "amber" as const },
                  ].map((r) => (
                    <div key={r.inv} className="rounded-[0.4vw] border border-primary/10" style={{ padding: "0.6vh 0.55vw" }}>
                      <div className="flex items-center justify-between">
                        <span className="font-mono font-semibold text-primary" style={{ fontSize: "0.72vw" }}>{r.inv}</span>
                        <StatusPill label="Needs Review" kind="amber" />
                      </div>
                      <div className="flex items-center justify-between" style={{ marginTop: "0.2vh" }}>
                        <span className="font-body text-muted" style={{ fontSize: "0.6vw" }}>{r.amt}</span>
                        <StatusPill label={`AI hint: ${r.hint}`} kind={r.kind} />
                      </div>
                    </div>
                  ))}
                </div>
                <button className="bg-accent text-white font-display font-semibold rounded-[0.4vw] w-full" style={{ padding: "0.7vh 0", fontSize: "0.78vw", marginTop: "0.7vh" }}>Pick verdict →</button>
              </div>
            </div>
          </div>
        </Browser>
      </div>
      <div className="flex flex-col gap-[1vh]" style={{ flex: 1 }}>
        <Callout number="1" title="Left card = brand-new work" body="Classification Inbox holds invoice groups that just landed. They have no error type yet — your job is to read the raw payor error and pick the matching Error Type." />
        <Callout number="2" title="Right card = payor wrote back" body="Responses Awaiting Review holds claims where the payor replied to a dispute we already filed. AI tagged each one with a hint, but the row stays on Needs Review until a human picks the verdict." color="orange" />
        <Callout number="3" title="The AI hint never decides" body="Even if the hint says 'Approval · 87%', the row still waits for a human. Approvals need re-attestation; denials might be re-disputable; info requests need a reply. Always click in." color="primary" />
        <Callout number="4" title="One card, one mental task" body="Don't mix them up. Classification Inbox = pick the error type. Responses Awaiting Review = pick the verdict (Re-dispute, Re-attest, Submit New Invoice, or Denied by Payor). Different jobs, different surfaces." />
      </div>
    </SlideShell>
  );
}
