import { AppSidebar, Browser, Callout, SlideShell, StatusPill } from "@/components/slide-ui";

const TABS = [
  { name: "Action Required", count: 12, active: true, hint: "Things waiting on YOU" },
  { name: "Portal Queued", count: 5 },
  { name: "Awaiting", count: 18 },
  { name: "On Hold", count: 3 },
];

export default function WorkQueueTabs() {
  return (
    <SlideShell
      step={6}
      totalSteps={22}
      title="Open the Work Queue"
      subtitle="This is your daily workbench. Four tabs, one purpose: tell you what to do next."
    >
      <div style={{ flex: 1.6 }}>
        <Browser url="/queue">
          <div className="flex h-full">
            <AppSidebar active="queue" />
            <div className="flex-1 bg-bg" style={{ padding: "1.5vh 1.2vw" }}>
              <p className="font-display text-primary font-bold" style={{ fontSize: "1.2vw" }}>Work Queue</p>
              <p className="font-body text-muted" style={{ fontSize: "0.75vw" }}>Invoice groups requiring attention — select a group to process</p>
              <div className="flex gap-[0.4vw] border-b border-primary/10" style={{ marginTop: "1.5vh" }}>
                {TABS.map((t) => (
                  <div key={t.name} className={`flex items-center gap-[0.4vw] ${t.active ? "border-b-2 border-accent" : ""}`} style={{ padding: "0.8vh 0.8vw" }}>
                    <span className={`font-display font-semibold ${t.active ? "text-accent" : "text-muted"}`} style={{ fontSize: "0.85vw" }}>{t.name}</span>
                    <span className={`rounded-full font-display font-bold ${t.active ? "bg-orange text-white" : "bg-primary/10 text-muted"}`} style={{ padding: "0.1vh 0.5vw", fontSize: "0.7vw" }}>{t.count}</span>
                  </div>
                ))}
              </div>
              <div className="flex gap-[0.8vw]" style={{ marginTop: "1.2vh" }}>
                <div className="bg-white rounded-[0.5vw] border border-primary/10" style={{ width: "42%", padding: "0.8vh 0.6vw" }}>
                  <div className="space-y-[0.4vh]">
                    {[
                      { inv: "INV-89384", err: "GPS Out of Range", days: 6, sel: true },
                      { inv: "INV-89377", err: "Member Name Mismatch", days: 11 },
                      { inv: "INV-89362", err: "Missing Signature", days: 14 },
                      { inv: "INV-89351", err: "Duplicate Trip", days: 18 },
                    ].map((g) => (
                      <div key={g.inv} className={`rounded-[0.4vw] border ${g.sel ? "border-accent bg-accent/5" : "border-primary/10"}`} style={{ padding: "0.7vh 0.6vw" }}>
                        <div className="flex items-center justify-between">
                          <span className="font-mono font-semibold text-primary" style={{ fontSize: "0.75vw" }}>{g.inv}</span>
                          <span className={`font-body font-semibold ${g.days <= 7 ? "text-[#DC2626]" : g.days <= 14 ? "text-orange" : "text-muted"}`} style={{ fontSize: "0.65vw" }}>{g.days}d left</span>
                        </div>
                        <p className="font-body text-muted" style={{ fontSize: "0.65vw", marginTop: "0.2vh" }}>{g.err}</p>
                        <div className="flex items-center justify-between" style={{ marginTop: "0.3vh" }}>
                          <StatusPill label="Needs Evidence" kind="orange" />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="bg-white rounded-[0.5vw] border border-primary/10 flex-1 flex items-center justify-center" style={{ padding: "1.5vh 1vw", minHeight: "20vh" }}>
                  <div className="text-center">
                    <div className="bg-primary/5 rounded-full mx-auto flex items-center justify-center" style={{ width: "3vw", height: "3vw" }}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="#6B7A90" strokeWidth="2" style={{ width: "1.5vw", height: "1.5vw" }}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
                    </div>
                    <p className="font-body text-muted" style={{ fontSize: "0.85vw", marginTop: "1vh" }}>Select an invoice group to process</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Browser>
      </div>
      <div className="flex flex-col gap-[1vh]" style={{ flex: 1 }}>
        <Callout number="1" title="Start in Action Required" body="These are groups waiting on YOU — to add evidence, run the workflow, or send to portal." />
        <Callout number="2" title="Sort yourself by 'days left'" body="Red ≤7 days, orange ≤14, gray after. Always burn down red first." color="orange" />
        <Callout number="3" title="The other tabs are status checks" body="Portal Queued = waiting on bot. Awaiting = waiting on MAS. On Hold = paused by a human. Open them to monitor, not to act." />
        <Callout number="4" title="Click any group to load it on the right" body="The right pane shows the guided workflow. We'll cover that next." color="primary" />
      </div>
    </SlideShell>
  );
}
