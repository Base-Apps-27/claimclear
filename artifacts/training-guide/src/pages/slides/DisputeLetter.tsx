import { Browser, Callout, SlideShell } from "@/components/slide-ui";

export default function DisputeLetter() {
  return (
    <SlideShell
      step={11}
      totalSteps={22}
      title="Review the AI Dispute Letter"
      subtitle="ClaimClear writes a tailored dispute letter for every claim using the error type, the claim data, and the evidence you attached. Read it before you submit."
    >
      <div style={{ flex: 1.5 }}>
        <Browser url="/claim/CC-2026-04-1138">
          <div className="bg-bg h-full" style={{ padding: "1.5vh 1.5vw" }}>
            <div className="bg-white rounded-[0.7vw] border border-primary/10" style={{ padding: "1.5vh 1.5vw" }}>
              <div className="flex items-center justify-between" style={{ marginBottom: "1vh" }}>
                <div className="flex items-center gap-[0.5vw]">
                  <div className="bg-accent/15 rounded-[0.3vw] flex items-center justify-center" style={{ width: "1.6vw", height: "1.6vw" }}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="#3478F6" strokeWidth="2" style={{ width: "1vw", height: "1vw" }}><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>
                  </div>
                  <div>
                    <p className="font-display text-primary font-bold" style={{ fontSize: "1.05vw" }}>AI Dispute Letter</p>
                    <p className="font-body text-muted" style={{ fontSize: "0.7vw" }}>Generated for: GPS Out of Range</p>
                  </div>
                </div>
                <div className="flex gap-[0.4vw]">
                  <button className="bg-white border border-primary/20 text-primary font-display font-semibold rounded-[0.4vw]" style={{ padding: "0.5vh 0.8vw", fontSize: "0.75vw" }}>Regenerate</button>
                  <button className="bg-white border border-primary/20 text-primary font-display font-semibold rounded-[0.4vw]" style={{ padding: "0.5vh 0.8vw", fontSize: "0.75vw" }}>Edit Text</button>
                </div>
              </div>
              <div className="bg-bg rounded-[0.4vw]" style={{ padding: "1.5vh 1.2vw" }}>
                <p className="font-body text-primary" style={{ fontSize: "0.82vw", lineHeight: "1.55" }}>
                  To Whom It May Concern,
                  <br /><br />
                  We are disputing the denial of confirmation <span className="font-mono font-semibold">CC-2026-04-1138</span> for member <span className="font-mono">MA-7782319</span> on <span className="font-semibold">04/14/2026</span> in the amount of <span className="font-semibold">$68.50</span>.
                  <br /><br />
                  The denial reason cited "GPS log shows pickup 0.8 mi from authorized location." The attached GPS evidence (gps-log-2026-04-14.pdf) shows the driver completed pickup at <span className="font-mono">40.7128, -74.0061</span>, which is within 0.18 miles of the authorized pickup address on file. The 0.8-mile reading reflects a momentary signal drift recorded mid-route, not the pickup location.
                  <br /><br />
                  In addition, the signed trip sheet (signature-page.png) confirms the member was transported to the correct destination on time. We respectfully request the original denial be overturned and the claim approved for payment.
                </p>
              </div>
              <div className="flex items-center gap-[0.5vw]" style={{ marginTop: "1vh" }}>
                <input type="checkbox" defaultChecked />
                <span className="font-body text-primary" style={{ fontSize: "0.8vw" }}>Use this letter when submitting to portal</span>
              </div>
            </div>
          </div>
        </Browser>
      </div>
      <div className="flex flex-col gap-[1.2vh]" style={{ flex: 1 }}>
        <Callout number="1" title="It writes itself" body="As soon as you assign an error type and attach evidence, the letter generates. Open the AI Dispute Letter card to read it." />
        <Callout number="2" title="Always read it once" body="The AI is good but not perfect. Look for: wrong dates, wrong amounts, missing context. If it cites evidence you didn't actually attach — fix it." color="orange" />
        <Callout number="3" title="Edit Text for one-off changes" body="If a specific case needs custom phrasing, click Edit Text. Your changes save with the claim." />
        <Callout number="4" title="Regenerate after big edits" body="If you change the error type, fix data, or add new evidence, click Regenerate to get a fresh letter." color="primary" />
      </div>
    </SlideShell>
  );
}
