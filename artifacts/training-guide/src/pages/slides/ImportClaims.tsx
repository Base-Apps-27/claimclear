export default function ImportClaims() {
  return (
    <div className="w-screen h-screen overflow-hidden relative bg-bg">
      <div className="absolute bottom-0 right-0 bg-accent/5 rounded-tl-full" style={{ width: "35vw", height: "35vh" }} />
      <div className="relative z-10 flex h-full" style={{ padding: "7vh 8vw" }}>
        <div style={{ flex: 1, paddingRight: "4vw" }}>
          <div className="flex items-center gap-[0.8vw]" style={{ marginBottom: "1.5vh" }}>
            <div className="bg-orange rounded-full" style={{ width: "0.6vw", height: "0.6vw" }} />
            <span className="font-body text-orange font-semibold tracking-wider uppercase" style={{ fontSize: "1.3vw" }}>Step 1</span>
          </div>
          <h2 className="font-display text-primary font-bold tracking-tight" style={{ fontSize: "3.5vw", lineHeight: "1.1" }}>Import Claims</h2>
          <p className="font-body text-muted" style={{ fontSize: "1.5vw", marginTop: "2vh", lineHeight: "1.6" }}>Upload your MAS Job Claim Status report to load rejected claims into the system</p>
          <div style={{ marginTop: "5vh" }}>
            <div className="flex items-start gap-[1.2vw]" style={{ marginBottom: "3.5vh" }}>
              <div className="bg-accent/10 rounded-full shrink-0 flex items-center justify-center" style={{ width: "2.5vw", height: "2.5vw" }}>
                <span className="font-display text-accent font-bold" style={{ fontSize: "1.2vw" }}>1</span>
              </div>
              <div>
                <p className="font-display text-primary font-semibold" style={{ fontSize: "1.5vw" }}>Upload CSV or Excel file</p>
                <p className="font-body text-muted" style={{ fontSize: "1.2vw", marginTop: "0.3vh" }}>Drag and drop or browse for your report</p>
              </div>
            </div>
            <div className="flex items-start gap-[1.2vw]" style={{ marginBottom: "3.5vh" }}>
              <div className="bg-accent/10 rounded-full shrink-0 flex items-center justify-center" style={{ width: "2.5vw", height: "2.5vw" }}>
                <span className="font-display text-accent font-bold" style={{ fontSize: "1.2vw" }}>2</span>
              </div>
              <div>
                <p className="font-display text-primary font-semibold" style={{ fontSize: "1.5vw" }}>Auto-maps column headers</p>
                <p className="font-body text-muted" style={{ fontSize: "1.2vw", marginTop: "0.3vh" }}>System detects fields like Trip ID, Date, Amount</p>
              </div>
            </div>
            <div className="flex items-start gap-[1.2vw]">
              <div className="bg-accent/10 rounded-full shrink-0 flex items-center justify-center" style={{ width: "2.5vw", height: "2.5vw" }}>
                <span className="font-display text-accent font-bold" style={{ fontSize: "1.2vw" }}>3</span>
              </div>
              <div>
                <p className="font-display text-primary font-semibold" style={{ fontSize: "1.5vw" }}>Auto-classifies error types</p>
                <p className="font-body text-muted" style={{ fontSize: "1.2vw", marginTop: "0.3vh" }}>Pre-categorizes claims based on rejection reason</p>
              </div>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-[1.2vw] border border-primary/10 flex flex-col justify-center" style={{ flex: 1, padding: "4vh 3vw" }}>
          <div className="border-2 border-dashed border-accent/30 rounded-[1vw] flex flex-col items-center justify-center" style={{ padding: "5vh 2vw" }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="#3478F6" strokeWidth="1.5" style={{ width: "4vw", height: "4vw", marginBottom: "2vh" }}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
            <p className="font-display text-primary font-semibold" style={{ fontSize: "1.6vw" }}>Drop your report here</p>
            <p className="font-body text-muted" style={{ fontSize: "1.2vw", marginTop: "1vh" }}>CSV or Excel format accepted</p>
          </div>
        </div>
      </div>
    </div>
  );
}
