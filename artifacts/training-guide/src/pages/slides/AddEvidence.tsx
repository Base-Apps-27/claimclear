import { Browser, Callout, SlideShell } from "@/components/slide-ui";

const EVIDENCE = [
  { name: "gps-log-2026-04-14.pdf", type: "GPS Log", size: "412 KB" },
  { name: "signature-page.png", type: "Signature", size: "84 KB" },
  { name: "auth-snapshot.pdf", type: "Authorization", size: "126 KB" },
];

export default function AddEvidence() {
  return (
    <SlideShell
      step={10}
      totalSteps={22}
      title="Attach Evidence"
      subtitle="Most disputes need proof: GPS logs, signed trip sheets, authorization screenshots. Drag them onto the claim — the bot uploads them with the dispute."
    >
      <div style={{ flex: 1.4 }}>
        <Browser url="/claim/CC-2026-04-1138">
          <div className="bg-bg h-full" style={{ padding: "1.5vh 1.5vw" }}>
            <div className="bg-white rounded-[0.7vw] border border-primary/10" style={{ padding: "1.5vh 1.2vw" }}>
              <div className="flex items-center justify-between" style={{ marginBottom: "1vh" }}>
                <div>
                  <p className="font-display text-primary font-bold" style={{ fontSize: "1.1vw" }}>Evidence (3 files)</p>
                  <p className="font-body text-muted" style={{ fontSize: "0.75vw" }}>PDFs and images up to 10 MB each</p>
                </div>
                <button className="bg-accent text-white font-display font-semibold rounded-[0.4vw]" style={{ padding: "0.6vh 1vw", fontSize: "0.8vw" }}>+ Add Evidence</button>
              </div>
              <div className="space-y-[0.5vh]">
                {EVIDENCE.map((e) => (
                  <div key={e.name} className="bg-bg rounded-[0.4vw] border border-primary/10 flex items-center gap-[0.8vw]" style={{ padding: "0.8vh 0.8vw" }}>
                    <div className="bg-orange/15 rounded-[0.3vw] flex items-center justify-center" style={{ width: "1.6vw", height: "1.6vw" }}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="#E85D3A" strokeWidth="2" style={{ width: "0.9vw", height: "0.9vw" }}>
                        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                        <polyline points="14 2 14 8 20 8" />
                      </svg>
                    </div>
                    <div className="flex-1">
                      <p className="font-display text-primary font-semibold" style={{ fontSize: "0.85vw" }}>{e.name}</p>
                      <p className="font-body text-muted" style={{ fontSize: "0.7vw" }}>{e.type} · {e.size}</p>
                    </div>
                    <span className="font-body text-accent font-semibold" style={{ fontSize: "0.75vw" }}>Preview</span>
                    <span className="font-body text-[#DC2626] font-semibold" style={{ fontSize: "0.75vw" }}>Remove</span>
                  </div>
                ))}
                <div className="border-2 border-dashed border-primary/20 rounded-[0.4vw] text-center" style={{ padding: "1.5vh 1vw" }}>
                  <p className="font-body text-muted" style={{ fontSize: "0.85vw" }}>Drop files here to attach</p>
                </div>
              </div>
            </div>
          </div>
        </Browser>
      </div>
      <div className="flex flex-col gap-[1.2vh]" style={{ flex: 1 }}>
        <Callout number="1" title="Match evidence to the error type" body="GPS Out of Range → GPS log. Missing Signature → signature page. Out of Auth → authorization screenshot. The SOP card on the workflow tells you what's needed." />
        <Callout number="2" title="Drag and drop, or click Add Evidence" body="PDFs and images both work. The platform converts everything to PDF when it submits to MAS." color="orange" />
        <Callout number="3" title="Preview before you ship" body="Click Preview to make sure you uploaded the right page. A blank or wrong-claim file is the #1 reason disputes get re-denied." color="primary" />
        <Callout number="4" title="No evidence? On Hold instead" body="If you can't get the file from dispatch or the driver, place the claim On Hold with a note. Submitting empty almost always loses." />
      </div>
    </SlideShell>
  );
}
