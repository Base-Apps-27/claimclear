import { SlideShell } from "@/components/slide-ui";

const ROUTINE = [
  {
    time: "9:00",
    page: "Command Center",
    tasks: [
      "Scan the 4 KPI cards: any number jump out?",
      "Open Expiring Soon — note any ≤7 day items",
      "Check Bot Health + System Health — bots online, queues clear?",
      "Glance at Closure Breakdown — Withdrawn % rising?",
    ],
  },
  {
    time: "9:15",
    page: "Review Queue",
    tasks: [
      "Triage every Needs Review group",
      "Non-Issue → resolve at $0 with a one-line reason",
      "Issue Found → assign error type, send to Work Queue",
    ],
  },
  {
    time: "9:45",
    page: "Work Queue · Action Required",
    tasks: [
      "Sort by days-left, work red first",
      "Run the workflow, edit data, attach evidence",
      "Pass the Quality Check (Lint Gate), then Send to Portal",
    ],
  },
  {
    time: "1:00",
    page: "Portal Submissions",
    tasks: [
      "Click 'Process All Pending' to release the queue",
      "Watch for Failed (red) — open and retry or escalate",
      "Confirm batch completes before logging off for lunch",
    ],
  },
  {
    time: "3:00",
    page: "Work Queue · Awaiting + Action Required",
    tasks: [
      "Re-check Action Required for new payor responses (Email Thread)",
      "Handle each: Accept Loss (Withdrawn), Submit New Invoice, or Re-dispute",
      "Add a note on anything you couldn't finish",
    ],
  },
  {
    time: "4:30",
    page: "Summary",
    tasks: [
      "Glance at today's Recovered total — track the win",
      "Note any error type with abnormal denial rate to flag tomorrow",
    ],
  },
];

export default function DailyRoutine() {
  return (
    <SlideShell
      step={20}
      totalSteps={22}
      title="A Day in the Life"
      subtitle="Run this routine and you'll keep the queue clean, hit deadlines, and know what's worth escalating."
    >
      <div className="flex-1">
        <div className="grid grid-cols-3 gap-[1vw]">
          {ROUTINE.map((r) => (
            <div key={r.time} className="bg-white rounded-[0.7vw] border border-primary/10" style={{ padding: "1.5vh 1.2vw" }}>
              <div className="flex items-center gap-[0.6vw]" style={{ marginBottom: "0.6vh" }}>
                <div className="bg-accent text-white font-display font-bold rounded-[0.3vw]" style={{ padding: "0.3vh 0.6vw", fontSize: "0.85vw" }}>{r.time}</div>
                <span className="font-display text-primary font-bold" style={{ fontSize: "1vw" }}>{r.page}</span>
              </div>
              <ul className="space-y-[0.4vh]">
                {r.tasks.map((t, i) => (
                  <li key={i} className="flex items-start gap-[0.4vw]">
                    <span className="text-accent font-display font-bold shrink-0" style={{ fontSize: "0.75vw", marginTop: "0.2vh" }}>•</span>
                    <span className="font-body text-primary" style={{ fontSize: "0.82vw", lineHeight: "1.45" }}>{t}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </SlideShell>
  );
}
