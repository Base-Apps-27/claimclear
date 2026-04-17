import { AppSidebar, Browser, Callout, SlideShell, StatusPill } from "@/components/slide-ui";

export default function ClaimDetailTour() {
  return (
    <SlideShell
      step={8}
      totalSteps={22}
      title="The Claim Detail Page"
      subtitle="Click 'Open Full Details' to see everything about a single claim. This is the deepest view in the platform."
    >
      <div style={{ flex: 1.6 }}>
        <Browser url="/claim/CC-2026-04-1138">
          <div className="flex h-full">
            <AppSidebar active="claims" />
            <div className="flex-1 bg-bg" style={{ padding: "1.2vh 1vw" }}>
              <div className="flex items-center gap-[0.5vw]" style={{ marginBottom: "0.5vh" }}>
                <span className="font-body text-muted" style={{ fontSize: "0.7vw" }}>← Work Queue</span>
              </div>
              <div className="bg-[#FEF3C7] border border-[#F4A23E]/30 rounded-[0.4vw] flex items-center gap-[0.5vw]" style={{ padding: "0.5vh 0.8vw", marginBottom: "0.6vh" }}>
                <div className="bg-[#F4A23E] rounded-full" style={{ width: "0.5vw", height: "0.5vw" }} />
                <p className="font-body text-[#92400E]" style={{ fontSize: "0.7vw" }}>Maria Chen is also viewing this claim</p>
              </div>
              <div className="bg-white rounded-[0.5vw] border border-primary/10" style={{ padding: "1.2vh 1vw" }}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-[0.6vw]">
                    <p className="font-mono font-bold text-primary" style={{ fontSize: "1.2vw" }}>CC-2026-04-1138</p>
                    <StatusPill label="Needs Evidence" kind="orange" />
                  </div>
                  <button className="bg-accent text-white font-display font-semibold rounded-[0.4vw]" style={{ padding: "0.5vh 0.8vw", fontSize: "0.75vw" }}>Edit</button>
                </div>
              </div>
              <div className="flex gap-[0.6vw]" style={{ marginTop: "0.8vh" }}>
                <div className="space-y-[0.5vh]" style={{ width: "62%" }}>
                  <div className="bg-white rounded-[0.5vw] border border-primary/10" style={{ padding: "0.9vh 0.8vw" }}>
                    <p className="font-display text-primary font-bold" style={{ fontSize: "0.85vw" }}>Claim Details</p>
                    <div className="grid grid-cols-3 gap-[0.5vw]" style={{ marginTop: "0.5vh" }}>
                      {["Conf #", "Date", "Client", "Car", "Amount", "Ref #"].map((l) => (
                        <div key={l}>
                          <p className="font-body text-muted uppercase" style={{ fontSize: "0.55vw" }}>{l}</p>
                          <p className="font-display text-primary font-semibold" style={{ fontSize: "0.7vw" }}>—</p>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="bg-white rounded-[0.5vw] border border-primary/10" style={{ padding: "0.9vh 0.8vw" }}>
                    <p className="font-display text-primary font-bold" style={{ fontSize: "0.85vw" }}>Error from MAS</p>
                    <p className="font-body text-muted" style={{ fontSize: "0.7vw" }}>GPS log shows pickup 0.8 mi from authorized location</p>
                  </div>
                  <div className="bg-white rounded-[0.5vw] border border-primary/10" style={{ padding: "0.9vh 0.8vw" }}>
                    <p className="font-display text-primary font-bold" style={{ fontSize: "0.85vw" }}>Evidence (0)</p>
                    <p className="font-body text-muted" style={{ fontSize: "0.7vw" }}>Drag files here or click Add Evidence</p>
                  </div>
                  <div className="bg-white rounded-[0.5vw] border border-primary/10" style={{ padding: "0.9vh 0.8vw" }}>
                    <p className="font-display text-primary font-bold" style={{ fontSize: "0.85vw" }}>AI Dispute Letter</p>
                    <p className="font-body text-muted" style={{ fontSize: "0.7vw" }}>Auto-generated for the assigned error type</p>
                  </div>
                </div>
                <div className="space-y-[0.5vh]" style={{ width: "38%" }}>
                  <div className="bg-white rounded-[0.5vw] border border-primary/10" style={{ padding: "0.9vh 0.8vw" }}>
                    <p className="font-display text-primary font-bold" style={{ fontSize: "0.85vw" }}>Notes</p>
                    <p className="font-body text-muted" style={{ fontSize: "0.7vw" }}>Internal team comments</p>
                  </div>
                  <div className="bg-white rounded-[0.5vw] border border-primary/10" style={{ padding: "0.9vh 0.8vw" }}>
                    <p className="font-display text-primary font-bold" style={{ fontSize: "0.85vw" }}>Audit Trail</p>
                    <p className="font-body text-muted" style={{ fontSize: "0.7vw" }}>Every system action, in order</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Browser>
      </div>
      <div className="flex flex-col gap-[1vh]" style={{ flex: 1 }}>
        <Callout number="1" title="Top banner: who else is here" body="If a teammate is also viewing this claim, you'll see their name. Don't both edit at once — talk to them first." />
        <Callout number="2" title="Header: ID + status + Edit button" body="Click Edit to turn the data fields into editable inputs. The status badge tells you what stage the claim is in." color="orange" />
        <Callout number="3" title="Left column: the claim itself" body="Details, error from MAS, evidence files, and the AI-generated dispute letter — top to bottom in order of importance." />
        <Callout number="4" title="Right column: the conversation" body="Notes is for your team. Audit Trail is the system's read-only history. Both are timestamped." color="primary" />
      </div>
    </SlideShell>
  );
}
