const STAGES = [
  {
    n: "1",
    label: "Triage",
    where: "Review Queue",
    desc: "First look at every freshly imported group — read the raw MAS error",
    color: "bg-[#F4A23E]",
  },
  {
    n: "2",
    label: "Classify",
    where: "Review Queue",
    desc: "Name the error: pick the Error Type so the right SOP and AI letter run",
    color: "bg-orange",
  },
  {
    n: "3",
    label: "Process",
    where: "Work Queue",
    desc: "Run the workflow, edit data, attach evidence — or take a closure exit",
    color: "bg-accent",
  },
  {
    n: "4",
    label: "Submit",
    where: "Portal Submissions",
    desc: "Bot files the dispute on the payor portal (or sends the email) for you",
    color: "bg-[#8B5CF6]",
  },
  {
    n: "5",
    label: "Outcome",
    where: "Claim Detail · Withdrawals",
    desc: "Resolved (won), Denied (payor said no), or Withdrawn — supervisor signs off in Withdrawals Review",
    color: "bg-[#16A34A]",
  },
];

export default function JourneyOverview() {
  return (
    <div className="w-screen h-screen overflow-hidden relative bg-bg">
      <div
        className="absolute top-0 right-0 bg-primary/[0.03] rounded-bl-full"
        style={{ width: "40vw", height: "40vh" }}
      />
      <div
        className="relative z-10 flex flex-col h-full"
        style={{ padding: "5vh 6vw" }}
      >
        <div
          className="flex items-center gap-[0.7vw]"
          style={{ marginBottom: "1vh" }}
        >
          <div
            className="bg-accent rounded-full"
            style={{ width: "0.55vw", height: "0.55vw" }}
          />
          <span
            className="font-body text-accent font-semibold tracking-wider uppercase"
            style={{ fontSize: "1vw" }}
          >
            The Big Picture
          </span>
        </div>
        <h2
          className="font-display text-primary font-bold tracking-tight"
          style={{ fontSize: "2.8vw", lineHeight: "1.1" }}
        >
          The Claim Journey, in 5 Stages
        </h2>
        <p
          className="font-body text-muted"
          style={{ fontSize: "1.25vw", marginTop: "1vh" }}
        >
          Once claims are uploaded, every invoice group flows through the same
          path. Knowing where you are tells you what to do next.
        </p>

        <div
          className="grid grid-cols-5 gap-[1.2vw]"
          style={{ marginTop: "5vh" }}
        >
          {STAGES.map((s, i) => (
            <div
              key={s.n}
              className="bg-white rounded-[1vw] border border-primary/10 relative"
              style={{ padding: "2.5vh 1.2vw" }}
            >
              <div
                className={`${s.color} text-white font-display font-bold rounded-full flex items-center justify-center`}
                style={{
                  width: "2.5vw",
                  height: "2.5vw",
                  fontSize: "1.4vw",
                  marginBottom: "1.5vh",
                }}
              >
                {s.n}
              </div>
              <p
                className="font-display text-primary font-bold"
                style={{ fontSize: "1.4vw" }}
              >
                {s.label}
              </p>
              <p
                className="font-body text-accent font-semibold uppercase tracking-wider"
                style={{ fontSize: "0.75vw", marginTop: "0.5vh" }}
              >
                {s.where}
              </p>
              <p
                className="font-body text-muted"
                style={{
                  fontSize: "0.95vw",
                  marginTop: "1.2vh",
                  lineHeight: "1.4",
                }}
              >
                {s.desc}
              </p>
              {i < STAGES.length - 1 && (
                <div
                  className="absolute text-muted/40 font-display"
                  style={{
                    right: "-1vw",
                    top: "50%",
                    fontSize: "1.5vw",
                    transform: "translateY(-50%)",
                  }}
                >
                  →
                </div>
              )}
            </div>
          ))}
        </div>

        <div
          className="bg-primary rounded-[1vw] flex items-start gap-[1.5vw]"
          style={{ marginTop: "4vh", padding: "2.5vh 2.5vw" }}
        >
          <div
            className="bg-orange rounded-[0.5vw] flex items-center justify-center shrink-0"
            style={{ width: "3vw", height: "3vw" }}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="white"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ width: "1.6vw", height: "1.6vw" }}
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <div>
            <p
              className="font-display text-white font-bold"
              style={{ fontSize: "1.4vw" }}
            >
              The golden rule
            </p>
            <p
              className="font-body text-white/70"
              style={{ fontSize: "1.15vw", marginTop: "0.6vh", lineHeight: "1.5" }}
            >
              Every dispute has a strict filing window (typically 30 business
              days). Always work the oldest and most-expiring claims first —
              that's why the Command Center and Work Queue both surface
              "Expiring Soon" at the top.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
