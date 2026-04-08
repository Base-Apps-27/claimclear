const base = import.meta.env.BASE_URL;

export default function SectionWorkflow() {
  return (
    <div className="w-screen h-screen overflow-hidden relative">
      <img
        src={`${base}section-bg.png`}
        crossOrigin="anonymous"
        className="absolute inset-0 w-full h-full object-cover"
        alt="Abstract pattern"
      />
      <div className="absolute inset-0 bg-primary/85" />
      <div className="relative z-10 flex flex-col items-center justify-center h-full text-center" style={{ padding: "8vh 12vw" }}>
        <div className="bg-orange/20 border border-orange/30 rounded-full" style={{ padding: "1.2vh 2vw", marginBottom: "3vh" }}>
          <span className="font-body text-orange font-semibold tracking-wider uppercase" style={{ fontSize: "1.3vw" }}>Core Workflow</span>
        </div>
        <h2 className="font-display text-white font-extrabold tracking-tight" style={{ fontSize: "5vw", lineHeight: "1.1" }}>Processing Claims</h2>
        <p className="font-body text-white/50" style={{ fontSize: "1.8vw", marginTop: "2.5vh", maxWidth: "55vw" }}>Morning upload, then spend the day working the queue</p>
        <div className="flex items-center gap-[1.5vw]" style={{ marginTop: "6vh" }}>
          <div className="bg-white/10 border border-white/20 rounded-[1vw]" style={{ padding: "2vh 2vw" }}>
            <p className="font-display text-white font-bold" style={{ fontSize: "1.4vw" }}>Attest</p>
          </div>
          <span className="font-display text-white/30" style={{ fontSize: "2vw" }}>&#8594;</span>
          <div className="bg-white/10 border border-white/20 rounded-[1vw]" style={{ padding: "2vh 2vw" }}>
            <p className="font-display text-white font-bold" style={{ fontSize: "1.4vw" }}>Export</p>
          </div>
          <span className="font-display text-white/30" style={{ fontSize: "2vw" }}>&#8594;</span>
          <div className="bg-orange/20 border border-orange/40 rounded-[1vw]" style={{ padding: "2vh 2vw" }}>
            <p className="font-display text-orange font-bold" style={{ fontSize: "1.4vw" }}>Clean</p>
          </div>
          <span className="font-display text-white/30" style={{ fontSize: "2vw" }}>&#8594;</span>
          <div className="bg-white/10 border border-white/20 rounded-[1vw]" style={{ padding: "2vh 2vw" }}>
            <p className="font-display text-white font-bold" style={{ fontSize: "1.4vw" }}>Upload</p>
          </div>
          <span className="font-display text-white/30" style={{ fontSize: "2vw" }}>&#8594;</span>
          <div className="bg-accent/20 border border-accent/40 rounded-[1vw]" style={{ padding: "2vh 2vw" }}>
            <p className="font-display text-accent font-bold" style={{ fontSize: "1.4vw" }}>Process</p>
          </div>
        </div>
      </div>
    </div>
  );
}
