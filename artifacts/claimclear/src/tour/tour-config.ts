// Bump this constant whenever the tour content meaningfully changes.
// Every signed-in user whose stored `tourVersionSeen` does not match
// will see the tour auto-start on their next sign-in. The value is an
// opaque string — we only check equality, never order.
//
// NOTE: A drift-guard (scripts/check-tour-version.mjs) refuses to build
// if the steps below change without this version being bumped, so users
// can never silently miss new tour content.
export const CURRENT_TOUR_VERSION = "2026-05-04.v4";

export type TourStepDef = {
  // Element selector or "body" for an unanchored center modal.
  target: string;
  title: string;
  body: string;
  // Optional: route the tour should be on for this step. The controller
  // navigates here before showing the step and waits for the target to
  // mount.
  route?: string;
  // Skip the spotlight cutout — for chrome (sidebar, header) where the
  // halo can clip.
  disableBeacon?: boolean;
  // For modals not anchored to anything (welcome / outro).
  placement?: "auto" | "center" | "top" | "bottom" | "left" | "right";
};

// Tour structure:
//   1. Process orientation (modals): why ClaimClear exists and the five
//      repeatable steps the whole team runs for every batch of disputes.
//      This front-loads the mental model so a brand-new hire understands
//      the loop BEFORE they're shown which buttons live where.
//   2. UI walkthrough: where each of those five steps lives in the app.
//      Each UI step references its process-step number so the anchoring
//      from part 1 carries through.
export const TOUR_STEPS: TourStepDef[] = [
  // ────────────────────────────────────────────────────────────────
  // Part 1 — Process orientation
  // ────────────────────────────────────────────────────────────────
  {
    target: "body",
    placement: "center",
    title: "Welcome to ClaimClear",
    body: "Every claim that lands in ClaimClear is one our automated attestation system already tried — and rejected. The auto-system couldn't safely attest it, so it kicked the ride to us to work by hand. ClaimClear is the playbook for that hand-work: a single repeatable process that turns those rejected rides into rides we can attest, and the revenue that comes with them. Before we tour the screens, let's anchor on the five steps you'll repeat for every batch. About three minutes, no clicks required — just hit Next.",
    disableBeacon: true,
  },
  {
    target: "body",
    placement: "center",
    title: "Step 1 of 5 — Upload the transactions",
    body: "Start by importing the rides that weren't attestable at attestation time. These are rides we now want to attest, but to do that we first have to ask MAS to make a change on the invoice. Every dispute starts its life as a transaction in this upload.",
    disableBeacon: true,
  },
  {
    target: "body",
    placement: "center",
    title: "Step 2 of 5 — Understand what's wrong with each invoice",
    body: "For every invoice, figure out what specifically MAS got wrong (or what's missing) and what evidence we'd need to prove it. This is the difference between a dispute that lands and one that gets denied: the right ask, paired with the right proof.",
    disableBeacon: true,
  },
  {
    target: "body",
    placement: "center",
    title: "Step 3 of 5 — Gather the evidence",
    body: "Use the Queue or the invoice page to kick off our fact-finding process. That process pulls together the documents, GPS, signatures, and notes that back up the change we're asking MAS to make.",
    disableBeacon: true,
  },
  {
    target: "body",
    placement: "center",
    title: "Step 4 of 5 — Submit the dispute",
    body: "Once fact-finding produces clean evidence, submit the dispute to MAS — either through the payor portal or by email, depending on what each invoice requires. The app routes you to the right channel.",
    disableBeacon: true,
  },
  {
    target: "body",
    placement: "center",
    title: "Step 5 of 5 — Read the response and decide, right then",
    body: "When MAS responds, it lands on the Responses page. The decision happens in that moment: read it back, and either (a) re-attest the ride right there if you have the authority and the response is clean, or (b) queue it at the station for a billing supervisor to process. Either way the call is made when you read the response — nothing sits unowned. Reattested rides are revenue we recovered.",
    disableBeacon: true,
  },
  {
    target: "body",
    placement: "center",
    title: "Now let's see where this lives in the app",
    body: "That's the loop. The rest of the tour shows you exactly which screen corresponds to each of those five steps, so you know where to go when you're working a real batch.",
    disableBeacon: true,
  },

  // ────────────────────────────────────────────────────────────────
  // Part 2 — UI walkthrough (anchored back to the five steps)
  // ────────────────────────────────────────────────────────────────
  {
    target: '[data-tour="sidebar"]',
    placement: "right",
    title: "Your sidebar — every workflow lives here",
    body: "Today's work up top (Dashboard, Queue, Responses, Attestation). Browse for everything in flight. Setup for imports — that's where Step 1 (upload) starts. Badges count what's owed.",
    disableBeacon: true,
  },
  {
    target: '[data-tour="dashboard-kpis"]',
    route: "/dashboard",
    placement: "bottom",
    title: "Dashboard — the money model",
    body: "Every group lands in exactly one bucket: At risk (in flight), Already lost (expired or denied), or Reclaimed (approved). The numbers always reconcile, so you can trust the totals — this is how you see Step 5 outcomes adding up over time.",
    disableBeacon: true,
  },
  {
    target: '[data-tour="dashboard-today"]',
    route: "/dashboard",
    placement: "top",
    title: "Today's work",
    body: "Four hero columns surface what each of the five steps owes you today: file today (Steps 3–4), stuck after submission, respond (Step 5), re-attest (post-Step 5). Empty column = clean lane. Click any row to jump straight into the group.",
    disableBeacon: true,
  },
  {
    target: '[data-tour="page-main"]',
    route: "/queue",
    placement: "top",
    title: "Queue — Steps 3 and 4 happen here",
    body: "The Queue is where you actually move work: gather evidence (Step 3) and submit the dispute (Step 4). Each lane represents a stage in the dispute workflow. Pick the leftmost non-empty lane and walk it down.",
    disableBeacon: true,
  },
  {
    target: '[data-tour="page-main"]',
    route: "/responses-awaiting-review",
    placement: "top",
    title: "Responses Awaiting Review — Step 5",
    body: "When a payor sends something back, it lands here with a verdict pending. Master/detail layout: the response thread on the left, the AI's read in the middle, and the verdict actions on the right. This is where you decide if we can re-attest.",
    disableBeacon: true,
  },
  {
    target: '[data-tour="page-main"]',
    route: "/attestation-queue",
    placement: "top",
    title: "Attestation Queue — closing the loop",
    body: "Invoice groups with approved verdicts that still need to be re-attested in the payor portal. The amber badge in the sidebar is the count of groups owed off-system. Once a group clears, every ride in it is recovered revenue.",
    disableBeacon: true,
  },
  {
    // Anchor on the sidebar Help entry — that's where operators look
    // for "replay the tour" first. The header button stays as a
    // backup but isn't the primary discovery surface anymore.
    target: '[data-tour="sidebar-take-tour"]',
    route: "/dashboard",
    placement: "right",
    title: "Replay anytime",
    body: "That's the whole loop, and the whole tour. You can re-launch it whenever you want from the Help section in the sidebar — handy when onboarding a new teammate. Welcome aboard.",
    disableBeacon: true,
  },
];
