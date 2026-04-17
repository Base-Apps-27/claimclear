import { AppSidebar, Browser, Callout, SlideShell, StatusPill } from "@/components/slide-ui";

const RIDES = [
  { conf: "CC-2026-04-1138", date: "04/14", amt: "$68.50", status: "Awaiting Response", kind: "violet" as const },
  { conf: "CC-2026-04-1139", date: "04/14", amt: "$72.00", status: "Awaiting Response", kind: "violet" as const },
  { conf: "CC-2026-04-1140", date: "04/14", amt: "$54.25", status: "Needs Evidence", kind: "orange" as const },
  { conf: "CC-2026-04-1141", date: "04/14", amt: "$91.00", status: "Needs Evidence", kind: "orange" as const },
];

export default function InvoiceGroupDetail() {
  return (
    <SlideShell
      step={17}
      totalSteps={22}
      title="Invoice Group Detail"
      subtitle="When several rides share one invoice (and one MAS denial reason), you process them as a group. The group page shows every ride in one place."
    >
      <div style={{ flex: 1.6 }}>
        <Browser url="/invoice-groups/INV-89384">
          <div className="flex h-full">
            <AppSidebar active="groups" />
            <div className="flex-1 bg-bg" style={{ padding: "1.5vh 1.2vw" }}>
              <div className="flex items-center justify-between" style={{ marginBottom: "1vh" }}>
                <div>
                  <div className="flex items-center gap-[0.6vw]">
                    <p className="font-mono font-bold text-primary" style={{ fontSize: "1.3vw" }}>INV-89384</p>
                    <StatusPill label="In Progress" kind="violet" size="md" />
                  </div>
                  <p className="font-body text-muted" style={{ fontSize: "0.8vw", marginTop: "0.3vh" }}>4 rides · $285.75 · GPS Out of Range · 6 days remaining</p>
                </div>
                <div className="flex gap-[0.5vw]">
                  <button className="bg-white border border-primary/20 text-primary font-display font-semibold rounded-[0.4vw]" style={{ padding: "0.5vh 0.8vw", fontSize: "0.78vw" }}>Place On Hold</button>
                  <button className="bg-accent text-white font-display font-semibold rounded-[0.4vw]" style={{ padding: "0.5vh 0.8vw", fontSize: "0.78vw" }}>Run Group Workflow</button>
                </div>
              </div>

              <div className="bg-white rounded-[0.5vw] border border-primary/10" style={{ padding: "1vh 1vw" }}>
                <p className="font-display text-primary font-bold" style={{ fontSize: "0.9vw", marginBottom: "0.6vh" }}>Rides in this invoice</p>
                <div className="grid grid-cols-12 gap-[0.4vw] border-b border-primary/10" style={{ padding: "0.4vh 0" }}>
                  {[["Conf #", 4], ["Date", 2], ["Amount", 2], ["Status", 4]].map(([h, span]) => (
                    <div key={h as string} className={`col-span-${span} font-body text-muted uppercase tracking-wider`} style={{ fontSize: "0.6vw" }}>{h}</div>
                  ))}
                </div>
                {RIDES.map((r) => (
                  <div key={r.conf} className="grid grid-cols-12 gap-[0.4vw] border-b border-primary/5 items-center" style={{ padding: "0.6vh 0" }}>
                    <div className="col-span-4 font-mono text-accent font-semibold" style={{ fontSize: "0.78vw" }}>{r.conf}</div>
                    <div className="col-span-2 font-body text-primary" style={{ fontSize: "0.78vw" }}>{r.date}</div>
                    <div className="col-span-2 font-display text-primary font-semibold" style={{ fontSize: "0.78vw" }}>{r.amt}</div>
                    <div className="col-span-4"><StatusPill label={r.status} kind={r.kind} /></div>
                  </div>
                ))}
              </div>

              <div className="bg-white rounded-[0.5vw] border border-primary/10" style={{ padding: "1vh 1vw", marginTop: "0.8vh" }}>
                <p className="font-display text-primary font-bold" style={{ fontSize: "0.9vw" }}>Group-level evidence</p>
                <p className="font-body text-muted" style={{ fontSize: "0.7vw" }}>Files attached here apply to every ride in the invoice (e.g. one daily GPS log covers all 4)</p>
              </div>
            </div>
          </div>
        </Browser>
      </div>
      <div className="flex flex-col gap-[1.2vh]" style={{ flex: 1 }}>
        <Callout number="1" title="One invoice = one workflow run" body="You only run the SOP once for the whole group. Group-level answers and evidence apply to every ride inside." />
        <Callout number="2" title="Each ride still has its own claim page" body="Click a Conf # to open the claim detail for that ride if you need to fix something specific (different amount, different driver)." color="orange" />
        <Callout number="3" title="Place On Hold pauses the group" body="Use this when you're waiting on dispatch for evidence that covers all rides. Add a note explaining why and what unblocks it." />
        <Callout number="4" title="Run Group Workflow processes them together" body="Saves a ton of time vs. doing 4 separate workflow runs. The bot files 4 disputes back-to-back, sharing the same evidence." color="primary" />
      </div>
    </SlideShell>
  );
}
