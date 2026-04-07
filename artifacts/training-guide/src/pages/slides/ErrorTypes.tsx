export default function ErrorTypes() {
  return (
    <div className="w-screen h-screen overflow-hidden relative bg-bg">
      <div className="absolute top-0 right-0 bg-orange/5 rounded-bl-full" style={{ width: "35vw", height: "35vh" }} />
      <div className="relative z-10 flex flex-col h-full" style={{ padding: "7vh 8vw" }}>
        <div className="flex items-center gap-[0.8vw]" style={{ marginBottom: "1.5vh" }}>
          <div className="bg-orange rounded-full" style={{ width: "0.6vw", height: "0.6vw" }} />
          <span className="font-body text-orange font-semibold tracking-wider uppercase" style={{ fontSize: "1.3vw" }}>Configuration</span>
        </div>
        <h2 className="font-display text-primary font-bold tracking-tight" style={{ fontSize: "3.5vw", lineHeight: "1.1" }}>Error Types and SOPs</h2>
        <p className="font-body text-muted" style={{ fontSize: "1.5vw", marginTop: "1.5vh" }}>Admins configure the rules that drive every claim workflow</p>
        <div className="flex gap-[2.5vw]" style={{ marginTop: "4vh", flex: 1 }}>
          <div style={{ flex: 1 }}>
            <div className="bg-white rounded-[1vw] border border-primary/10" style={{ padding: "2.5vh 2vw", marginBottom: "2vh" }}>
              <p className="font-display text-primary font-bold" style={{ fontSize: "1.6vw" }}>Decision Tree Builder</p>
              <p className="font-body text-muted" style={{ fontSize: "1.2vw", marginTop: "1vh", lineHeight: "1.5" }}>Visual editor to create branching question workflows with outcomes at each path</p>
            </div>
            <div className="bg-white rounded-[1vw] border border-primary/10" style={{ padding: "2.5vh 2vw", marginBottom: "2vh" }}>
              <p className="font-display text-primary font-bold" style={{ fontSize: "1.6vw" }}>AI-Powered Builders</p>
              <p className="font-body text-muted" style={{ fontSize: "1.2vw", marginTop: "1vh", lineHeight: "1.5" }}>Paste SOPs, describe workflows in plain language, or use the guided wizard</p>
            </div>
            <div className="bg-white rounded-[1vw] border border-primary/10" style={{ padding: "2.5vh 2vw" }}>
              <p className="font-display text-primary font-bold" style={{ fontSize: "1.6vw" }}>Evidence Requirements</p>
              <p className="font-body text-muted" style={{ fontSize: "1.2vw", marginTop: "1vh", lineHeight: "1.5" }}>Define what documents are needed at each workflow step</p>
            </div>
          </div>
          <div className="bg-primary rounded-[1.2vw] flex flex-col justify-center" style={{ flex: 1, padding: "3vh 2.5vw" }}>
            <p className="font-display text-white font-bold" style={{ fontSize: "1.8vw", marginBottom: "2.5vh" }}>Outcome Types</p>
            <div className="flex items-center gap-[1vw]" style={{ marginBottom: "2vh" }}>
              <div className="bg-accent rounded-full" style={{ width: "1vw", height: "1vw" }} />
              <p className="font-body text-white/80" style={{ fontSize: "1.4vw" }}>Portal Dispute -- submit via MAS portal</p>
            </div>
            <div className="flex items-center gap-[1vw]" style={{ marginBottom: "2vh" }}>
              <div className="bg-orange rounded-full" style={{ width: "1vw", height: "1vw" }} />
              <p className="font-body text-white/80" style={{ fontSize: "1.4vw" }}>Internal Resolve -- handle without portal</p>
            </div>
            <div className="flex items-center gap-[1vw]" style={{ marginBottom: "2vh" }}>
              <div className="bg-white/40 rounded-full" style={{ width: "1vw", height: "1vw" }} />
              <p className="font-body text-white/80" style={{ fontSize: "1.4vw" }}>Hold -- pause for more information</p>
            </div>
            <div className="flex items-center gap-[1vw]">
              <div className="bg-white/70 rounded-full" style={{ width: "1vw", height: "1vw" }} />
              <p className="font-body text-white/80" style={{ fontSize: "1.4vw" }}>Dispute -- manual email submission</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
