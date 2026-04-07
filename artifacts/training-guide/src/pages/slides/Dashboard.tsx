export default function Dashboard() {
  return (
    <div className="w-screen h-screen overflow-hidden relative bg-bg">
      <div className="absolute top-0 left-0 right-0 bg-gradient-to-b from-primary/[0.03] to-transparent" style={{ height: "40vh" }} />
      <div className="relative z-10 flex flex-col h-full" style={{ padding: "7vh 8vw" }}>
        <div className="flex items-center gap-[0.8vw]" style={{ marginBottom: "1.5vh" }}>
          <div className="bg-accent rounded-full" style={{ width: "0.6vw", height: "0.6vw" }} />
          <span className="font-body text-accent font-semibold tracking-wider uppercase" style={{ fontSize: "1.3vw" }}>Your Home Base</span>
        </div>
        <h2 className="font-display text-primary font-bold tracking-tight" style={{ fontSize: "3.8vw", lineHeight: "1.1" }}>The Dashboard</h2>
        <p className="font-body text-muted" style={{ fontSize: "1.5vw", marginTop: "1.5vh" }}>Real-time overview of your entire claims pipeline at a glance</p>
        <div className="grid grid-cols-4 gap-[1.5vw]" style={{ marginTop: "4vh" }}>
          <div className="bg-white rounded-[1vw] border border-primary/10" style={{ padding: "2.5vh 1.5vw" }}>
            <p className="font-body text-muted uppercase tracking-wider" style={{ fontSize: "1vw" }}>Needs Evidence</p>
            <p className="font-display text-primary font-extrabold" style={{ fontSize: "3vw", marginTop: "0.5vh" }}>12</p>
            <p className="font-body text-orange font-medium" style={{ fontSize: "1.1vw", marginTop: "0.5vh" }}>Requires your action</p>
          </div>
          <div className="bg-white rounded-[1vw] border border-primary/10" style={{ padding: "2.5vh 1.5vw" }}>
            <p className="font-body text-muted uppercase tracking-wider" style={{ fontSize: "1vw" }}>Awaiting Response</p>
            <p className="font-display text-primary font-extrabold" style={{ fontSize: "3vw", marginTop: "0.5vh" }}>8</p>
            <p className="font-body text-accent font-medium" style={{ fontSize: "1.1vw", marginTop: "0.5vh" }}>Pending MAS reply</p>
          </div>
          <div className="bg-white rounded-[1vw] border border-primary/10" style={{ padding: "2.5vh 1.5vw" }}>
            <p className="font-body text-muted uppercase tracking-wider" style={{ fontSize: "1vw" }}>Total Exposure</p>
            <p className="font-display text-primary font-extrabold" style={{ fontSize: "3vw", marginTop: "0.5vh" }}>$4.2K</p>
            <p className="font-body text-muted font-medium" style={{ fontSize: "1.1vw", marginTop: "0.5vh" }}>At risk amount</p>
          </div>
          <div className="bg-white rounded-[1vw] border border-primary/10" style={{ padding: "2.5vh 1.5vw" }}>
            <p className="font-body text-muted uppercase tracking-wider" style={{ fontSize: "1vw" }}>Recovered</p>
            <p className="font-display text-primary font-extrabold" style={{ fontSize: "3vw", marginTop: "0.5vh" }}>$1.8K</p>
            <p className="font-body text-accent font-medium" style={{ fontSize: "1.1vw", marginTop: "0.5vh" }}>Successfully disputed</p>
          </div>
        </div>
        <div className="flex gap-[2vw]" style={{ marginTop: "3vh", flex: 1 }}>
          <div className="bg-white rounded-[1vw] border border-primary/10" style={{ flex: 2, padding: "2.5vh 2vw" }}>
            <p className="font-display text-primary font-bold" style={{ fontSize: "1.6vw", marginBottom: "1vh" }}>Urgent: Expiring Soon</p>
            <p className="font-body text-muted" style={{ fontSize: "1.2vw" }}>Claims with less than 14 days remaining in dispute window appear here -- prioritize these first</p>
          </div>
          <div className="bg-white rounded-[1vw] border border-primary/10" style={{ flex: 1, padding: "2.5vh 2vw" }}>
            <p className="font-display text-primary font-bold" style={{ fontSize: "1.6vw", marginBottom: "1vh" }}>Bot Status</p>
            <p className="font-body text-muted" style={{ fontSize: "1.2vw" }}>Monitor active bot sessions and portal queue size</p>
          </div>
        </div>
      </div>
    </div>
  );
}
