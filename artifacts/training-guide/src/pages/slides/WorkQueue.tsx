export default function WorkQueue() {
  return (
    <div className="w-screen h-screen overflow-hidden relative bg-bg">
      <div className="absolute top-0 right-0 bg-primary/[0.03] rounded-bl-full" style={{ width: "45vw", height: "45vh" }} />
      <div className="relative z-10 flex flex-col h-full" style={{ padding: "7vh 8vw" }}>
        <div className="flex items-center gap-[0.8vw]" style={{ marginBottom: "1.5vh" }}>
          <div className="bg-accent rounded-full" style={{ width: "0.6vw", height: "0.6vw" }} />
          <span className="font-body text-accent font-semibold tracking-wider uppercase" style={{ fontSize: "1.3vw" }}>Daily Processing</span>
        </div>
        <h2 className="font-display text-primary font-bold tracking-tight" style={{ fontSize: "3.5vw", lineHeight: "1.1" }}>The Work Queue</h2>
        <p className="font-body text-muted" style={{ fontSize: "1.5vw", marginTop: "1.5vh" }}>Your task-oriented view for processing claims step by step</p>
        <div className="flex gap-[2vw]" style={{ marginTop: "4vh", flex: 1 }}>
          <div style={{ flex: 1 }}>
            <p className="font-display text-primary font-bold" style={{ fontSize: "1.6vw", marginBottom: "2vh" }}>Queue Tabs</p>
            <div className="bg-white rounded-[1vw] border border-primary/10" style={{ padding: "2vh 2vw", marginBottom: "1.5vh" }}>
              <div className="flex items-center justify-between">
                <p className="font-display text-primary font-semibold" style={{ fontSize: "1.4vw" }}>Action Required</p>
                <span className="bg-orange/10 text-orange font-display font-bold rounded-full" style={{ padding: "0.3vh 1vw", fontSize: "1.1vw" }}>12</span>
              </div>
              <p className="font-body text-muted" style={{ fontSize: "1.1vw", marginTop: "0.5vh" }}>Claims needing your review and decision</p>
            </div>
            <div className="bg-white rounded-[1vw] border border-primary/10" style={{ padding: "2vh 2vw", marginBottom: "1.5vh" }}>
              <div className="flex items-center justify-between">
                <p className="font-display text-primary font-semibold" style={{ fontSize: "1.4vw" }}>Portal Queued</p>
                <span className="bg-accent/10 text-accent font-display font-bold rounded-full" style={{ padding: "0.3vh 1vw", fontSize: "1.1vw" }}>5</span>
              </div>
              <p className="font-body text-muted" style={{ fontSize: "1.1vw", marginTop: "0.5vh" }}>Waiting for bot to submit to MAS portal</p>
            </div>
            <div className="bg-white rounded-[1vw] border border-primary/10" style={{ padding: "2vh 2vw" }}>
              <div className="flex items-center justify-between">
                <p className="font-display text-primary font-semibold" style={{ fontSize: "1.4vw" }}>On Hold</p>
                <span className="bg-muted/10 text-muted font-display font-bold rounded-full" style={{ padding: "0.3vh 1vw", fontSize: "1.1vw" }}>3</span>
              </div>
              <p className="font-body text-muted" style={{ fontSize: "1.1vw", marginTop: "0.5vh" }}>Paused, waiting for more information</p>
            </div>
          </div>
          <div className="bg-primary rounded-[1.2vw]" style={{ flex: 1, padding: "3vh 2.5vw" }}>
            <p className="font-display text-white font-bold" style={{ fontSize: "1.6vw", marginBottom: "2vh" }}>Split-Pane Layout</p>
            <p className="font-body text-white/60" style={{ fontSize: "1.3vw", lineHeight: "1.6" }}>Left side shows the claim list. Click any claim to open it on the right side, where you review details and follow the guided workflow.</p>
            <div className="bg-white/10 border border-white/20 rounded-[0.8vw]" style={{ padding: "2vh 1.5vw", marginTop: "2vh" }}>
              <p className="font-body text-white/80" style={{ fontSize: "1.2vw" }}>Tip: The presence indicator shows who else is viewing a claim to prevent duplicate work</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
