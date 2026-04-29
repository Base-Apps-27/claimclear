import { Browser, Callout, SlideShell, StatusPill } from "@/components/slide-ui";

export default function HandlingResponse() {
  return (
    <SlideShell
      step={16}
      totalSteps={22}
      title="Handling the MAS Response"
      subtitle="When MAS replies, you'll see a banner on the claim with three choices. Pick the one that matches what MAS actually said."
      accent="orange"
    >
      <div style={{ flex: 1.4 }}>
        <Browser url="/claim/CC-2026-04-1138">
          <div className="bg-bg h-full" style={{ padding: "1.5vh 1.5vw" }}>
            <div className="bg-white rounded-[0.7vw] border border-primary/10" style={{ padding: "1.8vh 1.5vw" }}>
              <div className="flex items-center justify-between" style={{ marginBottom: "1vh" }}>
                <div className="flex items-center gap-[0.6vw]">
                  <p className="font-mono font-bold text-primary" style={{ fontSize: "1.1vw" }}>CC-2026-04-1138</p>
                  <StatusPill label="Denied" kind="red" />
                </div>
              </div>

              <div className="bg-[#FEE2E2] rounded-[0.5vw] border border-[#DC2626]/20" style={{ padding: "1.2vh 1.2vw" }}>
                <div className="flex items-center justify-between" style={{ marginBottom: "0.5vh" }}>
                  <div className="flex items-center gap-[0.5vw]">
                    <div className="bg-[#DC2626] rounded-full" style={{ width: "0.5vw", height: "0.5vw" }} />
                    <p className="font-display text-[#991B1B] font-bold" style={{ fontSize: "0.9vw" }}>Payor reply in Email Thread — denied</p>
                  </div>
                  <span className="font-body text-[#991B1B]" style={{ fontSize: "0.7vw" }}>Open thread →</span>
                </div>
                <p className="font-body text-[#991B1B]" style={{ fontSize: "0.8vw" }}>"Evidence insufficient. GPS pickup point exceeds tolerance. Trip sheet signature does not match member on file."</p>
              </div>

              <p className="font-display text-primary font-bold" style={{ fontSize: "1vw", marginTop: "1.5vh" }}>What now?</p>
              <div className="grid grid-cols-3 gap-[0.7vw]" style={{ marginTop: "0.8vh" }}>
                <div className="border border-[#DC2626]/30 bg-[#FEE2E2]/40 rounded-[0.5vw]" style={{ padding: "1.2vh 0.9vw" }}>
                  <p className="font-display text-[#991B1B] font-bold" style={{ fontSize: "0.9vw" }}>Accept as Loss</p>
                  <p className="font-body text-primary" style={{ fontSize: "0.72vw", marginTop: "0.4vh", lineHeight: "1.4" }}>Withdraw with reason "accepted_loss". Status → Resolved. Short note required.</p>
                  <button className="bg-[#DC2626] text-white font-display font-semibold rounded-[0.4vw] w-full" style={{ padding: "0.5vh 0", fontSize: "0.75vw", marginTop: "0.7vh" }}>Accept Loss</button>
                </div>
                <div className="border border-[#16A34A]/30 bg-[#D1FAE5]/40 rounded-[0.5vw]" style={{ padding: "1.2vh 0.9vw" }}>
                  <p className="font-display text-[#065F46] font-bold" style={{ fontSize: "0.9vw" }}>Submit New Invoice</p>
                  <p className="font-body text-primary" style={{ fontSize: "0.72vw", marginTop: "0.4vh", lineHeight: "1.4" }}>Re-bill under a new invoice with corrected info (e.g. fix the member name).</p>
                  <button className="bg-[#16A34A] text-white font-display font-semibold rounded-[0.4vw] w-full" style={{ padding: "0.5vh 0", fontSize: "0.75vw", marginTop: "0.7vh" }}>New Invoice</button>
                </div>
                <div className="border border-[#F4A23E]/30 bg-[#FEF3C7]/40 rounded-[0.5vw]" style={{ padding: "1.2vh 0.9vw" }}>
                  <p className="font-display text-[#92400E] font-bold" style={{ fontSize: "0.9vw" }}>Re-dispute</p>
                  <p className="font-body text-primary" style={{ fontSize: "0.72vw", marginTop: "0.4vh", lineHeight: "1.4" }}>Add stronger evidence and submit again. Resets to Needs Evidence.</p>
                  <button className="bg-[#F4A23E] text-white font-display font-semibold rounded-[0.4vw] w-full" style={{ padding: "0.5vh 0", fontSize: "0.75vw", marginTop: "0.7vh" }}>Re-dispute</button>
                </div>
              </div>
            </div>
          </div>
        </Browser>
      </div>
      <div className="flex flex-col gap-[1.2vh]" style={{ flex: 1 }}>
        <Callout number="1" title="Read the payor's exact response in Email Thread" body="The banner snippets the latest message; click 'Open thread' to see the full back-and-forth and reply directly to the payor." />
        <Callout number="2" title="Withdrawn vs Denied" body="'Denied' means the payor rejected us — closure_reason = payer_denied. 'Withdrawn' (Accept Loss, not contestable, non-issue) is when WE close it. Either way, a short note is required." color="orange" />
        <Callout number="3" title="Submit New Invoice fixes data problems" body="If the payor denied because of a member-name mismatch and you can re-bill correctly, this is the right call." />
        <Callout number="4" title="Re-dispute adds firepower" body="Pulled a better GPS log? Got a corrected signature? Re-dispute. Status goes back to Needs Evidence and you run the workflow again." color="primary" />
      </div>
    </SlideShell>
  );
}
