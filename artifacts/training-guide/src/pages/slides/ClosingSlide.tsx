export default function ClosingSlide() {
  const checks = [
    "Classify every Needs Review group",
    "Process Action Required, oldest first",
    "Attach evidence and read the AI letter before submit",
    "Watch Portal Submissions for Failed rows",
    "Handle MAS responses the same day they arrive",
  ];
  return (
    <div className="w-screen h-screen overflow-hidden relative bg-primary">
      <div className="absolute inset-0 bg-gradient-to-br from-primary via-primary to-navy-light" />
      <div className="absolute top-[10vh] right-[8vw] bg-accent/10 rounded-full" style={{ width: "22vw", height: "22vw" }} />
      <div className="absolute bottom-[8vh] left-[6vw] bg-orange/10 rounded-full" style={{ width: "14vw", height: "14vw" }} />
      <div className="relative z-10 flex h-full" style={{ padding: "8vh 8vw", gap: "5vw" }}>
        <div style={{ flex: 1.2 }} className="flex flex-col justify-center">
          <div className="bg-orange rounded-[1vw] flex items-center justify-center" style={{ width: "5vw", height: "5vw", marginBottom: "2.5vh" }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: "2.8vw", height: "2.8vw" }}>
              <path d="M20 6L9 17l-5-5" />
            </svg>
          </div>
          <h2 className="font-display text-white font-extrabold tracking-tight" style={{ fontSize: "4vw", lineHeight: "1.05" }}>You're ready to process your first batch.</h2>
          <p className="font-body text-white/60" style={{ fontSize: "1.4vw", marginTop: "2vh", maxWidth: "32vw" }}>
            Open ClaimClear, click <span className="text-white font-semibold">Sign In with Replit</span>, head to the Review Queue, and start classifying. The system tells you what to do next at every step — just follow the badges.
          </p>
        </div>
        <div style={{ flex: 1 }} className="flex flex-col justify-center">
          <div className="bg-white/10 border border-white/20 rounded-[1vw]" style={{ padding: "3vh 2.5vw" }}>
            <p className="font-display text-white font-bold uppercase tracking-wider" style={{ fontSize: "1vw", marginBottom: "1.5vh" }}>Daily Checklist</p>
            <ul className="space-y-[1.2vh]">
              {checks.map((c, i) => (
                <li key={i} className="flex items-start gap-[0.8vw]">
                  <span className="bg-orange text-white rounded-full inline-flex items-center justify-center font-display font-bold shrink-0" style={{ width: "1.6vw", height: "1.6vw", fontSize: "0.85vw" }}>{i + 1}</span>
                  <span className="font-body text-white/90" style={{ fontSize: "1.1vw", lineHeight: "1.5" }}>{c}</span>
                </li>
              ))}
            </ul>
            <div className="border-t border-white/15" style={{ marginTop: "2.5vh", paddingTop: "2vh" }}>
              <p className="font-body text-white/50" style={{ fontSize: "1vw" }}>Stuck? Reach out to your supervisor or the admin team.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
