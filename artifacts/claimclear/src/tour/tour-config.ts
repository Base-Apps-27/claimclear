// Bump this constant whenever the tour content meaningfully changes.
// Every signed-in user whose stored `tourVersionSeen` does not match
// will see the tour auto-start on their next sign-in. The value is an
// opaque string — we only check equality, never order.
//
// NOTE: A drift-guard (scripts/check-tour-version.mjs) refuses to build
// if the steps below change without this version being bumped, so users
// can never silently miss new tour content.
export const CURRENT_TOUR_VERSION = "2026-05-05.v17";

export type ProcessStepValue =
  | 1 | 2 | 3 | 4 | 5
  | "all" | "transition" | "closing";

export type PageKey =
  | "dashboard" | "queue" | "responses" | "attestation" | "portal"
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
  dynamicRoute?: "tour-sample-group" | "tour-sample-claim" | "tour-sample-response";
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
    case "portal":          return "/portal-submissions";
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
  if (location.startsWith("/portal-submissions"))        return "portal";
  if (location === "/" || location.startsWith("/dashboard")) return "dashboard";
  return null;
}

// Tour structure (V2):
//   1. Process orientation (steps 1–7): the five-step playbook every
//      claim travels through. Front-loaded so a brand-new hire holds
//      the mental model before any UI is shown.
//   2. UI walkthrough (steps 8–29): which screen each playbook step
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
    nextLabel: "Next: Portal Submissions",
  },

  // ═══════ Portal Submissions (1 modal + 1 coach) ═══════
  // Step 4 of the playbook ("Send it to MAS") in action: every dispute
  // queued from the Queue lands here as a draft and gets filed by the
  // submission bot. The page has two parts: the list of submissions on
  // the left (grouped by status) and the run-the-queue rail on the right
  // where you trigger / monitor / stop the bot. Both anchors always
  // render — even when the list is empty (it shows an EmptyState card).
  {
    id: 14, kind: "modal", page: "portal", processStep: 4,
    target: "body", placement: "center",
    title: "Portal Submissions — where the bot files for you",
    body:
      "Once you finish a group in the Queue, the dispute lands here as a draft. A bot logs into MAS's website, fills the form, and submits every draft in order. You watch progress, retry failures, and step in only when something needs a human. The page has two parts: the list of submissions on the left, and the run-the-queue rail on the right.",
    nextLabel: "Next: the list",
  },
  {
    id: 15, kind: "coach", page: "portal", processStep: 4,
    target: '[data-tour="portal-submissions-list"]', placement: "right",
    title: "The list — every submission, grouped by status",
    body:
      "Drafts up top, then Pending (queued for the bot), then In Progress, then Failed and Done. Click any row to open the drawer and see what the bot saw. A failed row tells you why so you can fix the draft and retry. The right rail next to this list is the engine — that's where you run the queue.",
    nextLabel: "Next: Responses",
  },

  // ═══════ Responses (3 anchored coaches on the global tour sample) ═══════
  //
  // History (May 5, 2026 → v16): this section was originally 1 modal +
  // 3 anchored coach cards, then collapsed to ONE centered modal because
  // the anchored cards crashed when the page had no row to anchor to
  // (the auto-select-first-row effect plus a tour route rewrite war).
  // Migration 0030 seeds a global read-only portal_response linked to
  // the tour-sample invoice group + claim, so the page now ALWAYS has
  // a row to anchor to. The responses page also has a fallback fetch
  // for tour-sample groups (they're hidden from the awaiting-review
  // list, so `groups.find(...)` would otherwise return null).
  //
  // The anchored steps use the existing data-tour selectors that the
  // page has carried since Task #236:
  //   • [data-tour="responses-thread"]  — left column (master list)
  //   • [data-tour="responses-airead"]  — middle column (thread + AI)
  //   • [data-tour="responses-verdict"] — right rail (Decide)
  //
  // If the tour-sample seed isn't available (migrations not run), the
  // controller falls back to leaving the user on the bare list page;
  // Joyride's TARGET_NOT_FOUND handler then skips these steps.
  {
    id: 16, kind: "coach", page: "responses", processStep: 5,
    dynamicRoute: "tour-sample-response",
    target: '[data-tour="responses-thread"]', placement: "right",
    title: "Responses — Step 5, column 1: pick a response",
    body:
      "This is a sample response — read-only — so you can poke around safely. The left column is every payor reply waiting on a verdict. Oldest first by default. Click one and the middle and right columns load it.",
    nextLabel: "Next: read what MAS said",
  },
  {
    id: 17, kind: "coach", page: "responses", processStep: 5,
    dynamicRoute: "tour-sample-response",
    target: '[data-tour="responses-airead"]', placement: "left",
    title: "Column 2: read MAS, then the AI",
    body:
      "MAS's actual words sit on top. The AI summary below is a second pair of eyes — not the decider. Read MAS first, scan the AI summary, then move to the right.",
    nextLabel: "Next: pick the verdict",
  },
  {
    id: 18, kind: "coach", page: "responses", processStep: 5,
    dynamicRoute: "tour-sample-response",
    target: '[data-tour="responses-verdict"]', placement: "left",
    title: "Column 3: decide right then",
    body:
      "Three lanes: re-bill the ride if you can, hand it to a supervisor, or close it as denied. Pick one before you move on. Nothing sits without a decision. Re-billed rides are money we got back.",
    nextLabel: "Next: Attestation",
  },

  // ═══════ Attestation (1 modal + 2 coaches) ═══════
  // The page has two persistent landmarks that always render even when
  // the queue is empty:
  //   • [data-tour="attestation-tabs"]      — Open / Completed tabs
  //   • [data-tour="attestation-workspace"] — list + review pane (or
  //     the empty-state card when nothing is queued)
  // Anchoring on those wrappers (not on inner rows) means the coach
  // cards never orphan, even on a fresh tenant with no re-attestations.
  {
    id: 19, kind: "modal", page: "attestation", processStep: 5,
    target: "body", placement: "center",
    title: "Attestation Queue — closing the loop",
    body:
      "Groups MAS approved that still need to be re-billed in MAS's website. The amber number in the side menu is how many groups are owed. Once a group clears, the rides in it become money we recovered. The page has two parts: tabs at the top, and a workspace below.",
    nextLabel: "Next: the tabs",
  },
  {
    id: 20, kind: "coach", page: "attestation", processStep: 5,
    target: '[data-tour="attestation-tabs"]', placement: "bottom",
    title: "Two tabs — Open vs Completed",
    body:
      "'Open' is what still needs your hands — groups MAS approved but you haven't re-billed yet. 'Completed re-attestations' is the audit trail of groups already closed out. Most days you'll live in Open and only flip to Completed when someone asks 'did we ever re-bill that one?'",
    nextLabel: "Next: the workspace",
  },
  {
    id: 21, kind: "coach", page: "attestation", processStep: 5,
    target: '[data-tour="attestation-workspace"]', placement: "top",
    title: "Pick a group, work the right pane",
    body:
      "The list on the left is every group waiting on a re-attest. Click one and the right pane fills in: the last MAS reply for context, an action checklist of what to do in MAS's website, and a per-leg breakdown for the rare cases where one ride needs a different action. Check the boxes as you go; the re-attest button stays gated until every required action is done.",
    nextLabel: "Next: Browse",
  },

  // ═══════ Invoice Groups (1 modal + 3 coaches) ═══════
  // The page has three persistent landmarks that always render even
  // when the table is empty:
  //   • [data-tour="invoice-groups-tabs"]    — lifecycle pill strip
  //   • [data-tour="invoice-groups-filters"] — search + filter row
  //   • [data-tour="invoice-groups-table"]   — the results card
  {
    id: 22, kind: "modal", page: "invoice-groups", processStep: "transition",
    target: "body", placement: "center",
    title: "Invoice Groups — every group, in one list",
    body:
      "When the Dashboard isn't enough — when you need to find one specific group, audit a status, or do bulk work — come here. Every group ever uploaded is in this list, no matter what step it's on. Three landmarks to know: the lifecycle tabs at the top, the filter bar below them, and the results table.",
    nextLabel: "Next: the lifecycle tabs",
  },
  {
    id: 23, kind: "coach", page: "invoice-groups", processStep: "all",
    target: '[data-tour="invoice-groups-tabs"]', placement: "bottom",
    title: "Lifecycle tabs — jump to a stage",
    body:
      "Each tab is a stage in the group's lifecycle: All, Action Required (your work), Sent (waiting on MAS), Closed (won or lost). Click one to narrow the table to just that stage. The count on each tab is how many groups match.",
    nextLabel: "Next: the filter trap",
  },
  {
    id: 24, kind: "coach", page: "invoice-groups", processStep: "all",
    target: '[data-tour="invoice-groups-filters"]', placement: "bottom",
    title: "⚠️ Two filters are hiding rows by default",
    body:
      "This page hides anything you can't act on right now. 'Engagement: Needs engagement' hides finished and waiting groups. 'Show past-deadline' is OFF, which hides expired ones (the badge shows how many). If a group isn't there when you search, switch 'Engagement' to 'All' or turn 'Show past-deadline' on. The Claims page has the same two filters.",
    nextLabel: "Next: the table",
  },
  {
    id: 25, kind: "coach", page: "invoice-groups", processStep: "all",
    target: '[data-tour="invoice-groups-table"]', placement: "top",
    title: "The table — every column sortable, every row a group",
    body:
      "The results sit here. Click any column header to sort. Click any row to open the group's full detail page. Use 'Columns' in the toolbar above to hide what you don't need, and 'Density' to fit more rows on screen. Tick the checkboxes to bulk-assign or export.",
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
    id: 26, kind: "coach", page: "group-detail", processStep: "all",
    dynamicRoute: "tour-sample-group",
    target: '[data-tour="group-gauntlet"]', placement: "left",
    title: "Group detail — the Gauntlet shows the path to done",
    body:
      "This is a sample group — read-only — so you can poke around safely. The list on the left is every ride in the group. The Gauntlet here on the right is a 4-step checklist that takes the group from 'needs evidence' to 'sent to MAS'. Work top to bottom. When the last step lights up, the group is on its way.",
    nextLabel: "Next: Claims",
  },

  // ═══════ Claims (1 modal + 1 coach on detail) ═══════
  {
    id: 27, kind: "modal", page: "claims", processStep: "transition",
    target: "body", placement: "center",
    title: "Claims — same idea as Groups, one ride at a time",
    body:
      "Sometimes you need a single ride — by car number, client, or date. That's this page. The pills across the top (Investigating, Ready, Blocked, Submitted) jump you to a workflow state. ⚠️ Same two filters apply here as on Invoice Groups: 'Needs engagement' is on, 'Show past-deadline' is off. If a ride isn't showing, those are why.",
    nextLabel: "Next: a single claim",
  },
  // Same idea as the Group-detail step: anchor on the SOP Player wrapper
  // inside the global tour-sample claim (seeded by migration 0029,
  // resolved via `GET /tour/sample`). Read-only, mutations blocked at
  // the API. The wrapper sits OUTSIDE the conditional that renders the
  // SopAdvancePlayer itself — see claim-detail-v2.tsx — so the anchor
  // exists even when the sample claim has no decision tree configured
  // (the most common silent-skip cause prior to v17).
  {
    id: 28, kind: "coach", page: "claim-detail", processStep: "all",
    dynamicRoute: "tour-sample-claim",
    target: '[data-tour="claim-sop-player"]', placement: "top",
    title: "Claim detail — the SOP Player tells you what to do",
    body:
      "This is a sample claim — read-only — so you can step through without changing anything. The SOP Player walks you through a set of questions made for the claim's error type. Answer each one in order. At the end, you have a finished ask with proof attached. Whatever the SOP Player says — that is the rule.",
    nextLabel: "Next: Replay",
  },

  // ═══════ Replay anchor ═══════
  {
    id: 29, kind: "coach", page: "dashboard", processStep: "closing",
    target: '[data-tour="sidebar-take-tour"]', placement: "right",
    title: "Replay anytime",
    body:
      "That's the playbook, and that's the tour. To run it again, click 'Take the tour' in the side menu under Help — handy when training a new teammate. Welcome to the team.",
    nextLabel: "Finish",
  },
];
