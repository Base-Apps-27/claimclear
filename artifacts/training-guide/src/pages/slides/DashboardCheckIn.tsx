import { AppSidebar, Browser, Callout, SlideShell, StatusPill } from "@/components/slide-ui";

export default function DashboardCheckIn() {
  return (
    <SlideShell
      step={19}
      totalSteps={22}
      title="The Command Center: Your Morning Check-In"
      subtitle="Start every day on the Dashboard. The Command Center tells you what's urgent, what's pending, and how the bots are doing."
    >
      <div style={{ flex: 1.6 }}>
        <Browser url="/dashboard">
          <div className="flex h-full">
            <AppSidebar active="dashboard" />
            <div className="flex-1 bg-bg" style={{ padding: "1.2vh 1vw" }}>
              <p className="font-display text-primary font-bold" style={{ fontSize: "1.3vw" }}>Good morning, Maria</p>
              <p className="font-body text-muted" style={{ fontSize: "0.8vw" }}>Command Center · here's where things stand right now</p>

              <div className="grid grid-cols-4 gap-[0.7vw]" style={{ marginTop: "1.2vh" }}>
                {[
                  { l: "Needs Evidence", v: "12", h: "Action you owe", c: "text-orange" },
                  { l: "Awaiting Response", v: "18", h: "Payor owes you", c: "text-[#6D28D9]" },
                  { l: "Total Exposure", v: "$4.2K", h: "Claim + ~70% vendor prepay", c: "text-primary" },
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

              <div className="bg-white rounded-[0.5vw] border border-primary/10" style={{ padding: "1vh 0.9vw", marginTop: "0.8vh" }}>
                <div className="flex items-center justify-between" style={{ marginBottom: "0.6vh" }}>
                  <p className="font-display text-primary font-bold" style={{ fontSize: "0.9vw" }}>Closure Breakdown — last 30 days</p>
                  <span className="font-body text-muted" style={{ fontSize: "0.65vw" }}>148 closed</span>
                </div>
                <div className="flex h-[1vh] rounded-full overflow-hidden bg-primary/10" style={{ marginBottom: "0.5vh" }}>
                  <div className="bg-[#16A34A]" style={{ width: "62%" }} />
                  <div className="bg-[#DC2626]" style={{ width: "26%" }} />
                  <div className="bg-[#9CA3AF]" style={{ width: "12%" }} />
                </div>
                <div className="grid grid-cols-3 gap-[0.5vw] font-body" style={{ fontSize: "0.7vw" }}>
                  <span className="text-[#065F46]"><span className="font-display font-bold">62%</span> Resolved</span>
                  <span className="text-[#991B1B]"><span className="font-display font-bold">26%</span> Denied (payor)</span>
                  <span className="text-muted"><span className="font-display font-bold">12%</span> Withdrawn (us)</span>
                </div>
              </div>
            </div>
          </div>
        </Browser>
      </div>
      <div className="flex flex-col gap-[1vh]" style={{ flex: 1 }}>
        <Callout number="1" title="The 4 numbers tell your day" body="Needs Evidence is your to-do count. Awaiting is what the payor owes you. Exposure (claim + ~70% vendor prepay) and Recovered tell you the dollars at stake." />
        <Callout number="2" title="Expiring Soon = drop everything" body="Anything ≤7 business days is in red (weekends count as Friday). These claims will time out and become unrecoverable if you don't act today." color="orange" />
        <Callout number="3" title="Closure Breakdown shows your win/loss split" body="Resolved (green) is recovered. Denied is the payor saying no. Withdrawn is when WE close it. Watch the Withdrawn slice — if it grows, we're giving up money we could have fought for." />
        <Callout number="4" title="Bot Health + click-through" body="If bots are offline or success rate drops, ping a supervisor before piling more into the queue. Stat cards are clickable — they jump to the matching filter on Work Queue or All Claims." color="primary" />
      </div>
    </SlideShell>
  );
}
