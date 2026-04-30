import { AppSidebar, Browser, Callout, SlideShell, StatusPill } from "@/components/slide-ui";

const ROWS = [
  { inv: "INV-89388", reason: "Cannot Dispute", kind: "orange" as const, amt: "$184", who: "Maria R.", days: "2d" },
  { inv: "INV-89372", reason: "Non-Issue", kind: "muted" as const, amt: "$62", who: "Jordan T.", days: "3d" },
  { inv: "INV-89351", reason: "Accepted Loss", kind: "red" as const, amt: "$94", who: "—", days: "5d" },
  { inv: "INV-89344", reason: "Cannot Dispute", kind: "orange" as const, amt: "$220", who: "—", days: "6d" },
];

export default function WithdrawalsReview() {
  return (
    <SlideShell
      step={18}
      totalSteps={24}
      title="Withdrawals Review: Where Closures Land"
      subtitle="Every claim or group closed as Cannot Dispute, Non-Issue, or Accepted Loss shows up here for supervisor sign-off. Capture lessons learned, confirm who was told, then mark Addressed."
      accent="orange"
    >
      <div style={{ flex: 1.5 }}>
        <Browser url="/withdrawals">
          <div className="flex h-full">
            <AppSidebar active="claims" />
            <div className="flex-1 bg-bg" style={{ padding: "1.5vh 1.2vw" }}>
              <div className="flex items-center justify-between" style={{ marginBottom: "0.8vh" }}>
                <div>
                  <p className="font-display text-primary font-bold" style={{ fontSize: "1.1vw" }}>Withdrawals</p>
                  <p className="font-body text-muted" style={{ fontSize: "0.7vw", marginTop: "0.2vh" }}>14 closures awaiting review · capture lessons learned and confirm who was told</p>
                </div>
                <button className="bg-accent text-white font-display font-semibold rounded-[0.4vw]" style={{ padding: "0.5vh 1vw", fontSize: "0.75vw" }}>Mark Addressed (2)</button>
              </div>
              <div className="bg-white rounded-[0.5vw] border border-primary/10" style={{ padding: "0.7vh 0" }}>
                <div className="grid grid-cols-[0.3fr_1fr_1fr_0.7fr_1fr_0.5fr] items-center font-body text-muted uppercase tracking-wider border-b border-primary/10" style={{ padding: "0.5vh 0.8vw", fontSize: "0.6vw" }}>
                  <span></span>
                  <span>Invoice</span>
                  <span>Reason</span>
                  <span>Amount</span>
                  <span>Communicated to</span>
                  <span>Closed</span>
                </div>
                {ROWS.map((r, i) => (
                  <div key={r.inv} className="grid grid-cols-[0.3fr_1fr_1fr_0.7fr_1fr_0.5fr] items-center border-b border-primary/5" style={{ padding: "0.7vh 0.8vw" }}>
                    <input type="checkbox" defaultChecked={i < 2} className="accent-accent" style={{ width: "0.7vw", height: "0.7vw" }} />
                    <span className="font-mono font-semibold text-primary" style={{ fontSize: "0.75vw" }}>{r.inv}</span>
                    <span><StatusPill label={r.reason} kind={r.kind} /></span>
                    <span className="font-display text-primary font-bold" style={{ fontSize: "0.8vw" }}>{r.amt}</span>
                    <span className="font-body text-primary" style={{ fontSize: "0.75vw" }}>{r.who}</span>
                    <span className="font-body text-muted" style={{ fontSize: "0.7vw" }}>{r.days}</span>
                  </div>
                ))}
              </div>
              <div className="bg-white rounded-[0.5vw] border border-accent/30" style={{ padding: "1.2vh 1vw", marginTop: "1vh" }}>
                <div className="flex items-center justify-between" style={{ marginBottom: "0.6vh" }}>
                  <p className="font-display text-primary font-bold" style={{ fontSize: "0.9vw" }}>Review INV-89388</p>
                  <StatusPill label="Cannot Dispute" kind="orange" />
                </div>
                <div className="grid grid-cols-2 gap-[0.7vw]">
                  <div>
                    <p className="font-body text-muted uppercase tracking-wider" style={{ fontSize: "0.6vw" }}>Communicated to</p>
                    <div className="bg-bg border border-primary/10 rounded-[0.3vw]" style={{ padding: "0.5vh 0.6vw", marginTop: "0.3vh" }}>
                      <p className="font-body text-primary" style={{ fontSize: "0.75vw" }}>Maria R. (dispatcher) — Slack 4/28</p>
                    </div>
                  </div>
                  <div>
                    <p className="font-body text-muted uppercase tracking-wider" style={{ fontSize: "0.6vw" }}>Review notes / lessons learned</p>
                    <div className="bg-bg border border-primary/10 rounded-[0.3vw]" style={{ padding: "0.5vh 0.6vw", marginTop: "0.3vh" }}>
                      <p className="font-body text-primary" style={{ fontSize: "0.72vw", lineHeight: "1.4" }}>Auth expired 3 days before service. Confirmed with auth team — re-auth was filed late. Coaching note sent to dispatch.</p>
                    </div>
                  </div>
                </div>
                <div className="flex justify-end" style={{ marginTop: "0.8vh" }}>
                  <button className="bg-[#16A34A] text-white font-display font-semibold rounded-[0.4vw]" style={{ padding: "0.5vh 1vw", fontSize: "0.75vw" }}>Mark Addressed</button>
                </div>
              </div>
            </div>
          </div>
        </Browser>
      </div>
      <div className="flex flex-col gap-[1.2vh]" style={{ flex: 1 }}>
        <Callout number="1" title="Three closure exits land here" body="Cannot Dispute, Non-Issue, and Accepted Loss all funnel into Withdrawals. Denied (payor said no) doesn't — it stays on the claim until you decide what to do." color="orange" />
        <Callout number="2" title="Open the side panel to capture context" body="Every closure deserves a 'Communicated to' (driver, dispatcher, supervisor) and a 'Review notes / lessons learned' so the next person sees why we walked away." />
        <Callout number="3" title="Mark Addressed when sign-off is done" body="Addressed flips the row green and writes a 'closure_addressed' entry to the activity feed with the communicated-to and review notes baked in. Use bulk select for routine sign-off." color="primary" />
        <Callout number="4" title="Hide-addressed is on by default" body="Toggle it off when you need to audit historical closures or revisit a row. The CSV export respects whatever filters you've set." />
      </div>
    </SlideShell>
  );
}
