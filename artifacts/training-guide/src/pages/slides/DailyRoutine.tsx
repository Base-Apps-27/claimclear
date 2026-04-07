export default function DailyRoutine() {
  return (
    <div className="w-screen h-screen overflow-hidden relative bg-primary">
      <div className="absolute top-0 left-0 bg-accent/10 rounded-br-full" style={{ width: "30vw", height: "30vh" }} />
      <div className="absolute bottom-0 right-0 bg-white/5 rounded-tl-full" style={{ width: "35vw", height: "35vh" }} />
      <div className="relative z-10 flex flex-col h-full" style={{ padding: "7vh 8vw" }}>
        <div className="flex items-center gap-[0.8vw]" style={{ marginBottom: "1.5vh" }}>
          <div className="bg-orange rounded-full" style={{ width: "0.6vw", height: "0.6vw" }} />
          <span className="font-body text-orange font-semibold tracking-wider uppercase" style={{ fontSize: "1.3vw" }}>Your Daily Routine</span>
        </div>
        <h2 className="font-display text-white font-bold tracking-tight" style={{ fontSize: "3.8vw", lineHeight: "1.1" }}>Putting It All Together</h2>
        <p className="font-body text-white/50" style={{ fontSize: "1.5vw", marginTop: "1.5vh" }}>A typical day processing claims in ClaimClear</p>
        <div className="flex gap-[2vw]" style={{ marginTop: "4vh", flex: 1 }}>
          <div className="bg-white/10 border border-white/15 rounded-[1.2vw] flex flex-col" style={{ flex: 1, padding: "3vh 2vw" }}>
            <span className="font-display text-orange font-extrabold" style={{ fontSize: "2.5vw" }}>AM</span>
            <p className="font-display text-white font-bold" style={{ fontSize: "1.6vw", marginTop: "1.5vh" }}>Start with the Dashboard</p>
            <p className="font-body text-white/50" style={{ fontSize: "1.2vw", marginTop: "1vh", lineHeight: "1.5" }}>Check expiring claims first, then review bot status and any failed submissions</p>
          </div>
          <div className="bg-white/10 border border-white/15 rounded-[1.2vw] flex flex-col" style={{ flex: 1, padding: "3vh 2vw" }}>
            <span className="font-display text-accent font-extrabold" style={{ fontSize: "2.5vw" }}>MID</span>
            <p className="font-display text-white font-bold" style={{ fontSize: "1.6vw", marginTop: "1.5vh" }}>Process the Work Queue</p>
            <p className="font-body text-white/50" style={{ fontSize: "1.2vw", marginTop: "1vh", lineHeight: "1.5" }}>Work through Action Required claims -- follow decision trees, collect evidence, queue for submission</p>
          </div>
          <div className="bg-white/10 border border-white/15 rounded-[1.2vw] flex flex-col" style={{ flex: 1, padding: "3vh 2vw" }}>
            <span className="font-display text-white/60 font-extrabold" style={{ fontSize: "2.5vw" }}>PM</span>
            <p className="font-display text-white font-bold" style={{ fontSize: "1.6vw", marginTop: "1.5vh" }}>Import and Review</p>
            <p className="font-body text-white/50" style={{ fontSize: "1.2vw", marginTop: "1vh", lineHeight: "1.5" }}>Import any new rejection reports, verify portal submissions completed, check the Summary page</p>
          </div>
        </div>
      </div>
    </div>
  );
}
