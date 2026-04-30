import { AppSidebar, Browser, Callout, SlideShell, StatusPill } from "@/components/slide-ui";

export default function ReviewQueue() {
  return (
    <SlideShell
      step={3}
      totalSteps={22}
      title="Classify New Uploads in the Review Queue"
      subtitle="Every freshly imported invoice group lands here as 'Needs Review'. Your first decision: is this actually an issue?"
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
                <p className="font-display text-primary font-bold" style={{ fontSize: "1vw" }}>Classify INV-89421</p>
                <p className="font-body text-muted" style={{ fontSize: "0.7vw", marginTop: "0.3vh" }}>4 rides · $268 · Raw error: "Member name mismatch"</p>
                <div style={{ marginTop: "1.5vh" }}>
                  <p className="font-display text-primary font-semibold" style={{ fontSize: "0.85vw" }}>What did you find?</p>
                  <div className="flex gap-[0.6vw]" style={{ marginTop: "0.8vh" }}>
                    <div className="flex-1 bg-[#16A34A] text-white rounded-[0.4vw] text-center font-display font-bold" style={{ padding: "1.5vh 0.5vw", fontSize: "0.85vw" }}>
                      Non-Issue
                      <div className="font-body font-normal text-white/80" style={{ fontSize: "0.6vw", marginTop: "0.2vh" }}>Resolve all rides at $0</div>
                    </div>
                    <div className="flex-1 bg-orange text-white rounded-[0.4vw] text-center font-display font-bold" style={{ padding: "1.5vh 0.5vw", fontSize: "0.85vw" }}>
                      Issue Found
                      <div className="font-body font-normal text-white/80" style={{ fontSize: "0.6vw", marginTop: "0.2vh" }}>Assign error type</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Browser>
      </div>
      <div className="flex flex-col gap-[1vh]" style={{ flex: 1 }}>
        <Callout number="1" title="Open Review Queue" body="Click 'Review Queue' in the sidebar. The badge number tells you how many groups are waiting." />
        <Callout number="2" title="Pick a group from the left" body="The list shows the invoice number, ride count, and dollar amount. The selected group highlights in blue." color="orange" />
        <Callout number="3" title="Read the raw error from MAS" body="The right pane shows what MAS rejected. Use it to decide which path to take next." />
        <Callout number="4" title="Choose Non-Issue or Issue Found" body="Two big buttons. Non-Issue closes the group at $0 impact. Issue Found sends it forward for processing." color="orange" />
      </div>
    </SlideShell>
  );
}
