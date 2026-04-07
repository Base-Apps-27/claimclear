export default function PortalSubmissions() {
  return (
    <div className="w-screen h-screen overflow-hidden relative bg-primary">
      <div className="absolute top-0 right-0 bg-white/5 rounded-bl-full" style={{ width: "40vw", height: "40vh" }} />
      <div className="absolute bottom-0 left-0 bg-accent/10 rounded-tr-full" style={{ width: "25vw", height: "25vh" }} />
      <div className="relative z-10 flex h-full" style={{ padding: "7vh 8vw" }}>
        <div style={{ flex: 1, paddingRight: "3vw" }}>
          <div className="flex items-center gap-[0.8vw]" style={{ marginBottom: "1.5vh" }}>
            <div className="bg-orange rounded-full" style={{ width: "0.6vw", height: "0.6vw" }} />
            <span className="font-body text-orange font-semibold tracking-wider uppercase" style={{ fontSize: "1.3vw" }}>Automation</span>
          </div>
          <h2 className="font-display text-white font-bold tracking-tight" style={{ fontSize: "3.5vw", lineHeight: "1.1" }}>Portal Submissions</h2>
          <p className="font-body text-white/50" style={{ fontSize: "1.5vw", marginTop: "2vh", lineHeight: "1.6" }}>Our bot fleet automatically submits disputes to the MAS portal on your behalf</p>
          <div style={{ marginTop: "4vh" }}>
            <div className="flex items-center gap-[1vw]" style={{ marginBottom: "2.5vh" }}>
              <div className="bg-accent rounded-full" style={{ width: "0.8vw", height: "0.8vw" }} />
              <p className="font-body text-white/80" style={{ fontSize: "1.4vw" }}>AI generates a tailored dispute description</p>
            </div>
            <div className="flex items-center gap-[1vw]" style={{ marginBottom: "2.5vh" }}>
              <div className="bg-accent rounded-full" style={{ width: "0.8vw", height: "0.8vw" }} />
              <p className="font-body text-white/80" style={{ fontSize: "1.4vw" }}>Bot logs in, fills forms, uploads evidence</p>
            </div>
            <div className="flex items-center gap-[1vw]" style={{ marginBottom: "2.5vh" }}>
              <div className="bg-accent rounded-full" style={{ width: "0.8vw", height: "0.8vw" }} />
              <p className="font-body text-white/80" style={{ fontSize: "1.4vw" }}>Captures portal ticket ID and screenshots</p>
            </div>
            <div className="flex items-center gap-[1vw]">
              <div className="bg-accent rounded-full" style={{ width: "0.8vw", height: "0.8vw" }} />
              <p className="font-body text-white/80" style={{ fontSize: "1.4vw" }}>Retry failed submissions with one click</p>
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-[1.5vh]" style={{ flex: 1 }}>
          <div className="bg-white/10 border border-white/15 rounded-[1vw]" style={{ padding: "2vh 2vw" }}>
            <div className="flex items-center justify-between" style={{ marginBottom: "1vh" }}>
              <p className="font-display text-white font-semibold" style={{ fontSize: "1.4vw" }}>Pending</p>
              <span className="bg-orange/20 text-orange rounded-full font-display font-bold" style={{ padding: "0.3vh 1.2vw", fontSize: "1.1vw" }}>3</span>
            </div>
            <p className="font-body text-white/40" style={{ fontSize: "1.1vw" }}>Queued and waiting for bot pickup</p>
          </div>
          <div className="bg-white/10 border border-white/15 rounded-[1vw]" style={{ padding: "2vh 2vw" }}>
            <div className="flex items-center justify-between" style={{ marginBottom: "1vh" }}>
              <p className="font-display text-white font-semibold" style={{ fontSize: "1.4vw" }}>In Progress</p>
              <span className="bg-accent/20 text-accent rounded-full font-display font-bold" style={{ padding: "0.3vh 1.2vw", fontSize: "1.1vw" }}>1</span>
            </div>
            <p className="font-body text-white/40" style={{ fontSize: "1.1vw" }}>Bot actively working on submission</p>
          </div>
          <div className="bg-white/10 border border-white/15 rounded-[1vw]" style={{ padding: "2vh 2vw" }}>
            <div className="flex items-center justify-between" style={{ marginBottom: "1vh" }}>
              <p className="font-display text-white font-semibold" style={{ fontSize: "1.4vw" }}>Submitted</p>
              <span className="bg-white/15 text-white/70 rounded-full font-display font-bold" style={{ padding: "0.3vh 1.2vw", fontSize: "1.1vw" }}>24</span>
            </div>
            <p className="font-body text-white/40" style={{ fontSize: "1.1vw" }}>Successfully submitted with ticket IDs</p>
          </div>
          <div className="bg-white/10 border border-white/15 rounded-[1vw]" style={{ padding: "2vh 2vw" }}>
            <div className="flex items-center justify-between" style={{ marginBottom: "1vh" }}>
              <p className="font-display text-white font-semibold" style={{ fontSize: "1.4vw" }}>Activity Log</p>
            </div>
            <p className="font-body text-white/40" style={{ fontSize: "1.1vw" }}>Granular timeline of every bot action</p>
          </div>
        </div>
      </div>
    </div>
  );
}
