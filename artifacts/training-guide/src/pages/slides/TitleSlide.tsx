const base = import.meta.env.BASE_URL;

export default function TitleSlide() {
  return (
    <div className="w-screen h-screen overflow-hidden relative">
      <img
        src={`${base}hero.png`}
        crossOrigin="anonymous"
        className="absolute inset-0 w-full h-full object-cover"
        alt="NEMT fleet"
      />
      <div className="absolute inset-0 bg-gradient-to-r from-primary/95 via-primary/80 to-primary/40" />
      <div
        className="relative z-10 flex flex-col justify-center h-full"
        style={{ paddingLeft: "8vw", paddingRight: "8vw" }}
      >
        <div className="flex items-center gap-[1.5vw]" style={{ marginBottom: "3vh" }}>
          <div
            className="bg-orange rounded-[1vw] flex items-center justify-center"
            style={{ width: "4vw", height: "4vw" }}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="white"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ width: "2.2vw", height: "2.2vw" }}
            >
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
          </div>
          <span
            className="font-display text-white/70 font-semibold tracking-wider uppercase"
            style={{ fontSize: "1.4vw" }}
          >
            Agape Transportation
          </span>
        </div>
        <h1
          className="font-display text-white font-extrabold tracking-tight leading-none"
          style={{ fontSize: "5.5vw" }}
        >
          Using ClaimClear
        </h1>
        <h2
          className="font-display text-white/80 font-semibold"
          style={{ fontSize: "2vw", marginTop: "1.5vh" }}
        >
          A Step-by-Step Guide for Staff
        </h2>
        <div
          className="bg-orange/80 rounded-full"
          style={{ width: "6vw", height: "0.4vh", marginTop: "3vh" }}
        />
        <p
          className="font-body text-white/70"
          style={{ fontSize: "1.4vw", marginTop: "2vh", maxWidth: "55vw" }}
        >
          Everything you need to do after claims are uploaded — triage, decide,
          submit, and recover. Follow this guide and you'll process your first
          batch successfully.
        </p>
      </div>
    </div>
  );
}
