import type { ReactNode } from "react";
import { FileText, PanelRight, Send, CheckCircle2, Circle } from "lucide-react";

export const invoice = {
  invoiceNumber: "INV-2026-04812",
  rideCount: 3,
  totalAmount: "$184.50",
};

export type LegEvidence = { name: string; kind: "gps" | "log" | "photo" | "doc" };

export type MockLeg = {
  legNumber: number;
  confNumber: string;
  date: string;
  amount: string;
  errorTypeName: string;
  verdict: { label: string; tone: "green" | "amber" | "blue" };
  // Will this leg be in the AI prompt? (post-bug-fix: only contestable legs are sent)
  inPrompt: boolean;
  reasonExcluded?: string;
  // SOP walk transcript
  sopTranscript: { question: string; answer: string }[];
  sopOutcomeNote: string;
  // Per-leg context note operator wrote
  contextNote: string;
  // Evidence files attached to this leg
  evidence: LegEvidence[];
  // Which writing-instruction layer applies to this leg's framing
  instructionLayer: { kind: "default" | "override"; label: string; preview: string };
};

// The realistic two-leg case from the bug report:
//  - Leg 1: contestable (Time at Facility) — should be in prompt
//  - Leg 2: non-contestable (Driver No-Show, signed log) — should be FILTERED OUT
//  - Leg 3: contestable (GPS Deviation) using a custom error-type override — in prompt
export const legs: MockLeg[] = [
  {
    legNumber: 1,
    confNumber: "8847291",
    date: "Apr 24",
    amount: "$62.40",
    errorTypeName: "Time at Facility",
    verdict: { label: "Ready for dispute submission", tone: "green" },
    inPrompt: true,
    sopTranscript: [
      { question: "Was the rider on dialysis or appointment time?", answer: "Yes — appointment per facility log" },
      { question: "Did the facility document the rider's actual release time?", answer: "Yes — 14:42 on signed sheet" },
      { question: "Is the documented time after the scheduled pickup?", answer: "Yes — pickup scheduled 14:15" },
      { question: "Is the gap > 15 minutes?", answer: "Yes — 27 minutes" },
    ],
    sopOutcomeNote: "Terminal: Disputable — facility-caused delay.",
    contextNote: "Driver waited curbside from 14:18; facility intake desk confirmed delay.",
    evidence: [
      { name: "facility-release-sheet.pdf", kind: "doc" },
      { name: "gps-trace-8847291.json", kind: "gps" },
      { name: "driver-log-04-24.txt", kind: "log" },
    ],
    instructionLayer: {
      kind: "default",
      label: "Default Dispute Instructions",
      preview:
        "Cite the documented facility release time. Compare to scheduled pickup. State the wait gap in minutes. Keep to 2–3 short paragraphs. Do not restate fields the portal already shows.",
    },
  },
  {
    legNumber: 2,
    confNumber: "8847294",
    date: "Apr 24",
    amount: "$58.10",
    errorTypeName: "Driver No-Show",
    verdict: { label: "Non-contestable — will be cancelled", tone: "amber" },
    inPrompt: false,
    reasonExcluded: "SOP terminal node = Cannot Dispute (driver signed missed-pickup log on-site).",
    sopTranscript: [
      { question: "Did the driver arrive at the pickup address?", answer: "Yes" },
      { question: "Did the driver wait the required window?", answer: "Yes — 11 minutes" },
      { question: "Was a missed-pickup log signed at the address?", answer: "Yes" },
    ],
    sopOutcomeNote: "Terminal: Cannot Dispute — signed missed-pickup log on file.",
    contextNote: "—",
    evidence: [
      { name: "missed-pickup-log-8847294.pdf", kind: "doc" },
    ],
    instructionLayer: { kind: "default", label: "Default Dispute Instructions", preview: "" },
  },
  {
    legNumber: 3,
    confNumber: "8847298",
    date: "Apr 24",
    amount: "$64.00",
    errorTypeName: "GPS Deviation (custom)",
    verdict: { label: "Ready for dispute submission", tone: "green" },
    inPrompt: true,
    sopTranscript: [
      { question: "Was the routed path the most direct between A and B?", answer: "No — construction detour active" },
      { question: "Is the detour documented (city DOT / Waze)?", answer: "Yes — DOT closure notice attached" },
      { question: "Did the deviation add > 0.8 miles?", answer: "Yes — 1.4 miles" },
    ],
    sopOutcomeNote: "Terminal: Disputable — documented construction detour.",
    contextNote: "DOT closure notice covers the entire ride window.",
    evidence: [
      { name: "dot-closure-notice.pdf", kind: "doc" },
      { name: "gps-trace-8847298.json", kind: "gps" },
    ],
    instructionLayer: {
      kind: "override",
      label: "Custom — GPS Deviation",
      preview:
        "Lead with the documented closure source (DOT, Waze, or PD). State the alternate path's mileage delta. Reference the rider's on-time arrival. Do NOT include speculative reasoning about driver intent.",
    },
  },
];

export const promptLegs = legs.filter((l) => l.inPrompt);
export const droppedLegs = legs.filter((l) => !l.inPrompt);

export function GroupHeader() {
  return (
    <div className="cc-group-header">
      <FileText className="w-4 h-4" style={{ color: "var(--cc-muted-fg)", flexShrink: 0 }} />
      <span className="font-semibold mono">{invoice.invoiceNumber}</span>
      <span className="cc-meta">{invoice.rideCount} rides · {invoice.totalAmount}</span>
      <button className="cc-btn cc-btn-ghost cc-btn-sm" style={{ marginLeft: "auto" }}>
        <PanelRight className="w-3.5 h-3.5" /> Details
      </button>
      <div className="cc-segmented" role="tablist" aria-label="Legs">
        {legs.map((l) => (
          <button
            key={l.legNumber}
            className={l.legNumber === 1 ? "is-active" : ""}
          >
            Leg {l.legNumber}{" "}
            {l.verdict.tone === "amber" ? (
              <Circle className="w-3 h-3" />
            ) : (
              <CheckCircle2 className="w-3 h-3" />
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

export function PinnedFooter({ helper }: { helper?: string }) {
  return (
    <div className="cc-footer-card cc-footer-pinned">
      <span className="cc-pill cc-pill-blue">Ready to preview</span>
      <span className="cc-meta" style={{ flex: 1, minWidth: 0, fontSize: "0.75rem" }}>
        {helper ?? "All legs walked — generate the preview, then submit to the portal."}
      </span>
      <ul className="cc-gauntlet-row">
        <li className="cc-gauntlet-step cc-gauntlet-done"><CheckCircle2 className="w-3 h-3" />Walk legs</li>
        <li className="cc-gauntlet-step cc-gauntlet-active">Preview</li>
        <li className="cc-gauntlet-step">Review</li>
        <li className="cc-gauntlet-step">Submit</li>
      </ul>
    </div>
  );
}

export function WizardShell({ children, helper }: { children: ReactNode; helper?: string }) {
  return (
    <div
      className="cc-scope"
      style={{ padding: "0.875rem", display: "flex", flexDirection: "column", gap: "0.75rem", minHeight: "100vh" }}
    >
      <GroupHeader />
      <div className="cc-meta" style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <Send className="w-3.5 h-3.5" />
        <span>3 legs walked · 2 ready for dispute · 1 non-contestable will be cancelled.</span>
      </div>
      <div style={{ flex: 1 }}>{children}</div>
      <PinnedFooter helper={helper} />
    </div>
  );
}

export function evidenceIcon(_kind: LegEvidence["kind"]): string {
  // Tiny ascii hint so each variant can pick its own icon component
  return "•";
}
