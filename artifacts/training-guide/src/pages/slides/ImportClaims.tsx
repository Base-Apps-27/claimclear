export default function ImportClaims() {
  return (
    <div className="w-screen h-screen overflow-hidden relative bg-bg">
      <div className="absolute bottom-0 right-0 bg-accent/5 rounded-tl-full" style={{ width: "35vw", height: "35vh" }} />
      <div className="relative z-10 flex h-full" style={{ padding: "7vh 8vw" }}>
        <div style={{ flex: 1, paddingRight: "4vw" }}>
          <div className="flex items-center gap-[0.8vw]" style={{ marginBottom: "1.5vh" }}>
            <div className="bg-orange rounded-full" style={{ width: "0.6vw", height: "0.6vw" }} />
            <span className="font-body text-orange font-semibold tracking-wider uppercase" style={{ fontSize: "1.3vw" }}>Morning Upload</span>
          </div>
          <h2 className="font-display text-primary font-bold tracking-tight" style={{ fontSize: "3.5vw", lineHeight: "1.1" }}>Import Claims</h2>
          <p className="font-body text-muted" style={{ fontSize: "1.5vw", marginTop: "2vh", lineHeight: "1.6" }}>After submitting the initial attestation, export claims that couldn't be submitted and upload them to ClaimClear</p>
          <div style={{ marginTop: "4vh" }}>
            <div className="flex items-start gap-[1.2vw]" style={{ marginBottom: "3vh" }}>
              <div className="bg-accent/10 rounded-full shrink-0 flex items-center justify-center" style={{ width: "2.5vw", height: "2.5vw" }}>
                <span className="font-display text-accent font-bold" style={{ fontSize: "1.2vw" }}>1</span>
              </div>
              <div>
                <p className="font-display text-primary font-semibold" style={{ fontSize: "1.5vw" }}>Submit attestation on MAS portal</p>
                <p className="font-body text-muted" style={{ fontSize: "1.2vw", marginTop: "0.3vh" }}>Complete the initial attestation first thing each morning</p>
              </div>
            </div>
            <div className="flex items-start gap-[1.2vw]" style={{ marginBottom: "3vh" }}>
              <div className="bg-accent/10 rounded-full shrink-0 flex items-center justify-center" style={{ width: "2.5vw", height: "2.5vw" }}>
                <span className="font-display text-accent font-bold" style={{ fontSize: "1.2vw" }}>2</span>
              </div>
              <div>
                <p className="font-display text-primary font-semibold" style={{ fontSize: "1.5vw" }}>Export unable-to-submit claims</p>
                <p className="font-body text-muted" style={{ fontSize: "1.2vw", marginTop: "0.3vh" }}>Download the report of claims that could not be submitted</p>
              </div>
            </div>
            <div className="flex items-start gap-[1.2vw]" style={{ marginBottom: "3vh" }}>
              <div className="bg-orange/10 rounded-full shrink-0 flex items-center justify-center" style={{ width: "2.5vw", height: "2.5vw" }}>
                <span className="font-display text-orange font-bold" style={{ fontSize: "1.2vw" }}>3</span>
              </div>
              <div>
                <p className="font-display text-primary font-semibold" style={{ fontSize: "1.5vw" }}>Remove the Member Name column</p>
                <p className="font-body text-muted" style={{ fontSize: "1.2vw", marginTop: "0.3vh" }}>Delete this column from the file before uploading to ClaimClear</p>
              </div>
            </div>
            <div className="flex items-start gap-[1.2vw]">
              <div className="bg-accent/10 rounded-full shrink-0 flex items-center justify-center" style={{ width: "2.5vw", height: "2.5vw" }}>
                <span className="font-display text-accent font-bold" style={{ fontSize: "1.2vw" }}>4</span>
              </div>
              <div>
                <p className="font-display text-primary font-semibold" style={{ fontSize: "1.5vw" }}>Upload to ClaimClear</p>
                <p className="font-body text-muted" style={{ fontSize: "1.2vw", marginTop: "0.3vh" }}>Drag and drop or browse — system auto-maps columns and classifies errors</p>
              </div>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-[1.2vw] border border-primary/10 flex flex-col justify-between" style={{ flex: 1, padding: "3.5vh 3vw" }}>
          <div>
            <div className="flex items-center gap-[0.6vw]" style={{ marginBottom: "2vh" }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="#E85D3A" strokeWidth="2" style={{ width: "1.6vw", height: "1.6vw" }}><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              <p className="font-display text-orange font-bold" style={{ fontSize: "1.4vw" }}>Important</p>
            </div>
            <p className="font-body text-primary" style={{ fontSize: "1.2vw", lineHeight: "1.6" }}>Always remove the <span className="font-semibold">Member Name</span> column before uploading. This column contains protected information and is not needed by ClaimClear.</p>
          </div>
          <div className="border-2 border-dashed border-accent/30 rounded-[1vw] flex flex-col items-center justify-center" style={{ padding: "4vh 2vw" }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="#3478F6" strokeWidth="1.5" style={{ width: "3.5vw", height: "3.5vw", marginBottom: "1.5vh" }}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
            <p className="font-display text-primary font-semibold" style={{ fontSize: "1.4vw" }}>Drop your cleaned report here</p>
            <p className="font-body text-muted" style={{ fontSize: "1.1vw", marginTop: "0.8vh" }}>CSV or Excel format accepted</p>
          </div>
        </div>
      </div>
    </div>
  );
}
