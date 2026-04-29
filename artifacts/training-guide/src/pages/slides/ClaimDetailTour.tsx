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
              <div className="bg-primary/5 border border-primary/15 rounded-[0.4vw] flex items-center justify-between gap-[0.5vw]" style={{ padding: "0.4vh 0.8vw", marginBottom: "0.5vh" }}>
                <div className="flex items-center gap-[0.5vw]">
                  <span className="font-body text-muted uppercase tracking-wider" style={{ fontSize: "0.55vw" }}>Invoice</span>
                  <span className="font-mono font-semibold text-primary" style={{ fontSize: "0.72vw" }}>INV-89384</span>
                </div>
                <span className="font-body text-muted" style={{ fontSize: "0.65vw" }}>4 rides · $285.75</span>
              </div>
              <div className="bg-accent/10 border border-accent/30 rounded-[0.4vw] flex items-center gap-[0.5vw]" style={{ padding: "0.4vh 0.8vw", marginBottom: "0.6vh" }}>
                <div className="bg-accent rounded-full animate-pulse" style={{ width: "0.5vw", height: "0.5vw" }} />
                <p className="font-body text-accent font-semibold" style={{ fontSize: "0.7vw" }}>Bot is filing this dispute now — edits are paused</p>
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
                    <p className="font-display text-primary font-bold" style={{ fontSize: "0.85vw" }}>Email Thread</p>
                    <p className="font-body text-muted" style={{ fontSize: "0.7vw" }}>Payor correspondence — read and reply inline</p>
                  </div>
                  <div className="bg-white rounded-[0.5vw] border border-primary/10" style={{ padding: "0.9vh 0.8vw" }}>
                    <p className="font-display text-primary font-bold" style={{ fontSize: "0.85vw" }}>Portal Submissions</p>
                    <p className="font-body text-muted" style={{ fontSize: "0.7vw" }}>Every bot run for this claim, with previews</p>
                  </div>
                  <div className="bg-white rounded-[0.5vw] border border-primary/10" style={{ padding: "0.9vh 0.8vw" }}>
                    <p className="font-display text-primary font-bold" style={{ fontSize: "0.85vw" }}>Notes</p>
                    <p className="font-body text-muted" style={{ fontSize: "0.7vw" }}>Internal team comments</p>
                  </div>
                  <div className="bg-white rounded-[0.5vw] border border-primary/10" style={{ padding: "0.9vh 0.8vw" }}>
                    <p className="font-display text-primary font-bold" style={{ fontSize: "0.85vw" }}>Activity Feed</p>
                    <p className="font-body text-muted" style={{ fontSize: "0.7vw" }}>Audit trail — every system action with metadata</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Browser>
      </div>
      <div className="flex flex-col gap-[1vh]" style={{ flex: 1 }}>
        <Callout number="1" title="Top: invoice strip + bot-presence banner" body="The invoice context strip stays pinned so you always know which group this ride belongs to. If a bot is filing right now, the orange banner appears and edits are paused." />
        <Callout number="2" title="Header: ID + status + Edit button" body="Click Edit to turn the data fields into editable inputs. The status badge tells you what stage the claim is in." color="orange" />
        <Callout number="3" title="Left column: the claim itself" body="Details, error from the payor, evidence files, and the AI-generated dispute letter — top to bottom in order of importance." />
        <Callout number="4" title="Right column: the conversation" body="Email Thread shows payor replies (and lets you reply back). Portal Submissions logs every bot attempt. Notes are for your team. Activity Feed is the read-only audit trail." color="primary" />
      </div>
    </SlideShell>
  );
}
