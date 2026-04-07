export default function DecisionWorkflows() {
  return (
    <div className="w-screen h-screen overflow-hidden relative bg-bg">
      <div className="absolute bottom-0 left-0 bg-orange/5 rounded-tr-full" style={{ width: "30vw", height: "30vh" }} />
      <div className="relative z-10 flex h-full" style={{ padding: "7vh 8vw" }}>
        <div style={{ flex: 1, paddingRight: "3vw" }}>
          <div className="flex items-center gap-[0.8vw]" style={{ marginBottom: "1.5vh" }}>
            <div className="bg-orange rounded-full" style={{ width: "0.6vw", height: "0.6vw" }} />
            <span className="font-body text-orange font-semibold tracking-wider uppercase" style={{ fontSize: "1.3vw" }}>Guided Decisions</span>
          </div>
          <h2 className="font-display text-primary font-bold tracking-tight" style={{ fontSize: "3.5vw", lineHeight: "1.1" }}>Workflow Player</h2>
          <p className="font-body text-muted" style={{ fontSize: "1.4vw", marginTop: "2vh", lineHeight: "1.6" }}>Each error type has a decision tree that guides you through the correct dispute process</p>
          <div style={{ marginTop: "4vh" }}>
            <div className="bg-white rounded-[1vw] border border-primary/10" style={{ padding: "2.5vh 2vw", marginBottom: "2vh" }}>
              <p className="font-display text-primary font-semibold" style={{ fontSize: "1.4vw" }}>Answer step-by-step questions</p>
              <p className="font-body text-muted" style={{ fontSize: "1.2vw", marginTop: "0.5vh" }}>Each question branches to different outcomes</p>
            </div>
            <div className="bg-white rounded-[1vw] border border-primary/10" style={{ padding: "2.5vh 2vw", marginBottom: "2vh" }}>
              <p className="font-display text-primary font-semibold" style={{ fontSize: "1.4vw" }}>Collect required evidence</p>
              <p className="font-body text-muted" style={{ fontSize: "1.2vw", marginTop: "0.5vh" }}>GPS logs, signatures, dispatch records</p>
            </div>
            <div className="bg-white rounded-[1vw] border border-primary/10" style={{ padding: "2.5vh 2vw" }}>
              <p className="font-display text-primary font-semibold" style={{ fontSize: "1.4vw" }}>Reach a clear outcome</p>
              <p className="font-body text-muted" style={{ fontSize: "1.2vw", marginTop: "0.5vh" }}>Portal dispute, internal resolve, hold, or escalate</p>
            </div>
          </div>
        </div>
        <div className="flex flex-col items-center justify-center" style={{ flex: 1 }}>
          <div className="bg-white rounded-[1.2vw] border border-primary/10 w-full" style={{ padding: "3vh 2.5vw" }}>
            <div className="bg-accent/10 rounded-[0.8vw] text-center" style={{ padding: "1.5vh 1vw", marginBottom: "2vh" }}>
              <p className="font-display text-accent font-bold" style={{ fontSize: "1.3vw" }}>Was the trip completed?</p>
            </div>
            <div className="flex justify-center gap-[2vw]" style={{ marginBottom: "2vh" }}>
              <div className="bg-primary/5 rounded-full" style={{ padding: "0.8vh 2vw" }}>
                <p className="font-body text-primary font-medium" style={{ fontSize: "1.2vw" }}>Yes</p>
              </div>
              <div className="bg-primary/5 rounded-full" style={{ padding: "0.8vh 2vw" }}>
                <p className="font-body text-primary font-medium" style={{ fontSize: "1.2vw" }}>No</p>
              </div>
            </div>
            <div className="border-l-2 border-accent/30" style={{ marginLeft: "3vw", paddingLeft: "1.5vw" }}>
              <div className="bg-accent/10 rounded-[0.8vw] text-center" style={{ padding: "1.5vh 1vw", marginBottom: "1.5vh" }}>
                <p className="font-display text-accent font-bold" style={{ fontSize: "1.2vw" }}>Can you verify with GPS?</p>
              </div>
              <div className="bg-orange/10 rounded-[0.8vw] text-center" style={{ padding: "1.2vh 1vw" }}>
                <p className="font-display text-orange font-bold" style={{ fontSize: "1.2vw" }}>&#8594; Submit Portal Dispute</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
