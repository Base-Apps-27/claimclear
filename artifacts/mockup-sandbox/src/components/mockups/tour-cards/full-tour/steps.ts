import { TourStepDef } from "../../../../claimclear/src/tour/tour-config";

export type StepDef = TourStepDef & {
  id: number;
  kind: "modal" | "coach";
  page: "dashboard" | "queue" | "responses" | "attestation" | null;
  anchor?: { selector: string; placement: "right" | "bottom" | "top" | "left" };
  processStep: 1 | 2 | 3 | 4 | 5 | "all" | "transition" | "closing";
  nextLabel: string;
};

export const STEPS: StepDef[] = [
  {
    id: 1,
    kind: "modal",
    page: "dashboard",
    processStep: "transition",
    target: "body",
    placement: "center",
    title: "Welcome to ClaimClear",
    body: "Every claim that lands in ClaimClear is one our automated attestation system already tried — and rejected. The auto-system couldn't safely attest it, so it kicked the ride to us to work by hand. ClaimClear is the playbook for that hand-work: a single repeatable process that turns those rejected rides into rides we can attest, and the revenue that comes with them. Before we tour the screens, let's anchor on the five steps you'll repeat for every batch. About three minutes, no clicks required — just hit Next.",
    disableBeacon: true,
    nextLabel: "Start tour"
  },
  {
    id: 2,
    kind: "modal",
    page: "dashboard",
    processStep: 1,
    target: "body",
    placement: "center",
    title: "Step 1 of 5 — Upload the transactions",
    body: "Start by importing the rides that weren't attestable at attestation time. These are rides we now want to attest, but to do that we first have to ask MAS to make a change on the invoice. Every dispute starts its life as a transaction in this upload.",
    disableBeacon: true,
    nextLabel: "Next: Understand"
  },
  {
    id: 3,
    kind: "modal",
    page: "dashboard",
    processStep: 2,
    target: "body",
    placement: "center",
    title: "Step 2 of 5 — Understand what's wrong with each invoice",
    body: "For every invoice, figure out what specifically MAS got wrong (or what's missing) and what evidence we'd need to prove it. This is the difference between a dispute that lands and one that gets denied: the right ask, paired with the right proof.",
    disableBeacon: true,
    nextLabel: "Next: Gather"
  },
  {
    id: 4,
    kind: "modal",
    page: "dashboard",
    processStep: 3,
    target: "body",
    placement: "center",
    title: "Step 3 of 5 — Gather the evidence",
    body: "Use the Queue or the invoice page to kick off our fact-finding process. That process pulls together the documents, GPS, signatures, and notes that back up the change we're asking MAS to make.",
    disableBeacon: true,
    nextLabel: "Next: Submit"
  },
  {
    id: 5,
    kind: "modal",
    page: "dashboard",
    processStep: 4,
    target: "body",
    placement: "center",
    title: "Step 4 of 5 — Submit the dispute",
    body: "Once fact-finding produces clean evidence, submit the dispute to MAS — either through the payor portal or by email, depending on what each invoice requires. The app routes you to the right channel.",
    disableBeacon: true,
    nextLabel: "Next: Respond"
  },
  {
    id: 6,
    kind: "modal",
    page: "dashboard",
    processStep: 5,
    target: "body",
    placement: "center",
    title: "Step 5 of 5 — Read the response and decide, right then",
    body: "When MAS responds, it lands on the Responses page. The decision happens in that moment: read it back, and either (a) re-attest the ride right there if you have the authority and the response is clean, or (b) queue it at the station for a billing supervisor to process. Either way the call is made when you read the response — nothing sits unowned. Reattested rides are revenue we recovered.",
    disableBeacon: true,
    nextLabel: "Next"
  },
  {
    id: 7,
    kind: "modal",
    page: "dashboard",
    processStep: "transition",
    target: "body",
    placement: "center",
    title: "Now let's see where this lives in the app",
    body: "That's the loop. The rest of the tour shows you exactly which screen corresponds to each of those five steps, so you know where to go when you're working a real batch.",
    disableBeacon: true,
    nextLabel: "See the app"
  },
  {
    id: 8,
    kind: "coach",
    page: "dashboard",
    processStep: "all",
    target: '[data-tour="sidebar"]',
    anchor: { selector: '[data-tour="sidebar"]', placement: "right" },
    placement: "right",
    title: "Your sidebar — every workflow lives here",
    body: "Today's work up top (Dashboard, Queue, Responses, Attestation). Browse for everything in flight. Setup for imports — that's where Step 1 (upload) starts. Badges count what's owed.",
    disableBeacon: true,
    nextLabel: "Next"
  },
  {
    id: 9,
    kind: "coach",
    page: "dashboard",
    processStep: 5,
    target: '[data-tour="dashboard-kpis"]',
    anchor: { selector: '[data-tour="dashboard-kpis"]', placement: "bottom" },
    route: "/dashboard",
    placement: "bottom",
    title: "Dashboard — the money model",
    body: "Every group lands in exactly one bucket: At risk (in flight), Already lost (expired or denied), or Reclaimed (approved). The numbers always reconcile, so you can trust the totals — this is how you see Step 5 outcomes adding up over time.",
    disableBeacon: true,
    nextLabel: "Next"
  },
  {
    id: 10,
    kind: "coach",
    page: "dashboard",
    processStep: 4,
    target: '[data-tour="dashboard-today"]',
    anchor: { selector: '[data-tour="dashboard-today"]', placement: "top" },
    route: "/dashboard",
    placement: "top",
    title: "Today's work",
    body: "Four hero columns surface what each of the five steps owes you today: file today (Steps 3–4), stuck after submission, respond (Step 5), re-attest (post-Step 5). Empty column = clean lane. Click any row to jump straight into the group.",
    disableBeacon: true,
    nextLabel: "Next"
  },
  {
    id: 11,
    kind: "modal",
    page: "queue",
    processStep: 3,
    target: "body",
    route: "/queue",
    placement: "center",
    title: "Queue — Steps 3 and 4 happen here",
    body: "The Queue is where you actually move work: gather evidence (Step 3) and submit the dispute (Step 4). Each lane represents a stage in the dispute workflow. Pick the leftmost non-empty lane and walk it down.",
    disableBeacon: true,
    nextLabel: "Next"
  },
  {
    id: 12,
    kind: "modal",
    page: "responses",
    processStep: 5,
    target: "body",
    route: "/responses-awaiting-review",
    placement: "center",
    title: "Responses Awaiting Review — Step 5",
    body: "When a payor sends something back, it lands here with a verdict pending. Master/detail layout: the response thread on the left, the AI's read in the middle, and the verdict actions on the right. This is where you decide if we can re-attest.",
    disableBeacon: true,
    nextLabel: "Next"
  },
  {
    id: 13,
    kind: "modal",
    page: "attestation",
    processStep: 5,
    target: "body",
    route: "/attestation-queue",
    placement: "center",
    title: "Attestation Queue — closing the loop",
    body: "Invoice groups with approved verdicts that still need to be re-attested in the payor portal. The amber badge in the sidebar is the count of groups owed off-system. Once a group clears, every ride in it is recovered revenue.",
    disableBeacon: true,
    nextLabel: "Next"
  },
  {
    id: 14,
    kind: "coach",
    page: "dashboard",
    processStep: "closing",
    target: '[data-tour="sidebar-take-tour"]',
    anchor: { selector: '[data-tour="sidebar-take-tour"]', placement: "right" },
    route: "/dashboard",
    placement: "right",
    title: "Replay anytime",
    body: "That's the whole loop, and the whole tour. You can re-launch it whenever you want from the Help section in the sidebar — handy when onboarding a new teammate. Welcome aboard.",
    disableBeacon: true,
    nextLabel: "Finish"
  }
];
