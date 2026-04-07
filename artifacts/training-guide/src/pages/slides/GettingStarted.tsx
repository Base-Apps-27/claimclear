export default function GettingStarted() {
  return (
    <div className="w-screen h-screen overflow-hidden relative bg-primary">
      <div className="absolute top-0 right-0 bg-white/5 rounded-bl-full" style={{ width: "50vw", height: "50vh" }} />
      <div className="absolute bottom-[10vh] left-[5vw] bg-accent/10 rounded-full" style={{ width: "15vw", height: "15vw" }} />
      <div className="relative z-10 flex flex-col h-full" style={{ padding: "7vh 8vw" }}>
        <div className="flex items-center gap-[0.8vw]" style={{ marginBottom: "1.5vh" }}>
          <div className="bg-orange rounded-full" style={{ width: "0.6vw", height: "0.6vw" }} />
          <span className="font-body text-orange font-semibold tracking-wider uppercase" style={{ fontSize: "1.3vw" }}>Getting Started</span>
        </div>
        <h2 className="font-display text-white font-bold tracking-tight" style={{ fontSize: "3.8vw", lineHeight: "1.1" }}>Sign In and Navigate</h2>
        <p className="font-body text-white/50" style={{ fontSize: "1.5vw", marginTop: "1.5vh" }}>Access ClaimClear at cc.agapeny.app</p>
        <div className="flex gap-[3vw] flex-1 items-start" style={{ marginTop: "5vh" }}>
          <div style={{ flex: 1 }}>
            <div className="flex items-start gap-[1vw]" style={{ marginBottom: "4vh" }}>
              <div className="bg-accent rounded-full flex items-center justify-center shrink-0 font-display text-white font-bold" style={{ width: "3vw", height: "3vw", fontSize: "1.4vw" }}>1</div>
              <div>
                <h3 className="font-display text-white font-bold" style={{ fontSize: "1.8vw" }}>Sign in with Replit</h3>
                <p className="font-body text-white/50" style={{ fontSize: "1.3vw", marginTop: "0.5vh" }}>Use your assigned Replit account credentials</p>
              </div>
            </div>
            <div className="flex items-start gap-[1vw]" style={{ marginBottom: "4vh" }}>
              <div className="bg-accent rounded-full flex items-center justify-center shrink-0 font-display text-white font-bold" style={{ width: "3vw", height: "3vw", fontSize: "1.4vw" }}>2</div>
              <div>
                <h3 className="font-display text-white font-bold" style={{ fontSize: "1.8vw" }}>Admin Approval</h3>
                <p className="font-body text-white/50" style={{ fontSize: "1.3vw", marginTop: "0.5vh" }}>New accounts require admin approval before access</p>
              </div>
            </div>
            <div className="flex items-start gap-[1vw]">
              <div className="bg-accent rounded-full flex items-center justify-center shrink-0 font-display text-white font-bold" style={{ width: "3vw", height: "3vw", fontSize: "1.4vw" }}>3</div>
              <div>
                <h3 className="font-display text-white font-bold" style={{ fontSize: "1.8vw" }}>Explore the Sidebar</h3>
                <p className="font-body text-white/50" style={{ fontSize: "1.3vw", marginTop: "0.5vh" }}>Navigate between Dashboard, Queue, Claims, Import, and more</p>
              </div>
            </div>
          </div>
          <div className="bg-navy-light/80 rounded-[1.2vw] border border-white/10" style={{ flex: 1, padding: "3vh 2.5vw" }}>
            <p className="font-body text-accent font-semibold tracking-wider uppercase" style={{ fontSize: "1.1vw", marginBottom: "2vh" }}>Sidebar Modules</p>
            <div className="flex items-center gap-[0.8vw] text-white/80 font-body" style={{ fontSize: "1.4vw", marginBottom: "1.8vh" }}>
              <span className="text-accent">&#9670;</span> Dashboard
            </div>
            <div className="flex items-center gap-[0.8vw] text-white/80 font-body" style={{ fontSize: "1.4vw", marginBottom: "1.8vh" }}>
              <span className="text-accent">&#9670;</span> Work Queue
            </div>
            <div className="flex items-center gap-[0.8vw] text-white/80 font-body" style={{ fontSize: "1.4vw", marginBottom: "1.8vh" }}>
              <span className="text-accent">&#9670;</span> All Claims
            </div>
            <div className="flex items-center gap-[0.8vw] text-white/80 font-body" style={{ fontSize: "1.4vw", marginBottom: "1.8vh" }}>
              <span className="text-accent">&#9670;</span> Import
            </div>
            <div className="flex items-center gap-[0.8vw] text-white/80 font-body" style={{ fontSize: "1.4vw", marginBottom: "1.8vh" }}>
              <span className="text-accent">&#9670;</span> Error Types
            </div>
            <div className="flex items-center gap-[0.8vw] text-white/80 font-body" style={{ fontSize: "1.4vw" }}>
              <span className="text-accent">&#9670;</span> Portal Submissions
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
