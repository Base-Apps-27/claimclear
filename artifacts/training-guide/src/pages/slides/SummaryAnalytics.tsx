export default function SummaryAnalytics() {
  return (
    <div className="w-screen h-screen overflow-hidden relative bg-bg">
      <div className="absolute bottom-0 right-0 bg-accent/5 rounded-tl-full" style={{ width: "40vw", height: "40vh" }} />
      <div className="relative z-10 flex flex-col h-full" style={{ padding: "7vh 8vw" }}>
        <div className="flex items-center gap-[0.8vw]" style={{ marginBottom: "1.5vh" }}>
          <div className="bg-accent rounded-full" style={{ width: "0.6vw", height: "0.6vw" }} />
          <span className="font-body text-accent font-semibold tracking-wider uppercase" style={{ fontSize: "1.3vw" }}>Analytics</span>
        </div>
        <h2 className="font-display text-primary font-bold tracking-tight" style={{ fontSize: "3.5vw", lineHeight: "1.1" }}>Summary and Reports</h2>
        <p className="font-body text-muted" style={{ fontSize: "1.5vw", marginTop: "1.5vh" }}>Track financial performance and identify trends across all claims</p>
        <div className="flex gap-[2vw]" style={{ marginTop: "4vh" }}>
          <div className="bg-white rounded-[1vw] border border-primary/10 text-center" style={{ flex: 1, padding: "3vh 2vw" }}>
            <p className="font-body text-muted uppercase tracking-wider" style={{ fontSize: "1vw" }}>Recovery Rate</p>
            <p className="font-display text-accent font-extrabold" style={{ fontSize: "4.5vw" }}>68%</p>
            <p className="font-body text-muted" style={{ fontSize: "1.2vw" }}>of disputed claims recovered</p>
          </div>
          <div className="bg-white rounded-[1vw] border border-primary/10 text-center" style={{ flex: 1, padding: "3vh 2vw" }}>
            <p className="font-body text-muted uppercase tracking-wider" style={{ fontSize: "1vw" }}>Total Disputed</p>
            <p className="font-display text-primary font-extrabold" style={{ fontSize: "4.5vw" }}>$12K</p>
            <p className="font-body text-muted" style={{ fontSize: "1.2vw" }}>total amount under dispute</p>
          </div>
          <div className="bg-white rounded-[1vw] border border-primary/10 text-center" style={{ flex: 1, padding: "3vh 2vw" }}>
            <p className="font-body text-muted uppercase tracking-wider" style={{ fontSize: "1vw" }}>Avg Resolution</p>
            <p className="font-display text-orange font-extrabold" style={{ fontSize: "4.5vw" }}>4.2d</p>
            <p className="font-body text-muted" style={{ fontSize: "1.2vw" }}>average days to resolution</p>
          </div>
        </div>
        <div className="flex gap-[2vw]" style={{ marginTop: "2.5vh", flex: 1 }}>
          <div className="bg-white rounded-[1vw] border border-primary/10" style={{ flex: 1, padding: "2.5vh 2vw" }}>
            <p className="font-display text-primary font-bold" style={{ fontSize: "1.5vw", marginBottom: "1vh" }}>By Error Type</p>
            <p className="font-body text-muted" style={{ fontSize: "1.2vw", lineHeight: "1.5" }}>See which rejection categories are most common and which have the highest recovery rates</p>
          </div>
          <div className="bg-white rounded-[1vw] border border-primary/10" style={{ flex: 1, padding: "2.5vh 2vw" }}>
            <p className="font-display text-primary font-bold" style={{ fontSize: "1.5vw", marginBottom: "1vh" }}>By Outcome</p>
            <p className="font-body text-muted" style={{ fontSize: "1.2vw", lineHeight: "1.5" }}>Track approved vs denied disputes to improve your success rate over time</p>
          </div>
        </div>
      </div>
    </div>
  );
}
