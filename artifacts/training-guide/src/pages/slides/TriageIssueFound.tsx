import { Browser, Callout, SlideShell } from "@/components/slide-ui";

const ERROR_TYPES = [
  { name: "Member Name Mismatch", cat: "Eligibility", sel: true },
  { name: "GPS Out of Range", cat: "Service Verification" },
  { name: "Missing Signature", cat: "Documentation" },
  { name: "Duplicate Trip", cat: "Billing" },
  { name: "Service Date Outside Auth", cat: "Authorization" },
  { name: "Driver Not Credentialed", cat: "Compliance" },
];

export default function TriageIssueFound() {
  return (
    <SlideShell
      step={5}
      totalSteps={22}
      title='The "Issue Found" Path'
      subtitle="Real disputes need an Error Type. The error type controls which workflow runs and what the AI dispute letter says."
    >
      <div style={{ flex: 1.4 }}>
        <Browser url="/review">
          <div className="bg-bg h-full" style={{ padding: "2vh 1.5vw" }}>
            <div className="bg-white rounded-[0.7vw] border border-primary/10" style={{ padding: "2vh 1.5vw" }}>
              <p className="font-display text-primary font-bold" style={{ fontSize: "1.2vw" }}>Assign Error Type to INV-89421</p>
              <p className="font-body text-muted" style={{ fontSize: "0.85vw", marginTop: "0.3vh" }}>Pick the category that matches the rejection reason</p>
              <div className="bg-bg border border-primary/10 rounded-[0.4vw] flex items-center" style={{ padding: "0.8vh 0.8vw", marginTop: "1.5vh" }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="#6B7A90" strokeWidth="2" style={{ width: "0.9vw", height: "0.9vw" }}><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
                <span className="font-body text-muted" style={{ fontSize: "0.8vw", marginLeft: "0.5vw" }}>Search error types…</span>
              </div>
              <div className="space-y-[0.4vh]" style={{ marginTop: "1.2vh" }}>
                {ERROR_TYPES.map((e) => (
                  <div key={e.name} className={`rounded-[0.4vw] border flex items-center justify-between ${e.sel ? "border-accent bg-accent/5" : "border-primary/10 bg-white"}`} style={{ padding: "0.9vh 0.9vw" }}>
                    <div>
                      <p className="font-display text-primary font-semibold" style={{ fontSize: "0.9vw" }}>{e.name}</p>
                      <p className="font-body text-muted" style={{ fontSize: "0.7vw" }}>{e.cat}</p>
                    </div>
                    {e.sel && (
                      <span className="bg-accent text-white rounded-full inline-flex items-center justify-center" style={{ width: "1.2vw", height: "1.2vw", fontSize: "0.8vw" }}>✓</span>
                    )}
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between" style={{ marginTop: "1.5vh" }}>
                <button className="font-body text-accent font-semibold" style={{ fontSize: "0.8vw" }}>+ Create new error type</button>
                <button className="bg-accent text-white font-display font-semibold rounded-[0.4vw]" style={{ padding: "1vh 1.5vw", fontSize: "0.85vw" }}>Assign and Send to Work Queue</button>
              </div>
            </div>
          </div>
        </Browser>
      </div>
      <div className="flex flex-col gap-[1.2vh]" style={{ flex: 1 }}>
        <Callout number="1" title="Search or scroll the list" body="Type a keyword from the raw MAS error to filter. Match the SOP your team has built for that scenario." />
        <Callout number="2" title="Pick the error type" body="Click the row. The selected one shows a blue check on the right." color="orange" />
        <Callout number="3" title="Don't see a match?" body="Click 'Create new error type' to launch the SOP builder. Most processors should grab a supervisor first — once created, it applies to all future claims." color="primary" />
        <Callout number="4" title="Assign and ship to Work Queue" body="The group's status flips from Needs Review → Needs Evidence and shows up in Action Required for processing." />
      </div>
    </SlideShell>
  );
}
