import { AppSidebar, Browser, Callout, SlideShell, StatusPill } from "@/components/slide-ui";

export default function DashboardCheckIn() {
  return (
    <SlideShell
      step={19}
      totalSteps={22}
      title="The Dashboard: Your Morning Check-In"
      subtitle="Start every day here. The dashboard tells you what's urgent, what's pending, and how the bots are doing."
    >
      <div style={{ flex: 1.6 }}>
        <Browser url="/dashboard">
          <div className="flex h-full">
            <AppSidebar active="dashboard" />
            <div className="flex-1 bg-bg" style={{ padding: "1.2vh 1vw" }}>
              <p className="font-display text-primary font-bold" style={{ fontSize: "1.3vw" }}>Good morning, Maria</p>
              <p className="font-body text-muted" style={{ fontSize: "0.8vw" }}>Here's where things stand right now</p>

              <div className="grid grid-cols-4 gap-[0.7vw]" style={{ marginTop: "1.2vh" }}>
                {[
                  { l: "Needs Evidence", v: "12", h: "Action you owe", c: "text-orange" },
                  { l: "Awaiting Response", v: "18", h: "MAS owes you", c: "text-[#6D28D9]" },
                  { l: "Total Exposure", v: "$4.2K", h: "At risk this month", c: "text-primary" },
                  { l: "Recovered MTD", v: "$1.8K", h: "+34% vs last month", c: "text-[#16A34A]" },
                ].map((s) => (
                  <div key={s.l} className="bg-white rounded-[0.5vw] border border-primary/10" style={{ padding: "1vh 0.9vw" }}>
                    <p className="font-body text-muted uppercase tracking-wider" style={{ fontSize: "0.6vw" }}>{s.l}</p>
                    <p className={`font-display font-extrabold ${s.c}`} style={{ fontSize: "1.6vw" }}>{s.v}</p>
                    <p className="font-body text-muted" style={{ fontSize: "0.65vw" }}>{s.h}</p>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-3 gap-[0.7vw]" style={{ marginTop: "1vh" }}>
                <div className="col-span-2 bg-white rounded-[0.5vw] border border-primary/10" style={{ padding: "1vh 0.9vw" }}>
                  <div className="flex items-center justify-between" style={{ marginBottom: "0.6vh" }}>
                    <p className="font-display text-primary font-bold" style={{ fontSize: "0.9vw" }}>Expiring Soon</p>
                    <span className="bg-[#FEE2E2] text-[#991B1B] rounded-full font-body font-semibold" style={{ padding: "0.1vh 0.5vw", fontSize: "0.65vw" }}>3 critical</span>
                  </div>
                  {[
                    { inv: "INV-89251", days: 2, amt: "$214" },
                    { inv: "INV-89263", days: 4, amt: "$92" },
                    { inv: "INV-89274", days: 6, amt: "$148" },
                  ].map((r) => (
                    <div key={r.inv} className="grid grid-cols-12 gap-[0.4vw] border-b border-primary/5 items-center" style={{ padding: "0.5vh 0" }}>
                      <div className="col-span-4 font-mono text-accent font-semibold" style={{ fontSize: "0.75vw" }}>{r.inv}</div>
                      <div className="col-span-3 font-display text-[#DC2626] font-bold" style={{ fontSize: "0.8vw" }}>{r.days}d left</div>
                      <div className="col-span-3 font-display text-primary font-semibold" style={{ fontSize: "0.75vw" }}>{r.amt}</div>
                      <div className="col-span-2"><StatusPill label="Needs Evidence" kind="orange" /></div>
                    </div>
                  ))}
                </div>

                <div className="bg-white rounded-[0.5vw] border border-primary/10" style={{ padding: "1vh 0.9vw" }}>
                  <p className="font-display text-primary font-bold" style={{ fontSize: "0.9vw" }}>Bot Health</p>
                  <div className="space-y-[0.5vh]" style={{ marginTop: "0.6vh" }}>
                    {[
                      { l: "Bots online", v: "3 / 4", c: "text-[#16A34A]" },
                      { l: "Portal queue", v: "5", c: "text-primary" },
                      { l: "Today's success rate", v: "94%", c: "text-[#16A34A]" },
                    ].map((b) => (
                      <div key={b.l} className="flex items-center justify-between">
                        <span className="font-body text-muted" style={{ fontSize: "0.75vw" }}>{b.l}</span>
                        <span className={`font-display font-bold ${b.c}`} style={{ fontSize: "0.85vw" }}>{b.v}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Browser>
      </div>
      <div className="flex flex-col gap-[1vh]" style={{ flex: 1 }}>
        <Callout number="1" title="The 4 numbers tell your day" body="Needs Evidence is your to-do count. Awaiting is what you're waiting on. Exposure and Recovered tell you the dollars at stake." />
        <Callout number="2" title="Expiring Soon = drop everything" body="Anything ≤7 days is in red. These are claims that will time out and become unrecoverable if you don't act today." color="orange" />
        <Callout number="3" title="Check Bot Health" body="If bots are offline or success rate is dropping, ping a supervisor before piling more work into the portal queue." color="primary" />
        <Callout number="4" title="Click any number to drill in" body="The stat cards are clickable — they take you to the matching filter on All Claims or Work Queue." />
      </div>
    </SlideShell>
  );
}
