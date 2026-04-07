export default function WhatIsClaimClear() {
  return (
    <div className="w-screen h-screen overflow-hidden relative bg-bg">
      <div className="absolute top-0 right-0 bg-accent/5 rounded-bl-full" style={{ width: "40vw", height: "40vh" }} />
      <div className="absolute bottom-0 left-0 bg-primary/5 rounded-tr-full" style={{ width: "30vw", height: "30vh" }} />
      <div className="relative z-10 flex flex-col h-full" style={{ padding: "7vh 8vw" }}>
        <div className="flex items-center gap-[0.8vw]" style={{ marginBottom: "1.5vh" }}>
          <div className="bg-accent rounded-full" style={{ width: "0.6vw", height: "0.6vw" }} />
          <span className="font-body text-accent font-semibold tracking-wider uppercase" style={{ fontSize: "1.3vw" }}>Overview</span>
        </div>
        <h2 className="font-display text-primary font-bold tracking-tight" style={{ fontSize: "3.8vw", lineHeight: "1.1" }}>What is ClaimClear?</h2>
        <p className="font-body text-muted" style={{ fontSize: "1.6vw", marginTop: "2vh", maxWidth: "60vw" }}>Your single platform to track, dispute, and recover rejected NEMT claims from MAS</p>
        <div className="flex gap-[2.5vw] flex-1 items-center" style={{ marginTop: "3vh" }}>
          <div className="bg-white rounded-[1.2vw] border border-primary/10 flex flex-col items-center justify-center text-center" style={{ flex: 1, padding: "3vh 2vw", height: "38vh" }}>
            <div className="bg-accent/10 rounded-full flex items-center justify-center" style={{ width: "4.5vw", height: "4.5vw", marginBottom: "2vh" }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="#3478F6" strokeWidth="2" style={{ width: "2.2vw", height: "2.2vw" }}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
            </div>
            <h3 className="font-display text-primary font-bold" style={{ fontSize: "1.8vw" }}>Import</h3>
            <p className="font-body text-muted" style={{ fontSize: "1.3vw", marginTop: "1vh" }}>Bulk-load rejected claims from MAS reports</p>
          </div>
          <div className="bg-white rounded-[1.2vw] border border-primary/10 flex flex-col items-center justify-center text-center" style={{ flex: 1, padding: "3vh 2vw", height: "38vh" }}>
            <div className="bg-orange/10 rounded-full flex items-center justify-center" style={{ width: "4.5vw", height: "4.5vw", marginBottom: "2vh" }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="#E85D3A" strokeWidth="2" style={{ width: "2.2vw", height: "2.2vw" }}><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>
            </div>
            <h3 className="font-display text-primary font-bold" style={{ fontSize: "1.8vw" }}>Decide</h3>
            <p className="font-body text-muted" style={{ fontSize: "1.3vw", marginTop: "1vh" }}>Follow guided workflows to determine the best dispute path</p>
          </div>
          <div className="bg-white rounded-[1.2vw] border border-primary/10 flex flex-col items-center justify-center text-center" style={{ flex: 1, padding: "3vh 2vw", height: "38vh" }}>
            <div className="bg-primary/10 rounded-full flex items-center justify-center" style={{ width: "4.5vw", height: "4.5vw", marginBottom: "2vh" }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="#1B2A4A" strokeWidth="2" style={{ width: "2.2vw", height: "2.2vw" }}><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
            </div>
            <h3 className="font-display text-primary font-bold" style={{ fontSize: "1.8vw" }}>Submit</h3>
            <p className="font-body text-muted" style={{ fontSize: "1.3vw", marginTop: "1vh" }}>Automated portal submissions via our bot fleet</p>
          </div>
        </div>
      </div>
    </div>
  );
}
