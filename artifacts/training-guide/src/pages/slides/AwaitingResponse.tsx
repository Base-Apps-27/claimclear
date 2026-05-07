import { Browser, Callout, SlideShell, StatusPill } from "@/components/slide-ui";

export default function AwaitingResponse() {
  return (
    <SlideShell
      step={15}
      totalSteps={22}
      title="What Happens Next: Awaiting Response"
      subtitle="Once the bot files the dispute, the claim sits in Awaiting Response. Most payor replies come back in 7–14 days via the Email Thread."
    >
      <div style={{ flex: 1.4 }}>
        <Browser url="/queue?tab=awaiting">
          <div className="bg-bg h-full" style={{ padding: "1.5vh 1.5vw" }}>
            <div className="flex items-center gap-[0.4vw] border-b border-primary/10" style={{ marginBottom: "1.5vh" }}>
              {["Action Required", "Portal Queued", "Awaiting", "On Hold"].map((t) => (
                <div key={t} className={`flex items-center gap-[0.4vw] ${t === "Awaiting" ? "border-b-2 border-accent" : ""}`} style={{ padding: "0.7vh 0.8vw" }}>
                  <span className={`font-display font-semibold ${t === "Awaiting" ? "text-accent" : "text-muted"}`} style={{ fontSize: "0.9vw" }}>{t}</span>
                </div>
              ))}
            </div>

            <div className="bg-white rounded-[0.5vw] border border-primary/10 overflow-hidden">
              <div className="grid grid-cols-12 gap-[0.4vw] bg-primary/5 border-b border-primary/10" style={{ padding: "0.8vh 0.9vw" }}>
                {["Conf #", "Submitted", "Days waiting", "MAS Ticket", "Amount", "Status"].map((h, i) => (
                  <div key={h} className={`font-body text-muted uppercase tracking-wider ${i === 0 ? "col-span-2" : i === 5 ? "col-span-2" : "col-span-2"}`} style={{ fontSize: "0.78vw" }}>{h}</div>
                ))}
              </div>
              {[
                { c: "CC-2026-04-1138", s: "04/14", d: 3, t: "MAS-998421", a: "$68.50" },
                { c: "CC-2026-04-1131", s: "04/13", d: 4, t: "MAS-998418", a: "$92.10" },
                { c: "CC-2026-04-1112", s: "04/10", d: 7, t: "MAS-998403", a: "$71.25" },
                { c: "CC-2026-04-1098", s: "04/06", d: 11, t: "MAS-998391", a: "$118.00" },
                { c: "CC-2026-04-1062", s: "03/28", d: 20, t: "MAS-998344", a: "$54.00", late: true },
              ].map((r) => (
                <div key={r.c} className="grid grid-cols-12 gap-[0.4vw] border-b border-primary/5 items-center" style={{ padding: "1vh 0.9vw" }}>
                  <div className="col-span-2 font-mono text-accent font-semibold" style={{ fontSize: "0.95vw" }}>{r.c}</div>
                  <div className="col-span-2 font-body text-primary" style={{ fontSize: "0.95vw" }}>{r.s}</div>
                  <div className={`col-span-2 font-display font-bold ${r.late ? "text-[#DC2626]" : "text-primary"}`} style={{ fontSize: "1.05vw" }}>{r.d}d</div>
                  <div className="col-span-2 font-mono text-primary" style={{ fontSize: "0.9vw" }}>{r.t}</div>
                  <div className="col-span-2 font-display text-primary font-semibold" style={{ fontSize: "0.95vw" }}>{r.a}</div>
                  <div className="col-span-2"><StatusPill label="Awaiting Response" kind="violet" /></div>
                </div>
              ))}
            </div>
          </div>
        </Browser>
      </div>
      <div className="flex flex-col gap-[1.2vh]" style={{ flex: 1 }}>
        <Callout number="1" title="No action needed — usually" body="Awaiting means the payor owns the next move. ClaimClear watches the Email Thread and Portal Submissions for replies and updates status automatically." />
        <Callout number="2" title="Sort by 'Days waiting'" body="Anything red (>14 days) is past the typical reply window. Open the Email Thread and reply directly, or escalate." color="orange" />
        <Callout number="3" title="Don't re-submit while waiting" body="Filing the same dispute twice gets you flagged. If you really need to add new evidence, post a Note instead of re-submitting." color="primary" />
        <Callout number="4" title="When the payor responds…" body="Invoice phase auto-advances to response_received and the badge flips to Needs Review when a substantive response arrives — find it in Responses Awaiting Review on the Queue page, where AI has tagged it with a hint. Acknowledgments don't change phase." />
      </div>
    </SlideShell>
  );
}
