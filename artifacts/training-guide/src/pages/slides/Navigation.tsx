import { AppSidebar, Browser, Callout, SlideShell } from "@/components/slide-ui";

export default function Navigation() {
  return (
    <SlideShell
      step={1}
      totalSteps={22}
      title="Sign In and Find Your Way Around"
      subtitle="Open ClaimClear, click 'Sign In with Replit' using the work account your supervisor set up, and get oriented with the left-hand sidebar."
    >
      <div style={{ flex: 1.4 }}>
        <Browser url="/dashboard">
          <div className="flex h-full">
            <AppSidebar active="dashboard" />
            <div className="flex-1 bg-bg" style={{ padding: "2vh 1.5vw" }}>
              <p
                className="font-display text-primary font-bold"
                style={{ fontSize: "1.5vw" }}
              >
                Dashboard
              </p>
              <p
                className="font-body text-muted"
                style={{ fontSize: "0.85vw", marginTop: "0.4vh" }}
              >
                Real-time overview of your claims pipeline
              </p>
              <div
                className="grid grid-cols-2 gap-[0.8vw]"
                style={{ marginTop: "2vh" }}
              >
                {[
                  { l: "Needs Evidence", v: "12", c: "text-orange" },
                  { l: "Awaiting Response", v: "8", c: "text-accent" },
                  { l: "Total Exposure", v: "$4.2K", c: "text-primary" },
                  { l: "Recovered", v: "$1.8K", c: "text-[#16A34A]" },
                ].map((s) => (
                  <div
                    key={s.l}
                    className="bg-white rounded-[0.5vw] border border-primary/10"
                    style={{ padding: "1.2vh 1vw" }}
                  >
                    <p
                      className="font-body text-muted uppercase tracking-wider"
                      style={{ fontSize: "0.6vw" }}
                    >
                      {s.l}
                    </p>
                    <p
                      className={`font-display font-extrabold ${s.c}`}
                      style={{ fontSize: "1.6vw" }}
                    >
                      {s.v}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Browser>
      </div>
      <div className="flex flex-col gap-[1.2vh]" style={{ flex: 1 }}>
        <Callout
          number="1"
          title="Click 'Sign In with Replit'"
          body="Use the Replit account your supervisor authorized for ClaimClear. Sessions last 8 hours, then you'll be asked to sign in again. Your role decides what you can edit — most processors land on the Dashboard."
        />
        <Callout
          number="2"
          title="The sidebar is your map"
          body="Top-to-bottom matches your daily order: Dashboard for context, Review for new uploads, Work Queue to process, Portal Submissions to ship, Summary to measure."
          color="orange"
        />
        <Callout
          number="3"
          title="Active page has the orange bar"
          body="The currently open module is highlighted on the left edge so you always know where you are."
        />
        <Callout
          number="4"
          title="Settings and Error Types are admin tools"
          body="You'll only need Error Types if a supervisor asks you to add a new SOP. Most days you live in Review, Work Queue, and Portal Submissions."
          color="primary"
        />
      </div>
    </SlideShell>
  );
}
