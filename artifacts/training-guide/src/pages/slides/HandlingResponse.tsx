import { Browser, Callout, SlideShell, StatusPill } from "@/components/slide-ui";

export default function HandlingResponse() {
  return (
    <SlideShell
      step={17}
      totalSteps={22}
      title="Handling the Payor Response"
      subtitle="A response landed. AI tagged it as a hint, the row sits in Responses Awaiting Review on the Queue page, and now it needs a human verdict."
      accent="orange"
    >
      <div style={{ flex: 1.4 }}>
        <Browser url="/claim/CC-2026-04-1138">
          <div className="bg-bg h-full" style={{ padding: "1.5vh 1.5vw" }}>
            <div className="bg-white rounded-[0.7vw] border border-primary/10" style={{ padding: "1.5vh 1.3vw" }}>
              <div className="flex items-center justify-between" style={{ marginBottom: "0.8vh" }}>
                <div className="flex items-center gap-[0.6vw]">
                  <p className="font-mono font-bold text-primary" style={{ fontSize: "1.1vw" }}>CC-2026-04-1138</p>
                  <StatusPill label="Needs Review" kind="amber" />
                </div>
                <span className="font-body text-muted" style={{ fontSize: "0.7vw" }}>$68.50 · GPS Out of Range</span>
              </div>

              <div className="bg-[#FEE2E2] rounded-[0.5vw] border border-[#DC2626]/20" style={{ padding: "1vh 1vw" }}>
                <div className="flex items-center justify-between" style={{ marginBottom: "0.4vh" }}>
                  <div className="flex items-center gap-[0.5vw]">
                    <div className="bg-[#DC2626] rounded-full" style={{ width: "0.5vw", height: "0.5vw" }} />
                    <p className="font-display text-[#991B1B] font-bold" style={{ fontSize: "0.85vw" }}>Payor reply received — needs your verdict</p>
                  </div>
                  <span className="bg-white text-[#991B1B] rounded-full font-display font-bold border border-[#DC2626]/30" style={{ padding: "0.15vh 0.55vw", fontSize: "0.65vw" }}>AI hint: Denial · 87%</span>
                </div>
                <p className="font-body text-[#991B1B]" style={{ fontSize: "0.78vw", lineHeight: "1.4" }}>"Evidence insufficient. GPS pickup point exceeds tolerance. Trip sheet signature does not match member on file."</p>
                <p className="font-body text-[#991B1B]" style={{ fontSize: "0.65vw", marginTop: "0.4vh" }}>Open Email Thread →</p>
              </div>

              <p className="font-display text-primary font-bold" style={{ fontSize: "0.95vw", marginTop: "1.3vh" }}>What's the verdict?</p>
              <p className="font-body text-muted" style={{ fontSize: "0.7vw", marginTop: "0.2vh" }}>The AI tag is just a suggestion. You pick the action.</p>

              <div style={{ marginTop: "0.9vh" }}>
                <p className="font-body text-muted uppercase tracking-wider" style={{ fontSize: "0.6vw" }}>Continuation</p>
                <div className="grid grid-cols-3 gap-[0.5vw]" style={{ marginTop: "0.4vh" }}>
                  <button className="border border-[#F4A23E]/40 bg-[#FEF3C7]/40 text-[#92400E] font-display font-semibold rounded-[0.4vw]" style={{ padding: "0.7vh 0", fontSize: "0.75vw" }}>Re-dispute</button>
                  <button className="border border-[#F4A23E]/40 bg-[#FEF3C7]/40 text-[#92400E] font-display font-semibold rounded-[0.4vw]" style={{ padding: "0.7vh 0", fontSize: "0.75vw" }}>Re-attest</button>
                  <button className="border border-[#16A34A]/40 bg-[#D1FAE5]/40 text-[#065F46] font-display font-semibold rounded-[0.4vw]" style={{ padding: "0.7vh 0", fontSize: "0.75vw" }}>Submit New Invoice</button>
                </div>
              </div>

              <div style={{ marginTop: "0.8vh" }}>
                <p className="font-body text-muted uppercase tracking-wider" style={{ fontSize: "0.6vw" }}>Closure</p>
                <div style={{ marginTop: "0.4vh" }}>
                  <button className="border border-[#DC2626]/40 bg-[#FEE2E2]/40 text-[#991B1B] font-display font-semibold rounded-[0.4vw] w-full" style={{ padding: "0.7vh 0", fontSize: "0.75vw" }}>Denied by Payor — close with structured intake</button>
                </div>
              </div>
            </div>
          </div>
        </Browser>
      </div>
      <div className="flex flex-col gap-[1.2vh]" style={{ flex: 1 }}>
        <Callout number="1" title="AI tags, you decide" body="Every payor reply gets auto-classified (approval / denial / partial / info_request / other). The tag is a hint — even an apparent approval still needs you to re-attest and confirm payment off-platform. Acknowledgments are the only exception: they don't change status." />
        <Callout number="2" title="Continuation = keep fighting" body="All three continuation buttons are interim today: each one routes the group back to Needs Evidence and writes a follow-up note explaining what to do next (re-dispute with stronger points, re-attest in MAS, or re-bill). Dedicated workflows for each are tracked separately." color="orange" />
        <Callout number="3" title="Closure here = Denied by Payor only" body="Stage 2 closures only have one reason: the payor formally rejected us. Cannot Dispute and Non-Issue belong to Stage 1 (before submission) — you can't pick them here." color="primary" />
        <Callout number="4" title="Find it in Responses Awaiting Review" body="Every claim with a fresh response surfaces on the Queue page's Responses Awaiting Review card. Pick the verdict from there or open the claim and use the same buttons." />
      </div>
    </SlideShell>
  );
}
