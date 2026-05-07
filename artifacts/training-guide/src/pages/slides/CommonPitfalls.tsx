import { SlideShell } from "@/components/slide-ui";

const PITFALLS = [
  {
    bad: "Bypassing the Quality Check warnings before submit",
    why: "The Lint Gate blocks hard errors but lets you push past warnings. Ignored warnings (missing GPS, weak attestation) are the #1 reason payors deny.",
    fix: "Treat warnings as a checklist. Fix what you can in 2 minutes, or place On Hold with a note. Better to wait one day than burn your one good shot.",
  },
  {
    bad: "Re-submitting the same claim twice",
    why: "Counts as two filings against your account. The payor notices and gets stricter.",
    fix: "Use Re-dispute (after a denial) or post a Note. Never Send to Portal a second time on a claim whose invoice is still in the submitted or response_received phase.",
  },
  {
    bad: "Closing claims as Cannot Dispute / Non-Issue / Denied by Payor without lessons learned",
    why: "Every closure exit (Cannot Dispute, Non-Issue, Denied by Payor) lands in Withdrawals Review. If 'Communicated to' and 'Review notes / lessons learned' are blank, supervisors can't sign off and the team learns nothing from the loss.",
    fix: "Fill in who you told (driver / dispatcher / supervisor) and one line about why. Then mark Addressed. Don't take a closure exit at all if you can't articulate the reason.",
  },
  {
    bad: "Editing a claim while a bot is working it",
    why: "The Bot Presence banner means the bot is actively typing into the payor portal. Saving over its data mid-run causes failed submissions.",
    fix: "Wait for the banner to clear (usually <2 min) before editing. If urgent, click Cancel Run on Portal Submissions first.",
  },
  {
    bad: "Ignoring the AI dispute letter before submit",
    why: "The AI sometimes references evidence you didn't actually attach, or quotes the wrong amount.",
    fix: "Always open the letter, scan it once. Click Generate Preview (Dry Run) to see exactly what the bot will type, then Regenerate if anything's off.",
  },
  {
    bad: "Letting Awaiting Response pile up past 14 days",
    why: "Payors rarely volunteer responses. Stale items just rot.",
    fix: "Sort Awaiting by 'days waiting'. Anything >14 days, open the Email Thread and reply directly, or post a Note flagging your supervisor.",
  },
];

export default function CommonPitfalls() {
  return (
    <SlideShell
      step={21}
      totalSteps={22}
      title="Pitfalls to Avoid"
      subtitle="The six mistakes new processors make most often. Skim this whenever something feels off."
      accent="orange"
    >
      <div className="flex-1">
        <div className="grid grid-cols-2 gap-[1vw]">
          {PITFALLS.map((p) => (
            <div key={p.bad} className="bg-white rounded-[0.7vw] border border-primary/10 flex" style={{ padding: "1.3vh 1.2vw" }}>
              <div className="bg-[#FEE2E2] text-[#DC2626] rounded-full flex items-center justify-center shrink-0 font-display font-bold" style={{ width: "1.8vw", height: "1.8vw", fontSize: "1vw", marginRight: "0.8vw" }}>✗</div>
              <div className="min-w-0">
                <p className="font-display text-primary font-bold" style={{ fontSize: "0.95vw" }}>{p.bad}</p>
                <p className="font-body text-muted" style={{ fontSize: "0.78vw", marginTop: "0.3vh", lineHeight: "1.4" }}>{p.why}</p>
                <div className="bg-[#D1FAE5] rounded-[0.3vw] flex items-start gap-[0.4vw]" style={{ padding: "0.5vh 0.6vw", marginTop: "0.6vh" }}>
                  <span className="text-[#065F46] font-display font-bold" style={{ fontSize: "0.78vw" }}>✓</span>
                  <span className="font-body text-[#065F46]" style={{ fontSize: "0.78vw", lineHeight: "1.4" }}>{p.fix}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </SlideShell>
  );
}
