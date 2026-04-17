import { Browser, Callout, SlideShell } from "@/components/slide-ui";

export default function NotesAudit() {
  return (
    <SlideShell
      step={12}
      totalSteps={22}
      title="Notes and the Audit Trail"
      subtitle="Notes are for your team. The audit trail is for the system. Together, they're the memory of every claim."
    >
      <div style={{ flex: 1.4 }}>
        <Browser url="/claim/CC-2026-04-1138">
          <div className="bg-bg h-full grid grid-cols-2 gap-[1vw]" style={{ padding: "1.5vh 1.5vw" }}>
            <div className="bg-white rounded-[0.7vw] border border-primary/10 flex flex-col" style={{ padding: "1.5vh 1.2vw" }}>
              <p className="font-display text-primary font-bold" style={{ fontSize: "1vw" }}>Notes</p>
              <p className="font-body text-muted" style={{ fontSize: "0.7vw" }}>Internal team comments</p>
              <div className="bg-bg border border-primary/10 rounded-[0.4vw]" style={{ padding: "0.8vh 0.7vw", marginTop: "1vh" }}>
                <p className="font-body text-muted" style={{ fontSize: "0.75vw" }}>Add a note for the team…</p>
              </div>
              <div className="flex justify-end" style={{ marginTop: "0.5vh" }}>
                <button className="bg-accent text-white font-display font-semibold rounded-[0.4vw]" style={{ padding: "0.4vh 0.8vw", fontSize: "0.75vw" }}>Add</button>
              </div>
              <div className="space-y-[0.7vh]" style={{ marginTop: "1vh" }}>
                {[
                  { who: "Maria C.", when: "Today, 10:14a", note: "Driver confirmed pickup was on time. Pulling the GPS log now." },
                  { who: "Jamal R.", when: "Yesterday, 4:02p", note: "MAS denied for GPS but the trip ran clean. Worth disputing." },
                ].map((n) => (
                  <div key={n.note} className="border-l-2 border-accent" style={{ paddingLeft: "0.7vw" }}>
                    <div className="flex items-center gap-[0.5vw]">
                      <p className="font-display text-primary font-semibold" style={{ fontSize: "0.78vw" }}>{n.who}</p>
                      <p className="font-body text-muted" style={{ fontSize: "0.65vw" }}>{n.when}</p>
                    </div>
                    <p className="font-body text-primary" style={{ fontSize: "0.78vw", marginTop: "0.2vh", lineHeight: "1.4" }}>{n.note}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white rounded-[0.7vw] border border-primary/10" style={{ padding: "1.5vh 1.2vw" }}>
              <p className="font-display text-primary font-bold" style={{ fontSize: "1vw" }}>Audit Trail</p>
              <p className="font-body text-muted" style={{ fontSize: "0.7vw" }}>System-recorded · read-only</p>
              <div className="space-y-[0.6vh]" style={{ marginTop: "1vh" }}>
                {[
                  { t: "10:14a", a: "Evidence added: gps-log-2026-04-14.pdf", u: "Maria C." },
                  { t: "10:08a", a: "Error type changed → GPS Out of Range", u: "Maria C." },
                  { t: "9:51a", a: "Workflow step 1 answered: Yes — within range", u: "Maria C." },
                  { t: "Yesterday", a: "Triaged from Review → Issue Found", u: "Jamal R." },
                  { t: "Yesterday", a: "Imported from MAS denial export", u: "system" },
                ].map((a, i) => (
                  <div key={i} className="flex gap-[0.5vw]">
                    <span className="font-body text-muted shrink-0" style={{ fontSize: "0.7vw", width: "4vw" }}>{a.t}</span>
                    <div>
                      <p className="font-body text-primary" style={{ fontSize: "0.75vw" }}>{a.a}</p>
                      <p className="font-body text-muted" style={{ fontSize: "0.65vw" }}>by {a.u}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Browser>
      </div>
      <div className="flex flex-col gap-[1.2vh]" style={{ flex: 1 }}>
        <Callout number="1" title="Notes = team chat for one claim" body="Use them to coordinate: 'Driver said he never made this trip', 'Need auth from Carol', 'Re-uploaded GPS — first one was wrong page'." />
        <Callout number="2" title="Tag people informally" body="Just type '@Maria — can you check this?' in the note. Anyone watching the claim sees it next time they open it." color="orange" />
        <Callout number="3" title="Audit Trail is automatic" body="You don't write to it; the system does. Every edit, status change, evidence upload, and workflow answer is logged with timestamp + user." />
        <Callout number="4" title="Use the trail for handoffs" body="Coming back to a claim after a week off? Read the trail bottom-to-top to see exactly what happened." color="primary" />
      </div>
    </SlideShell>
  );
}
