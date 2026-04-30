import { Browser, Callout, SlideShell, StatusPill } from "@/components/slide-ui";

export default function TriageNonIssue() {
  return (
    <SlideShell
      step={4}
      totalSteps={22}
      title='The "Non-Issue" Path'
      subtitle="When the rejection is a data quirk, a duplicate, or already paid — close it out cleanly so it stops cluttering the queue."
      accent="orange"
    >
      <div style={{ flex: 1.3 }}>
        <Browser url="/review">
          <div className="bg-bg h-full" style={{ padding: "2vh 2vw" }}>
            <div className="bg-white rounded-[0.7vw] border border-primary/10" style={{ padding: "2vh 2vw" }}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-display text-primary font-bold" style={{ fontSize: "1.3vw" }}>Resolve INV-89421 as Non-Issue</p>
                  <p className="font-body text-muted" style={{ fontSize: "0.95vw", marginTop: "0.4vh" }}>4 rides will be marked Resolved with $0 financial impact</p>
                </div>
                <StatusPill label="Needs Review" kind="amber" size="md" />
              </div>
              <div className="bg-bg rounded-[0.5vw] border border-primary/10" style={{ padding: "1.5vh 1.2vw", marginTop: "2vh" }}>
                <div className="flex items-center justify-between" style={{ marginBottom: "0.8vh" }}>
                  <p className="font-display text-primary font-semibold" style={{ fontSize: "0.95vw" }}>Reason (required)</p>
                  <span className="font-mono text-muted" style={{ fontSize: "0.7vw" }}>closure_reason: non_issue</span>
                </div>
                <div className="bg-white border border-primary/15 rounded-[0.4vw]" style={{ padding: "1vh 0.8vw" }}>
                  <p className="font-body text-primary" style={{ fontSize: "0.85vw" }}>Already paid by payor in the prior cycle — confirmed in remittance file 2026-04-12.</p>
                </div>
              </div>
              <div className="flex justify-end gap-[0.8vw]" style={{ marginTop: "2vh" }}>
                <button className="bg-white border border-primary/20 text-primary font-display font-semibold rounded-[0.4vw]" style={{ padding: "1vh 1.5vw", fontSize: "0.85vw" }}>Cancel</button>
                <button className="bg-[#16A34A] text-white font-display font-semibold rounded-[0.4vw]" style={{ padding: "1vh 1.5vw", fontSize: "0.85vw" }}>Confirm Non-Issue</button>
              </div>
            </div>

            <div className="bg-[#16A34A]/10 rounded-[0.5vw]" style={{ padding: "1.2vh 1.2vw", marginTop: "2vh" }}>
              <p className="font-body text-[#065F46] font-semibold" style={{ fontSize: "0.9vw" }}>After confirming: all 4 rides → Resolved · group removed from Review Queue</p>
            </div>
          </div>
        </Browser>
      </div>
      <div className="flex flex-col gap-[1.2vh]" style={{ flex: 1 }}>
        <Callout number="1" title="Click Non-Issue" body='From the Classify screen, the green "Non-Issue (Resolve)" button opens the confirm dialog.' color="primary" />
        <Callout number="2" title="Write a real reason" body="One sentence is fine, but be specific. It's stamped to the Activity Feed forever as closure_reason: non_issue." color="orange" />
        <Callout number="3" title="Confirm to close at $0" body="All rides in the group flip to Resolved. No money is recorded as recovered or lost." />
        <div className="bg-orange/10 border border-orange/30 rounded-[0.7vw]" style={{ padding: "1vh 1vw" }}>
          <p className="font-display text-orange font-bold" style={{ fontSize: "0.95vw" }}>When in doubt — don't</p>
          <p className="font-body text-primary" style={{ fontSize: "0.85vw", marginTop: "0.3vh" }}>If you can't articulate why it's a non-issue in one sentence, treat it as Issue Found instead. You can always change your mind later from the group detail page.</p>
        </div>
      </div>
    </SlideShell>
  );
}
