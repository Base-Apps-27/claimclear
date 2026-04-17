import { Browser, Callout, SlideShell } from "@/components/slide-ui";

export default function EditingFields() {
  return (
    <SlideShell
      step={9}
      totalSteps={22}
      title="Edit the Claim Data"
      subtitle="Click Edit to fix typos and fill missing fields. Accurate data is what convinces MAS to overturn a denial."
    >
      <div style={{ flex: 1.4 }}>
        <Browser url="/claim/CC-2026-04-1138">
          <div className="bg-bg h-full" style={{ padding: "1.5vh 1.5vw" }}>
            <div className="bg-white rounded-[0.7vw] border border-primary/10" style={{ padding: "1.8vh 1.5vw" }}>
              <div className="flex items-center justify-between" style={{ marginBottom: "1.5vh" }}>
                <p className="font-display text-primary font-bold" style={{ fontSize: "1.1vw" }}>Editing Claim CC-2026-04-1138</p>
                <div className="flex gap-[0.4vw]">
                  <button className="bg-white border border-primary/20 text-primary font-display font-semibold rounded-[0.4vw]" style={{ padding: "0.5vh 0.8vw", fontSize: "0.8vw" }}>Cancel</button>
                  <button className="bg-[#16A34A] text-white font-display font-semibold rounded-[0.4vw]" style={{ padding: "0.5vh 0.8vw", fontSize: "0.8vw" }}>Save Changes</button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-[1vw]">
                {[
                  { l: "Confirmation Number", v: "CC-2026-04-1138", note: "From MAS portal — must match exactly" },
                  { l: "Service Date", v: "04/14/2026", note: "Date of the actual ride" },
                  { l: "Client Number", v: "MA-7782319", note: "Member's Medicaid ID" },
                  { l: "Car Number", v: "318", note: "Internal vehicle ID" },
                  { l: "Claim Amount", v: "$68.50", note: "Trip cost — not what's recovered" },
                  { l: "Reference Number", v: "REF-2026-1138-A", note: "Internal cross-reference" },
                ].map((f) => (
                  <div key={f.l}>
                    <p className="font-body text-muted uppercase tracking-wider" style={{ fontSize: "0.65vw" }}>{f.l}</p>
                    <div className="bg-white border border-accent rounded-[0.4vw]" style={{ padding: "0.7vh 0.7vw", marginTop: "0.3vh" }}>
                      <p className="font-mono text-primary font-semibold" style={{ fontSize: "0.85vw" }}>{f.v}</p>
                    </div>
                    <p className="font-body text-muted" style={{ fontSize: "0.65vw", marginTop: "0.2vh" }}>{f.note}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Browser>
      </div>
      <div className="flex flex-col gap-[1.2vh]" style={{ flex: 1 }}>
        <Callout number="1" title="Click Edit (top right)" body="The 6 detail fields turn into editable inputs. The button changes to Save Changes." />
        <Callout number="2" title="Confirmation Number must match MAS exactly" body="If the upload is missing it or got it wrong, the bot will fail. Copy-paste from the MAS portal screen." color="orange" />
        <Callout number="3" title="Use the right format for dates and money" body="MM/DD/YYYY for service date. Dollar amounts as 68.50, not 68.5 or $68.50 (the field handles the dollar sign)." />
        <Callout number="4" title="Save → it logs to the Audit Trail" body="Every change is recorded with your name, the field, the old value, and the new value. Don't worry, you can't break it." color="primary" />
      </div>
    </SlideShell>
  );
}
