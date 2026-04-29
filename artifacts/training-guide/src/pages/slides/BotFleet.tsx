import { AppSidebar, Browser, Callout, SlideShell, StatusPill } from "@/components/slide-ui";

const ROWS = [
  { conf: "CC-2026-04-1138", status: "In Progress", kind: "violet" as const, ticket: "MAS-998421", amt: "$68.50" },
  { conf: "CC-2026-04-1131", status: "Submitted", kind: "green" as const, ticket: "MAS-998418", amt: "$92.10" },
  { conf: "CC-2026-04-1124", status: "Failed", kind: "red" as const, ticket: "—", amt: "$54.00" },
  { conf: "CC-2026-04-1119", status: "Queued", kind: "blue" as const, ticket: "—", amt: "$148.00" },
  { conf: "CC-2026-04-1117", status: "Dry Run", kind: "amber" as const, ticket: "preview", amt: "$83.40" },
  { conf: "CC-2026-04-1115", status: "Pending", kind: "muted" as const, ticket: "—", amt: "$66.00" },
  { conf: "CC-2026-04-1112", status: "Cancelled", kind: "muted" as const, ticket: "—", amt: "$71.25" },
];

export default function BotFleet() {
  return (
    <SlideShell
      step={14}
      totalSteps={22}
      title="Monitor the Bot Fleet"
      subtitle="Portal Submissions shows every dispute the bots are working on. Check it once or twice a day to catch failures fast."
    >
      <div style={{ flex: 1.6 }}>
        <Browser url="/portal-submissions">
          <div className="flex h-full">
            <AppSidebar active="portal" />
            <div className="flex-1 bg-bg" style={{ padding: "1.2vh 1vw" }}>
              <div className="flex items-center justify-between" style={{ marginBottom: "1vh" }}>
                <div>
                  <p className="font-display text-primary font-bold" style={{ fontSize: "1.2vw" }}>Portal Submissions</p>
                  <p className="font-body text-muted" style={{ fontSize: "0.75vw" }}>Live bot activity on the MAS portal</p>
                </div>
                <div className="flex items-center gap-[0.6vw]">
                  <div className="flex items-center gap-[0.3vw]">
                    <div className="bg-[#16A34A] rounded-full animate-pulse" style={{ width: "0.5vw", height: "0.5vw" }} />
                    <span className="font-body text-[#065F46] font-semibold" style={{ fontSize: "0.75vw" }}>3 bots active</span>
                  </div>
                  <button className="bg-accent text-white font-display font-semibold rounded-[0.4vw]" style={{ padding: "0.4vh 0.8vw", fontSize: "0.75vw" }}>Process All Pending</button>
                </div>
              </div>

              <div className="bg-white rounded-[0.5vw] border border-primary/10" style={{ padding: "1vh 1vw", marginBottom: "1vh" }}>
                <div className="flex items-center justify-between" style={{ marginBottom: "0.5vh" }}>
                  <p className="font-display text-primary font-semibold" style={{ fontSize: "0.85vw" }}>Current batch progress</p>
                  <p className="font-body text-muted" style={{ fontSize: "0.7vw" }}>14 of 22 processed · 12 ✓ · 2 ✗</p>
                </div>
                <div className="h-[0.5vh] bg-primary/10 rounded-full overflow-hidden">
                  <div className="bg-accent h-full" style={{ width: "63%" }} />
                </div>
              </div>

              <div className="bg-white rounded-[0.5vw] border border-primary/10" style={{ padding: "0.6vh 0.9vw" }}>
                <div className="grid grid-cols-12 gap-[0.4vw] border-b border-primary/10" style={{ padding: "0.7vh 0" }}>
                  {["Conf #", "Status", "MAS Ticket", "Amount", "Actions"].map((h, i) => (
                    <div key={h} className={`font-body text-muted uppercase tracking-wider ${i === 0 ? "col-span-3" : i === 1 ? "col-span-2" : i === 2 ? "col-span-3" : i === 3 ? "col-span-2" : "col-span-2"}`} style={{ fontSize: "0.78vw" }}>{h}</div>
                  ))}
                </div>
                {ROWS.map((r) => (
                  <div key={r.conf} className="grid grid-cols-12 gap-[0.4vw] border-b border-primary/5 items-center" style={{ padding: "0.9vh 0" }}>
                    <div className="col-span-3 font-mono text-accent font-semibold" style={{ fontSize: "0.95vw" }}>{r.conf}</div>
                    <div className="col-span-2"><StatusPill label={r.status} kind={r.kind} /></div>
                    <div className="col-span-3 font-mono text-primary" style={{ fontSize: "0.9vw" }}>{r.ticket}</div>
                    <div className="col-span-2 font-display text-primary font-semibold" style={{ fontSize: "0.95vw" }}>{r.amt}</div>
                    <div className="col-span-2 flex gap-[0.5vw] font-body" style={{ fontSize: "0.85vw" }}>
                      <span className="text-accent font-semibold">View</span>
                      {r.kind === "red" && <span className="text-orange font-semibold">Retry</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Browser>
      </div>
      <div className="flex flex-col gap-[1vh]" style={{ flex: 1 }}>
        <Callout number="1" title="The full status set" body="Draft → Pending → Queued → In Progress → Submitted (or Failed / Cancelled). Dry Run is a preview the bot rendered without actually filing — safe to inspect." />
        <Callout number="2" title="Watch for Failed (red) rows" body="Open them, read the bot error, and decide: edit the data and retry, or escalate to a supervisor." color="orange" />
        <Callout number="3" title="Process All Pending = release the queue" body="If bots are idle and items are Queued, click this to start a batch. The progress bar shows real-time succeeded/failed counts." color="primary" />
        <Callout number="4" title="View opens the submission detail" body="See the screenshot, the exact form fields the bot used, and the rendered dispute letter. Use Cancel Run if you need to stop a bot mid-flight." />
      </div>
    </SlideShell>
  );
}
