import { AppSidebar, Browser, Callout, SlideShell, StatusPill } from "@/components/slide-ui";

const ROWS = [
  { conf: "CC-2026-04-1142", date: "04/15", client: "MA-7782319", err: "Member Name Mismatch", amt: "$72.00", status: "Needs Evidence", kind: "orange" as const, sel: true },
  { conf: "CC-2026-04-1143", date: "04/15", client: "MA-7782319", err: "Member Name Mismatch", amt: "$54.25", status: "Needs Evidence", kind: "orange" as const, sel: true },
  { conf: "CC-2026-04-1144", date: "04/15", client: "MA-9012483", err: "GPS Out of Range", amt: "$91.00", status: "Needs Evidence", kind: "orange" as const, sel: true },
  { conf: "CC-2026-04-1145", date: "04/15", client: "MA-3344821", err: "Missing Signature", amt: "$48.50", status: "Approved", kind: "green" as const },
];

export default function ClaimsBulk() {
  return (
    <SlideShell
      step={18}
      totalSteps={22}
      title="The All Claims Page (Search and Bulk Actions)"
      subtitle="Need to find a specific claim or apply the same fix to many? All Claims is your search-and-edit superpower."
    >
      <div style={{ flex: 1.6 }}>
        <Browser url="/claims">
          <div className="flex h-full">
            <AppSidebar active="claims" />
            <div className="flex-1 bg-bg" style={{ padding: "1.2vh 1vw" }}>
              <div className="flex items-center justify-between" style={{ marginBottom: "1vh" }}>
                <p className="font-display text-primary font-bold" style={{ fontSize: "1.2vw" }}>All Claims</p>
                <button className="bg-orange text-white font-display font-semibold rounded-[0.4vw]" style={{ padding: "0.5vh 0.8vw", fontSize: "0.78vw" }}>+ Create Claim</button>
              </div>
              <div className="flex gap-[0.5vw]" style={{ marginBottom: "0.8vh" }}>
                <div className="flex-1 bg-white border border-primary/15 rounded-[0.4vw] flex items-center" style={{ padding: "0.6vh 0.7vw" }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="#6B7A90" strokeWidth="2" style={{ width: "0.8vw", height: "0.8vw" }}><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
                  <span className="font-body text-muted" style={{ fontSize: "0.8vw", marginLeft: "0.4vw" }}>Search by Conf #, Client, Error…</span>
                </div>
                <button className="bg-white border border-primary/15 rounded-[0.4vw] flex items-center gap-[0.4vw] font-body text-primary font-semibold" style={{ padding: "0.6vh 0.8vw", fontSize: "0.78vw" }}>
                  Filters <span className="bg-accent text-white rounded-full inline-flex items-center justify-center" style={{ width: "1vw", height: "1vw", fontSize: "0.65vw" }}>2</span>
                </button>
              </div>

              <div className="bg-accent text-white rounded-[0.4vw] flex items-center justify-between" style={{ padding: "0.6vh 0.8vw", marginBottom: "0.6vh" }}>
                <span className="font-body font-semibold" style={{ fontSize: "0.78vw" }}>3 claims selected</span>
                <div className="flex gap-[0.5vw] font-body font-semibold" style={{ fontSize: "0.75vw" }}>
                  <span>Assign Error Type ▾</span>
                  <span>Send to Portal</span>
                  <span>Place On Hold</span>
                </div>
              </div>

              <div className="bg-white rounded-[0.5vw] border border-primary/10">
                <div className="grid grid-cols-12 gap-[0.4vw] border-b border-primary/10" style={{ padding: "0.7vh 0.7vw" }}>
                  {[["", 1], ["Conf #", 2], ["Date", 1], ["Client", 2], ["Error", 3], ["Amount", 1], ["Status", 2]].map(([h, span]) => (
                    <div key={h as string} className={`col-span-${span} font-body text-muted uppercase tracking-wider`} style={{ fontSize: "0.78vw" }}>{h}</div>
                  ))}
                </div>
                {ROWS.map((r) => (
                  <div key={r.conf} className={`grid grid-cols-12 gap-[0.4vw] border-b border-primary/5 items-center ${r.sel ? "bg-accent/5" : ""}`} style={{ padding: "0.9vh 0.7vw" }}>
                    <div className="col-span-1">
                      <span className={`inline-flex items-center justify-center rounded-[0.2vw] border ${r.sel ? "bg-accent border-accent text-white" : "border-primary/30"}`} style={{ width: "1.1vw", height: "1.1vw", fontSize: "0.75vw" }}>{r.sel ? "✓" : ""}</span>
                    </div>
                    <div className="col-span-2 font-mono text-accent font-semibold" style={{ fontSize: "0.92vw" }}>{r.conf}</div>
                    <div className="col-span-1 font-body text-primary" style={{ fontSize: "0.9vw" }}>{r.date}</div>
                    <div className="col-span-2 font-mono text-primary" style={{ fontSize: "0.85vw" }}>{r.client}</div>
                    <div className="col-span-3 font-body text-primary truncate" style={{ fontSize: "0.88vw" }}>{r.err}</div>
                    <div className="col-span-1 font-display text-primary font-semibold" style={{ fontSize: "0.92vw" }}>{r.amt}</div>
                    <div className="col-span-2"><StatusPill label={r.status} kind={r.kind} /></div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Browser>
      </div>
      <div className="flex flex-col gap-[1vh]" style={{ flex: 1 }}>
        <Callout number="1" title="Search by Conf #, client, or error text" body="Type any fragment. Most-used: paste a Conf # from an email to jump straight to the claim." />
        <Callout number="2" title="Filters narrow by status, error, outcome" body="Click Filters and combine. The badge shows how many filters are active. Clear them when you're done." color="orange" />
        <Callout number="3" title="Check boxes to select rows" body="Once 1+ rows are selected, the blue action bar appears at the top. Bulk-assign error types or send a batch to portal." />
        <Callout number="4" title="Click a Conf # to open the claim" body="Same Claim Detail page you saw earlier. The breadcrumb takes you back to your filtered list." color="primary" />
      </div>
    </SlideShell>
  );
}
