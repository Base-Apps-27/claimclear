import { SlideShell } from "@/components/slide-ui";

const PITFALLS = [
  {
    bad: "Sending a dispute with no evidence attached",
    why: "MAS denies these almost every time. The bot will submit anyway because you told it to.",
    fix: "If you can't get the file, place On Hold with a note. Better to wait one day than to burn your one good shot at the dispute.",
  },
  {
    bad: "Re-submitting the same claim twice",
    why: "Counts as two filings against your account. MAS notices and gets stricter.",
    fix: "Use Re-dispute (after a denial) or post a Note. Never Send to Portal a second time on a claim that's still Awaiting.",
  },
  {
    bad: "Triaging Non-Issue without checking",
    why: "Non-Issue closes the group at $0. If it was actually a real denial, you just gave up the money.",
    fix: "When in doubt, Issue Found. You can change your mind from the group page later — you can't un-resolve a Non-Issue easily.",
  },
  {
    bad: "Editing a claim while a teammate is on it",
    why: "Last save wins. You'll overwrite their work without knowing.",
    fix: "Watch for the human-presence banner at the top of the claim. If you see another name, message them or come back later.",
  },
  {
    bad: "Ignoring the AI dispute letter before submit",
    why: "The AI sometimes references evidence you didn't actually attach, or quotes the wrong amount.",
    fix: "Always open the letter, scan it once, click Regenerate if you changed evidence or error type after it was first written.",
  },
  {
    bad: "Letting Awaiting Response pile up past 14 days",
    why: "MAS rarely volunteers responses. Stale items just rot.",
    fix: "Sort Awaiting by 'days waiting'. Anything >14 days, post a Note flagging your supervisor — they'll know who to call.",
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
