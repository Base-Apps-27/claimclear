import { Browser, Callout, SlideShell } from "@/components/slide-ui";

export default function WorkflowPlayer() {
  return (
    <SlideShell
      step={7}
      totalSteps={22}
      title="Follow the Guided Workflow"
      subtitle="Each error type has its own decision tree. Just answer the questions — ClaimClear figures out where the claim should go."
    >
      <div style={{ flex: 1.5 }}>
        <Browser url="/queue">
          <div className="bg-bg h-full" style={{ padding: "2vh 1.5vw" }}>
            <div className="bg-white rounded-[0.7vw] border border-primary/10" style={{ padding: "1.8vh 1.5vw" }}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-mono font-bold text-primary" style={{ fontSize: "1.1vw" }}>INV-89384</p>
                  <p className="font-body text-muted" style={{ fontSize: "0.8vw" }}>GPS Out of Range · 6 rides · $412</p>
                </div>
                <button className="bg-accent text-white font-display font-semibold rounded-[0.4vw]" style={{ padding: "0.7vh 1vw", fontSize: "0.8vw" }}>Open Full Details →</button>
              </div>

              <div className="bg-bg rounded-[0.5vw]" style={{ padding: "1.5vh 1.2vw", marginTop: "1.5vh" }}>
                <div className="flex items-center gap-[0.5vw]" style={{ marginBottom: "0.6vh" }}>
                  <span className="bg-accent text-white font-display font-bold rounded-full inline-flex items-center justify-center" style={{ width: "1.5vw", height: "1.5vw", fontSize: "0.85vw" }}>1</span>
                  <p className="font-body text-muted uppercase tracking-wider font-semibold" style={{ fontSize: "0.7vw" }}>Step 1 of 3</p>
                </div>
                <p className="font-display text-primary font-bold" style={{ fontSize: "1.15vw" }}>Did the driver actually arrive at the pickup address?</p>
                <p className="font-body text-muted" style={{ fontSize: "0.85vw", marginTop: "0.4vh" }}>Check the GPS log against the authorized pickup. If it's within 0.25 miles, MAS's "out of range" claim is wrong.</p>
                <div className="grid grid-cols-3 gap-[0.6vw]" style={{ marginTop: "1.2vh" }}>
                  <button className="bg-[#16A34A] text-white font-display font-semibold rounded-[0.4vw]" style={{ padding: "1.2vh 0.5vw", fontSize: "0.85vw" }}>Yes — within range</button>
                  <button className="bg-white border border-primary/20 text-primary font-display font-semibold rounded-[0.4vw]" style={{ padding: "1.2vh 0.5vw", fontSize: "0.85vw" }}>No — was off-route</button>
                  <button className="bg-white border border-primary/20 text-primary font-display font-semibold rounded-[0.4vw]" style={{ padding: "1.2vh 0.5vw", fontSize: "0.85vw" }}>Can't tell — no GPS</button>
                </div>
              </div>

              <div className="flex items-center gap-[0.5vw]" style={{ marginTop: "1vh" }}>
                <div className="flex-1 h-[0.4vh] bg-primary/10 rounded-full overflow-hidden">
                  <div className="bg-accent h-full" style={{ width: "33%" }} />
                </div>
                <span className="font-body text-muted" style={{ fontSize: "0.75vw" }}>1 of 3 answered</span>
              </div>

              <div className="bg-bg rounded-[0.5vw] flex items-center justify-between" style={{ padding: "0.8vh 1vw", marginTop: "1vh" }}>
                <div>
                  <p className="font-display text-primary font-semibold" style={{ fontSize: "0.78vw" }}>Quality Check</p>
                  <p className="font-body text-muted" style={{ fontSize: "0.7vw" }}>2 warnings · 0 fails — review before submitting</p>
                </div>
                <span className="bg-[#FEF3C7] text-[#92400E] rounded-full font-body font-semibold" style={{ padding: "0.2vh 0.6vw", fontSize: "0.65vw" }}>2 warn</span>
              </div>
            </div>
          </div>
        </Browser>
      </div>
      <div className="flex flex-col gap-[1.2vh]" style={{ flex: 1 }}>
        <Callout number="1" title="Read the question carefully" body="Each step tells you exactly what to look at — the GPS log, the signature, the auth file. The hint text under each question is your SOP." />
        <Callout number="2" title="Pick the answer that matches reality" body="Don't guess. If you can't tell, pick the 'unknown' branch — it routes the claim to On Hold so you can chase it later." color="orange" />
        <Callout number="3" title="The tree branches based on your answers" body="Different answers lead to different next steps. Sometimes 3 questions, sometimes 1. Just keep going until the tree ends." />
        <Callout number="4" title="Quality Check + Lint Gate catch problems before submit" body="Warnings (yellow) are flagged but you can proceed. Fails (red) block submission until you fix them — missing evidence, wrong amount format, expired window." color="primary" />
      </div>
    </SlideShell>
  );
}
