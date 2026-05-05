// Bump this constant whenever the tour content meaningfully changes.
// Every signed-in user whose stored `tourVersionSeen` does not match
// will see the tour auto-start on their next sign-in. The value is an
// opaque string — we only check equality, never order.
//
// NOTE: A drift-guard (scripts/check-tour-version.mjs) refuses to build
// if the steps below change without this version being bumped, so users
// can never silently miss new tour content.
export const CURRENT_TOUR_VERSION = "2026-05-05.v15";

export type ProcessStepValue =
  | 1 | 2 | 3 | 4 | 5
  | "all" | "transition" | "closing";

export type PageKey =
  | "dashboard" | "queue" | "responses" | "attestation"
  | "invoice-groups" | "group-detail" | "claims" | "claim-detail";

export type TourStepDef = {
  // Stable id used by the custom tooltip component as a render key for
  // framer-motion entrance animations. Matches the 1-based slot in the
  // TOUR_STEPS array.
  id: number;
  // Visual treatment: centered modal (no anchor) vs anchored coach card.
  kind: "modal" | "coach";
  // Which surface this step belongs to. Drives the page-scoped
  // "Walk this page" entry in the header help popover, and the route
  // the tour controller navigates to before showing the step.
  page: PageKey | null;
  // Optional explicit route override. If absent, derived from `page`.
  route?: string;
  // Which step of the 5-step process this card represents (or one of
  // the meta-buckets: "transition", "all", "closing"). Drives the
  // phase pill + pipeline visual on the card.
  processStep: ProcessStepValue;
  title: string;
  body: string;
  nextLabel: string;
  // Joyride passes this through to the tooltip positioner. For modals
  // use `body` + placement `center`; for coaches use a real selector.
  target: string;
  placement: "auto" | "center" | "top" | "bottom" | "left" | "right";
  // When true, Joyride will NOT scroll the page to bring this step's
  // anchor into view. Used for:
  //   • All centered modals (target=body) — there's nothing to scroll
  //     to and triggering a scroll on a freshly navigated page can
  //     race with React's mount and blank the screen.
  //   • Step 13 (engagement-strip) — sits right next to step 12's
  //     actionable tab anchor, so the prior step already scrolled it
  //     into the viewport. Re-scrolling jerks the page for no reason.
  disableScrolling?: boolean;
  // Marks a step whose route depends on a runtime-resolved id (the
  // global tour-sample group / claim from `GET /tour/sample`). The
  // tour controller substitutes the id at navigation time. If the
  // sample isn't available (migration not yet run, fetch failed) the
  // controller falls back to a centered modal so the rest of the
  // tour still works. See admin-tour.tsx.
  dynamicRoute?: "tour-sample-group" | "tour-sample-claim";
};

// Map page → default route for navigation before showing each step.
// group-detail and claim-detail fall back to their list pages when no
// id is in the URL — the popover only offers "Walk this page" when the
// user is already on a detail surface, so the fallback is defensive.
export function routeForPage(page: PageKey | null): string | null {
  switch (page) {
    case "dashboard":       return "/dashboard";
    case "queue":           return "/queue";
    case "responses":       return "/responses-awaiting-review";
    case "attestation":     return "/attestation-queue";
    case "invoice-groups":  return "/invoice-groups";
    case "group-detail":    return "/invoice-groups";
    case "claims":          return "/claims";
    case "claim-detail":    return "/claims";
    default:                return null;
  }
}

// Reverse map: which page a wouter `useLocation()` value belongs to.
// Used by the HelpPopover to derive the current page-scoped tour.
export function pageForLocation(location: string): PageKey | null {
  if (location.startsWith("/invoice-groups/")) return "group-detail";
  if (location === "/invoice-groups")          return "invoice-groups";
  if (location.startsWith("/claims/"))         return "claim-detail";
  if (location === "/claims")                  return "claims";
  if (location.startsWith("/queue"))           return "queue";
  if (location.startsWith("/responses-awaiting-review")) return "responses";
  if (location.startsWith("/attestation-queue"))         return "attestation";
  if (location === "/" || location.startsWith("/dashboard")) return "dashboard";
  return null;
}

// Tour structure (V2):
//   1. Process orientation (steps 1–7): the five-step playbook every
//      claim travels through. Front-loaded so a brand-new hire holds
//      the mental model before any UI is shown.
//   2. UI walkthrough (steps 8–24): which screen each playbook step
//      lives on, walked column-by-column where the page has more than
//      one part. Anchored coach cards point at real selectors with
//      `data-tour="..."` attributes on the live pages.
//
// Copy rules (V2):
//   • 8th-grade reading level, ESL-friendly. Short sentences.
//   • Define ClaimClear words once: MAS = the payor we bill.
//   • No idioms ("drop everything", "in flight", "plow through").
//   • Modals ~100 words, coach cards ~60 words.
//   • Mirrored byte-for-byte in the mockup at
//     artifacts/mockup-sandbox/src/components/mockups/tour-cards/full-tour/steps.ts
export const TOUR_STEPS: TourStepDef[] = [
  // ═══════ Process orientation (7 modals) ═══════
  {
    id: 1, kind: "modal", page: "dashboard", processStep: "transition",
    target: "body", placement: "center",
    title: "Welcome to ClaimClear",
    body:
      "Every claim here is one our system tried to bill on its own and couldn't. A person has to fix it by hand. ClaimClear is the playbook for that work. Same five steps, every time. Run them, and rides we couldn't bill turn into rides we can. The next few cards walk through those five steps. About three minutes — just hit Next.",
    nextLabel: "Start tour",
  },
  {
    id: 2, kind: "modal", page: "dashboard", processStep: 1,
    target: "body", placement: "center",
    title: "Step 1 of 5 — Upload the rides",
    body:
      "Start by uploading the rides we couldn't bill yet. To bill them, we have to ask MAS (the payor we bill) to fix something on the invoice first. Every dispute starts as one row in this upload.",
    nextLabel: "Next: Understand",
  },
  {
    id: 3, kind: "modal", page: "dashboard", processStep: 2,
    target: "body", placement: "center",
    title: "Step 2 of 5 — Find what's wrong",
    body:
      "For each invoice, figure out what MAS got wrong or what's missing. Then decide what proof we need to fix it. The right ask plus the right proof is what wins a dispute.",
    nextLabel: "Next: Gather",
  },
  {
    id: 4, kind: "modal", page: "dashboard", processStep: 3,
    target: "body", placement: "center",
    title: "Step 3 of 5 — Gather the proof",
    body:
      "Open the Queue or the invoice page to start fact-finding. Fact-finding pulls together the documents, GPS, signatures, and notes that back up the change we want MAS to make.",
    nextLabel: "Next: Submit",
  },
  {
    id: 5, kind: "modal", page: "dashboard", processStep: 4,
    target: "body", placement: "center",
    title: "Step 4 of 5 — Send it to MAS",
    body:
      "When the proof is clean, send the dispute to MAS. Some go through MAS's website (the portal). Some go by email. The app picks the right channel for each invoice — you don't have to guess.",
    nextLabel: "Next: Respond",
  },
  {
    id: 6, kind: "modal", page: "dashboard", processStep: 5,
    target: "body", placement: "center",
    title: "Step 5 of 5 — Read the reply, decide right then",
    body:
      "When MAS writes back, the reply lands on the Responses page. Read it and choose, in that moment: re-bill the ride now if you're allowed and the reply is clean, or hand it to a supervisor. Nothing waits without a decision. Re-billed rides are money we got back.",
    nextLabel: "Next",
  },
  {
    id: 7, kind: "modal", page: "dashboard", processStep: "transition",
    target: "body", placement: "center",
    title: "Now let's see where this lives",
    body:
      "Those are the five steps. The rest of the tour shows you which screen each step lives on, so you know where to go on a real day.",
    nextLabel: "See the app",
  },

  // ═══════ Dashboard ═══════
  {
    id: 8, kind: "modal", page: "dashboard", processStep: 5,
    target: "body", placement: "center",
    title: "Dashboard — the whole money picture, on one screen",
    body:
      "The menu on the left is the whole app — Today's work up top, Browse below. Across the top, three numbers tell you where every group is: At risk (still working), Already lost (denied or expired), Reclaimed (got it back). Below, four columns show what each step owes you today. An empty column means that step is clean. Click any row to jump straight in.",
    nextLabel: "Next: the Queue",
  },

  // ═══════ Queue (1 modal + 4 coaches) ═══════
  {
    id: 9, kind: "modal", page: "queue", processStep: 3,
    target: "body", placement: "center",
    title: "The Queue — where most of your day happens",
    body:
      "Steps 2, 3, and 4 of the playbook all live here. The page has four parts, stacked top to bottom: a status banner, a Classification Inbox, an Actionable list, and a side workspace that opens when you click a group. Let's walk down the page.",
    nextLabel: "Next: the urgency banner",
  },
  {
    id: 10, kind: "coach", page: "queue", processStep: 4,
    target: '[data-tour="queue-urgency-hero"]', placement: "bottom",
    title: "The urgency banner — your priority for today",
    body:
      "Three colors. Red means file before end of day; the big number is how many groups are due. Amber means soon — next 3 days, or already sent but not yet confirmed. Green means you're caught up. 'Show urgent only' hides everything except the red ones so you can clear them fast.",
    nextLabel: "Next: Classification Inbox",
  },
  {
    id: 11, kind: "coach", page: "queue", processStep: 2,
    target: '[data-tour="queue-classification-inbox"]', placement: "bottom",
    title: "Classification Inbox — Step 2, and a gate",
    body:
      "New uploads land here without an error type. Open a row, pick what MAS got wrong (wrong distance, missing signature, etc.), and the row moves down into Actionable. Until you do this, the group can't move forward. If this inbox has rows, work it before the list below.",
    nextLabel: "Next: Actionable",
  },
  {
    id: 12, kind: "coach", page: "queue", processStep: 3,
    target: '[data-tour="queue-tab-actionable"]', placement: "bottom",
    title: "Actionable — every group ready to work today",
    body:
      "After you classify a group, it shows up here: New, Needs Evidence, or Generating Email. Click a row and a side workspace opens on the right. Pick by deadline, work top to bottom, send.",
    nextLabel: "Next: hidden tabs",
  },
  {
    id: 13, kind: "coach", page: "queue", processStep: "all",
    target: '[data-tour="queue-engagement-strip"]', placement: "bottom",
    title: "⚠️ Two tabs are hidden right now",
    body:
      "By default the Queue only shows Actionable. Two more tabs — 'Portal Queued' (already sent, waiting for MAS to confirm) and 'On Hold' (parked or blocked) — are hidden because they don't need your hands today. If a group seems to disappear, switch 'Needs engagement' to 'All' and the hidden tabs come back. The same trap shows up on the Browse pages later.",
    nextLabel: "Next: Responses",
  },

  // ═══════ Responses (1 modal) ═══════
  //
  // History (May 5, 2026): this section used to be 1 modal + 3 anchored
  // coach cards. Those crashed because of a navigation ping-pong
  // between the responses page (auto-selecting the first row and pushing
  // /responses-awaiting-review/<id>) and the tour controller (forcing
  // the URL back to bare /responses-awaiting-review on every render).
  // The fix lives in admin-tour.tsx: route comparisons now match by
  // page key, so a page-internal navigation (e.g. appending an /id) is
  // treated as "still on the responses page" instead of triggering a
  // forced URL rewrite. With the loop broken we can navigate to the
  // real page and show a centered modal over it. We deliberately keep
  // it as ONE overview modal (not the original 3-card walkthrough) —
  // anchored coach cards on a 3-column layout that immediately shifts
  // selection are fragile, and the modal+page-context combo gives the
  // operator the mental model without depending on specific selectors.
  {
    id: 14, kind: "modal", page: "responses", processStep: 5,
    target: "body", placement: "center",
    title: "Responses Awaiting Review — Step 5 lives here",
    body:
      "When MAS replies to a dispute, it lands on the Responses page for a decision. Three columns work together: a Thread on the left (every reply, bold = unread), an AI Read in the middle (MAS's actual words on top, the AI's summary below — use it as a second pair of eyes, not the decider), and a Decide rail on the right (Re-bill, Hand to supervisor, or Mark lost). Pick one before you move on. Nothing sits without a decision.",
    nextLabel: "Next: Attestation",
  },

  // ═══════ Attestation ═══════
  {
    id: 15, kind: "modal", page: "attestation", processStep: 5,
    target: "body", placement: "center",
    title: "Attestation Queue — closing the loop",
    body:
      "Groups MAS approved that still need to be re-billed in MAS's website. The amber number in the side menu is how many groups are owed. Once a group clears, the rides in it become money we recovered.",
    nextLabel: "Next: Browse",
  },

  // ═══════ Invoice Groups (1 modal + 1 coach) ═══════
  {
    id: 16, kind: "modal", page: "invoice-groups", processStep: "transition",
    target: "body", placement: "center",
    title: "Invoice Groups — every group, in one list",
    body:
      "When the Dashboard isn't enough — when you need to find one specific group, audit a status, or do bulk work — come here. Every group ever uploaded is in this list, no matter what step it's on. The filter bar at the top makes the page useful. It also makes it easy to lose rows. Let's look at what catches new people.",
    nextLabel: "Next: the filter trap",
  },
  {
    id: 17, kind: "coach", page: "invoice-groups", processStep: "all",
    target: '[data-tour="invoice-groups-filters"]', placement: "bottom",
    title: "⚠️ Two filters are hiding rows by default",
    body:
      "This page hides anything you can't act on right now. 'Engagement: Needs engagement' hides finished and waiting groups. 'Show past-deadline' is OFF, which hides expired ones (the badge shows how many). If a group isn't there when you search, switch 'Engagement' to 'All' or turn 'Show past-deadline' on. The Claims page has the same two filters.",
    nextLabel: "Next: opening a group",
  },

  // ═══════ Group detail (1 anchored coach on the global tour sample) ═══════
  // The Gauntlet anchor `[data-tour="group-gauntlet"]` only exists
  // inside a real group-detail page, so the tour navigates to a global
  // read-only "tour sample" group seeded by migration 0029. The id is
  // resolved at runtime from `GET /tour/sample` and substituted into
  // the route by the controller (see admin-tour.tsx + dynamicRoute).
  // If the sample is unavailable, the controller falls back to a
  // centered modal so the tour still completes.
  {
    id: 18, kind: "coach", page: "group-detail", processStep: "all",
    dynamicRoute: "tour-sample-group",
    target: '[data-tour="group-gauntlet"]', placement: "left",
    title: "Group detail — the Gauntlet shows the path to done",
    body:
      "This is a sample group — read-only — so you can poke around safely. The list on the left is every ride in the group. The Gauntlet here on the right is a 4-step checklist that takes the group from 'needs evidence' to 'sent to MAS'. Work top to bottom. When the last step lights up, the group is on its way.",
    nextLabel: "Next: Claims",
  },

  // ═══════ Claims (1 modal + 1 coach on detail) ═══════
  {
    id: 19, kind: "modal", page: "claims", processStep: "transition",
    target: "body", placement: "center",
    title: "Claims — same idea as Groups, one ride at a time",
    body:
      "Sometimes you need a single ride — by car number, client, or date. That's this page. The pills across the top (Investigating, Ready, Blocked, Submitted) jump you to a workflow state. ⚠️ Same two filters apply here as on Invoice Groups: 'Needs engagement' is on, 'Show past-deadline' is off. If a ride isn't showing, those are why.",
    nextLabel: "Next: a single claim",
  },
  // Same idea as step 18: anchor on the SOP Player inside the global
  // tour-sample claim (seeded by migration 0029, resolved via
  // `GET /tour/sample`). Read-only, mutations blocked at the API.
  {
    id: 20, kind: "coach", page: "claim-detail", processStep: "all",
    dynamicRoute: "tour-sample-claim",
    target: '[data-tour="claim-sop-player"]', placement: "top",
    title: "Claim detail — the SOP Player tells you what to do",
    body:
      "This is a sample claim — read-only — so you can step through without changing anything. The SOP Player walks you through a set of questions made for the claim's error type. Answer each one in order. At the end, you have a finished ask with proof attached. Whatever the SOP Player says — that is the rule.",
    nextLabel: "Next: Replay",
  },

  // ═══════ Replay anchor ═══════
  {
    id: 21, kind: "coach", page: "dashboard", processStep: "closing",
    target: '[data-tour="sidebar-take-tour"]', placement: "right",
    title: "Replay anytime",
    body:
      "That's the playbook, and that's the tour. To run it again, click 'Take the tour' in the side menu under Help — handy when training a new teammate. Welcome to the team.",
    nextLabel: "Finish",
  },
];
