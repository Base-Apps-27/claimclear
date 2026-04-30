import { AppSidebar, Browser, Callout, SlideShell, StatusPill } from "@/components/slide-ui";

export default function ReviewQueue() {
  return (
    <SlideShell
      step={5}
      totalSteps={24}
      title="Triage New Uploads in the Review Queue"
      subtitle="Every freshly imported invoice group lands here as 'Needs Review'. Read the raw MAS error first — your only job here is to send it on for classification."
    >
      <div style={{ flex: 1.5 }}>
        <Browser url="/review">
          <div className="flex h-full">
            <AppSidebar active="review" />
            <div className="flex-1 bg-bg flex" style={{ padding: "1.5vh 1vw", gap: "0.8vw" }}>
              <div className="bg-white rounded-[0.5vw] border border-primary/10" style={{ width: "40%", padding: "1vh 0.7vw" }}>
                <p className="font-display text-primary font-bold" style={{ fontSize: "0.95vw" }}>Needs Review</p>
                <p className="font-body text-muted" style={{ fontSize: "0.65vw" }}>14 invoice groups</p>
                <div style={{ marginTop: "1vh" }} className="space-y-[0.5vh]">
                  {[
                    { inv: "INV-89421", rides: 4, amt: "$268", sel: true },
                    { inv: "INV-89418", rides: 1, amt: "$62" },
                    { inv: "INV-89414", rides: 6, amt: "$391" },
                    { inv: "INV-89409", rides: 2, amt: "$148" },
                  ].map((g) => (
                    <div
                      key={g.inv}
                      className={`rounded-[0.4vw] border ${g.sel ? "border-accent bg-accent/5" : "border-primary/10"}`}
                      style={{ padding: "0.7vh 0.6vw" }}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-mono font-semibold text-primary" style={{ fontSize: "0.75vw" }}>{g.inv}</span>
                        <StatusPill label="Needs Review" kind="amber" />
                      </div>
                      <div className="flex items-center justify-between" style={{ marginTop: "0.3vh" }}>
                        <span className="font-body text-muted" style={{ fontSize: "0.65vw" }}>{g.rides} rides</span>
                        <span className="font-display text-primary font-bold" style={{ fontSize: "0.75vw" }}>{g.amt}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="bg-white rounded-[0.5vw] border border-primary/10 flex-1" style={{ padding: "1.2vh 1vw" }}>
                <p className="font-display text-primary font-bold" style={{ fontSize: "1vw" }}>INV-89421 · Triage</p>
                <p className="font-body text-muted" style={{ fontSize: "0.7vw", marginTop: "0.3vh" }}>4 rides · $268</p>

                <div className="bg-bg border border-primary/10 rounded-[0.4vw]" style={{ padding: "0.8vh 0.7vw", marginTop: "1vh" }}>
                  <p className="font-body text-muted uppercase tracking-wider" style={{ fontSize: "0.55vw" }}>Raw payor error</p>
                  <p className="font-mono text-primary" style={{ fontSize: "0.72vw", marginTop: "0.2vh", lineHeight: "1.4" }}>"Member name mismatch — record on file does not match submitted documentation"</p>
                </div>

                <div style={{ marginTop: "1.2vh" }}>
                  <p className="font-display text-primary font-semibold" style={{ fontSize: "0.8vw" }}>Send this group on</p>
                  <p className="font-body text-muted" style={{ fontSize: "0.7vw", marginTop: "0.2vh", lineHeight: "1.4" }}>Pick the matching Error Type to send the group to Build Case. Walking away (Non-Issue / Cannot Dispute / Accepted Loss) is a closure exit you take later.</p>
                  <button className="bg-orange text-white font-display font-semibold rounded-[0.4vw] w-full" style={{ padding: "0.8vh 0", fontSize: "0.85vw", marginTop: "0.8vh" }}>Classify this claim →</button>
                </div>
              </div>
            </div>
          </div>
        </Browser>
      </div>
      <div className="flex flex-col gap-[1vh]" style={{ flex: 1 }}>
        <Callout number="1" title="Open Review Queue" body="Click 'Review Queue' in the sidebar. The badge number tells you how many groups are waiting." />
        <Callout number="2" title="Pick a group from the left" body="The list shows the invoice number, ride count, and dollar amount. The selected group highlights in blue." color="orange" />
        <Callout number="3" title="Read the raw error from MAS" body="That single sentence drives everything. It tells you which Error Type to pick on the next screen." />
        <Callout number="4" title="Hit Classify" body="The triage screen has one path forward: Classify. Closure exits — Non-Issue, Cannot Dispute, Accepted Loss — happen later from Build Case or the claim page once you've actually looked at the data." color="orange" />
      </div>
    </SlideShell>
  );
}
