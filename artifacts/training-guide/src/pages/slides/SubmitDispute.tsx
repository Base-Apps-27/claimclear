import { Browser, Callout, SlideShell, StatusPill } from "@/components/slide-ui";

export default function SubmitDispute() {
  return (
    <SlideShell
      step={13}
      totalSteps={22}
      title="Send the Dispute to the Portal"
      subtitle="When data is right, evidence is attached, and the letter looks good — hand it off to the bot fleet."
      accent="orange"
    >
      <div style={{ flex: 1.4 }}>
        <Browser url="/claim/CC-2026-04-1138">
          <div className="bg-bg h-full" style={{ padding: "1.5vh 1.5vw" }}>
            <div className="bg-white rounded-[0.7vw] border border-primary/10" style={{ padding: "2vh 1.5vw" }}>
              <p className="font-display text-primary font-bold" style={{ fontSize: "1.2vw" }}>Ready to submit?</p>
              <p className="font-body text-muted" style={{ fontSize: "0.85vw", marginTop: "0.4vh" }}>The bot will file the dispute on the MAS portal using the data, evidence, and letter below.</p>
              <div className="bg-bg rounded-[0.5vw]" style={{ padding: "1.2vh 1.2vw", marginTop: "1.5vh" }}>
                <div className="flex items-center justify-between" style={{ marginBottom: "0.6vh" }}>
                  <p className="font-display text-primary font-semibold uppercase tracking-wider" style={{ fontSize: "0.7vw" }}>Quality Check (Lint Gate)</p>
                  <span className="bg-[#D1FAE5] text-[#065F46] rounded-full font-body font-semibold" style={{ padding: "0.2vh 0.6vw", fontSize: "0.6vw" }}>0 fails</span>
                </div>
                <div className="grid grid-cols-2 gap-[0.6vw]" style={{ fontSize: "0.78vw" }}>
                  <div className="flex items-center gap-[0.4vw]">
                    <span className="text-[#16A34A]">✓</span>
                    <span className="font-body text-primary">Confirmation # set</span>
                  </div>
                  <div className="flex items-center gap-[0.4vw]">
                    <span className="text-[#16A34A]">✓</span>
                    <span className="font-body text-primary">Error type assigned</span>
                  </div>
                  <div className="flex items-center gap-[0.4vw]">
                    <span className="text-[#16A34A]">✓</span>
                    <span className="font-body text-primary">3 evidence files attached</span>
                  </div>
                  <div className="flex items-center gap-[0.4vw]">
                    <span className="text-[#16A34A]">✓</span>
                    <span className="font-body text-primary">Dispute letter generated</span>
                  </div>
                  <div className="flex items-center gap-[0.4vw]">
                    <span className="text-[#16A34A]">✓</span>
                    <span className="font-body text-primary">Workflow completed</span>
                  </div>
                  <div className="flex items-center gap-[0.4vw]">
                    <span className="text-[#F4A23E]">!</span>
                    <span className="font-body text-primary">12 days left in window <span className="text-[#92400E]">(warn)</span></span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-[0.6vw]" style={{ marginTop: "1.5vh" }}>
                <button className="flex-1 bg-white border border-primary/20 text-primary font-display font-semibold rounded-[0.4vw]" style={{ padding: "1vh 1vw", fontSize: "0.85vw" }}>Generate Preview (Dry Run)</button>
                <button className="flex-1 bg-orange text-white font-display font-semibold rounded-[0.4vw]" style={{ padding: "1vh 1vw", fontSize: "0.9vw" }}>Send to Portal Queue</button>
              </div>
              <p className="font-body text-muted text-center" style={{ fontSize: "0.7vw", marginTop: "1vh" }}>Status will change: Ready to Review → Portal Queued</p>
              <div className="flex items-center justify-center gap-[0.5vw]" style={{ marginTop: "0.6vh" }}>
                <StatusPill label="Ready to Review" kind="amber" />
                <span className="text-muted" style={{ fontSize: "1vw" }}>→</span>
                <StatusPill label="Portal Queued" kind="blue" />
              </div>
            </div>
          </div>
        </Browser>
      </div>
      <div className="flex flex-col gap-[1.2vh]" style={{ flex: 1 }}>
        <Callout number="1" title="Lint Gate must be all green to ship" body="Yellow warnings don't block (e.g. tight deadline). Red fails block — you can't send to portal until they're cleared." color="orange" />
        <Callout number="2" title="Generate Preview (Dry Run) first" body="Renders a screenshot of what the bot would submit, without actually filing. Use it the first few times you process a new error type." />
        <Callout number="3" title="Send to Portal Queue = ship it" body="Status flips to Portal Queued. The next available bot picks it up — usually within 5 minutes." color="primary" />
        <Callout number="4" title="After submit: hands off" body="You're done until the payor responds. Move on to the next one in your queue." />
      </div>
    </SlideShell>
  );
}
