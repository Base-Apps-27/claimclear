export default function ClosingSlide() {
  return (
    <div className="w-screen h-screen overflow-hidden relative bg-primary">
      <div className="absolute inset-0 bg-gradient-to-br from-primary via-primary to-navy-light" />
      <div className="absolute top-[15vh] right-[10vw] bg-accent/10 rounded-full" style={{ width: "20vw", height: "20vw" }} />
      <div className="absolute bottom-[10vh] left-[8vw] bg-orange/10 rounded-full" style={{ width: "12vw", height: "12vw" }} />
      <div className="relative z-10 flex flex-col items-center justify-center h-full text-center" style={{ padding: "8vh 12vw" }}>
        <div className="bg-orange rounded-[1.5vw] flex items-center justify-center" style={{ width: "6vw", height: "6vw", marginBottom: "3vh" }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: "3.5vw", height: "3.5vw" }}>
            <path d="M12 2L2 7l10 5 10-5-10-5z" />
            <path d="M2 17l10 5 10-5" />
            <path d="M2 12l10 5 10-5" />
          </svg>
        </div>
        <h2 className="font-display text-white font-extrabold tracking-tight" style={{ fontSize: "4.5vw", lineHeight: "1.1" }}>Ready to Start</h2>
        <p className="font-body text-white/50" style={{ fontSize: "1.8vw", marginTop: "2vh" }}>Access ClaimClear at cc.agapeny.app</p>
        <div className="bg-white/10 border border-white/20 rounded-[1vw]" style={{ padding: "2.5vh 4vw", marginTop: "5vh" }}>
          <p className="font-body text-white/70" style={{ fontSize: "1.4vw" }}>Questions? Reach out to your supervisor or the admin team.</p>
        </div>
        <p className="font-body text-white/30" style={{ fontSize: "1.2vw", marginTop: "4vh" }}>Agape Transportation -- ClaimClear Training Guide</p>
      </div>
    </div>
  );
}
