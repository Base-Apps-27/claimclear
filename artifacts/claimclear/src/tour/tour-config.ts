// Bump this constant whenever the tour content meaningfully changes.
// Every signed-in user whose stored `tourVersionSeen` does not match
// will see the tour auto-start on their next sign-in. The value is an
// opaque string — we only check equality, never order.
export const CURRENT_TOUR_VERSION = "2026-05-03.v1";

export type TourStepDef = {
  // Element selector or "center" / "body" for an unanchored modal.
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

export const TOUR_STEPS: TourStepDef[] = [
  {
    target: "body",
    placement: "center",
    title: "Welcome to ClaimClear",
    body: "This is your dispute command center. I'll show you the four places you'll spend the most time. Two minutes, no clicks required — just hit Next.",
    disableBeacon: true,
  },
  {
    target: '[data-tour="sidebar"]',
    placement: "right",
    title: "Your sidebar — every workflow lives here",
    body: "Today's work up top (Dashboard, Queue, Responses, Attestation). Browse for everything in flight. Setup for imports and config. Badges count what's owed.",
    disableBeacon: true,
  },
  {
    target: '[data-tour="dashboard-kpis"]',
    route: "/dashboard",
    placement: "bottom",
    title: "Dashboard — the money model",
    body: "Every group lands in exactly one bucket: At risk (in flight), Already lost (expired or denied), or Reclaimed (approved). The numbers always reconcile, so you can trust the totals.",
    disableBeacon: true,
  },
  {
    target: '[data-tour="dashboard-today"]',
    route: "/dashboard",
    placement: "top",
    title: "Today's work",
    body: "Four hero columns: file today, stuck, respond, re-attest. If a column is empty, that lane is clean. Click any row to jump straight into the group.",
    disableBeacon: true,
  },
  {
    target: '[data-tour="page-main"]',
    route: "/queue",
    placement: "top",
    title: "Queue — process claims step-by-step",
    body: "The Queue is where you actually move work. Each lane represents a stage in the dispute workflow. Pick the leftmost non-empty lane and walk it down.",
    disableBeacon: true,
  },
  {
    target: '[data-tour="page-main"]',
    route: "/responses-awaiting-review",
    placement: "top",
    title: "Responses Awaiting Review",
    body: "When a payor sends something back, it lands here with a verdict pending. Master/detail layout with the response thread, the AI's read, and the verdict actions on the right.",
    disableBeacon: true,
  },
  {
    target: '[data-tour="page-main"]',
    route: "/attestation-queue",
    placement: "top",
    title: "Attestation Queue",
    body: "Approved verdicts that need to be re-attested in the payor portal. The amber badge in the sidebar is the count owed off-system.",
    disableBeacon: true,
  },
  {
    target: '[data-tour="header-take-tour"]',
    route: "/dashboard",
    placement: "bottom",
    title: "Replay anytime",
    body: "That's the whole tour. You can re-launch it whenever you want from this button in the header. Welcome aboard.",
    disableBeacon: true,
  },
];
