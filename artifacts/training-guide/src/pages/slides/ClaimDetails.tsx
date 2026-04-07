export default function ClaimDetails() {
  return (
    <div className="w-screen h-screen overflow-hidden relative bg-bg">
      <div className="absolute top-0 left-0 right-0 bg-gradient-to-b from-accent/[0.03] to-transparent" style={{ height: "35vh" }} />
      <div className="relative z-10 flex flex-col h-full" style={{ padding: "7vh 8vw" }}>
        <div className="flex items-center gap-[0.8vw]" style={{ marginBottom: "1.5vh" }}>
          <div className="bg-accent rounded-full" style={{ width: "0.6vw", height: "0.6vw" }} />
          <span className="font-body text-accent font-semibold tracking-wider uppercase" style={{ fontSize: "1.3vw" }}>Deep Dive</span>
        </div>
        <h2 className="font-display text-primary font-bold tracking-tight" style={{ fontSize: "3.5vw", lineHeight: "1.1" }}>Claim Details</h2>
        <p className="font-body text-muted" style={{ fontSize: "1.5vw", marginTop: "1.5vh" }}>Everything about a single claim in one place</p>
        <div className="grid grid-cols-3 gap-[1.5vw]" style={{ marginTop: "4vh", flex: 1 }}>
          <div className="bg-white rounded-[1vw] border border-primary/10" style={{ padding: "2.5vh 2vw" }}>
            <div className="bg-accent/10 rounded-full flex items-center justify-center" style={{ width: "3vw", height: "3vw", marginBottom: "1.5vh" }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="#3478F6" strokeWidth="2" style={{ width: "1.5vw", height: "1.5vw" }}><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
            </div>
            <p className="font-display text-primary font-bold" style={{ fontSize: "1.5vw" }}>Edit Data</p>
            <p className="font-body text-muted" style={{ fontSize: "1.2vw", marginTop: "1vh", lineHeight: "1.5" }}>Update confirmation numbers, dates, amounts, and assign error types</p>
          </div>
          <div className="bg-white rounded-[1vw] border border-primary/10" style={{ padding: "2.5vh 2vw" }}>
            <div className="bg-orange/10 rounded-full flex items-center justify-center" style={{ width: "3vw", height: "3vw", marginBottom: "1.5vh" }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="#E85D3A" strokeWidth="2" style={{ width: "1.5vw", height: "1.5vw" }}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
            </div>
            <p className="font-display text-primary font-bold" style={{ fontSize: "1.5vw" }}>Evidence</p>
            <p className="font-body text-muted" style={{ fontSize: "1.2vw", marginTop: "1vh", lineHeight: "1.5" }}>Upload and manage supporting documents like GPS logs and signatures</p>
          </div>
          <div className="bg-white rounded-[1vw] border border-primary/10" style={{ padding: "2.5vh 2vw" }}>
            <div className="bg-primary/10 rounded-full flex items-center justify-center" style={{ width: "3vw", height: "3vw", marginBottom: "1.5vh" }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="#1B2A4A" strokeWidth="2" style={{ width: "1.5vw", height: "1.5vw" }}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
            </div>
            <p className="font-display text-primary font-bold" style={{ fontSize: "1.5vw" }}>Notes and Logs</p>
            <p className="font-body text-muted" style={{ fontSize: "1.2vw", marginTop: "1vh", lineHeight: "1.5" }}>Full audit trail plus internal discussion between staff members</p>
          </div>
          <div className="bg-white rounded-[1vw] border border-primary/10" style={{ padding: "2.5vh 2vw" }}>
            <div className="bg-accent/10 rounded-full flex items-center justify-center" style={{ width: "3vw", height: "3vw", marginBottom: "1.5vh" }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="#3478F6" strokeWidth="2" style={{ width: "1.5vw", height: "1.5vw" }}><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>
            </div>
            <p className="font-display text-primary font-bold" style={{ fontSize: "1.5vw" }}>AI Dispute Letter</p>
            <p className="font-body text-muted" style={{ fontSize: "1.2vw", marginTop: "1vh", lineHeight: "1.5" }}>Auto-generated dispute notes tailored to the specific rejection reason</p>
          </div>
          <div className="bg-white rounded-[1vw] border border-primary/10" style={{ padding: "2.5vh 2vw" }}>
            <div className="bg-orange/10 rounded-full flex items-center justify-center" style={{ width: "3vw", height: "3vw", marginBottom: "1.5vh" }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="#E85D3A" strokeWidth="2" style={{ width: "1.5vw", height: "1.5vw" }}><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
            </div>
            <p className="font-display text-primary font-bold" style={{ fontSize: "1.5vw" }}>Status Tracking</p>
            <p className="font-body text-muted" style={{ fontSize: "1.2vw", marginTop: "1vh", lineHeight: "1.5" }}>See exactly where each claim stands in the dispute lifecycle</p>
          </div>
          <div className="bg-white rounded-[1vw] border border-primary/10" style={{ padding: "2.5vh 2vw" }}>
            <div className="bg-primary/10 rounded-full flex items-center justify-center" style={{ width: "3vw", height: "3vw", marginBottom: "1.5vh" }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="#1B2A4A" strokeWidth="2" style={{ width: "1.5vw", height: "1.5vw" }}><rect x="1" y="4" width="22" height="16" rx="2" ry="2" /><line x1="1" y1="10" x2="23" y2="10" /></svg>
            </div>
            <p className="font-display text-primary font-bold" style={{ fontSize: "1.5vw" }}>Error Type</p>
            <p className="font-body text-muted" style={{ fontSize: "1.2vw", marginTop: "1vh", lineHeight: "1.5" }}>Assign or change the error classification directly from the claim page</p>
          </div>
        </div>
      </div>
    </div>
  );
}
