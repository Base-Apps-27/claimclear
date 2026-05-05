export type ProcessStepValue = 1 | 2 | 3 | 4 | 5 | "all" | "transition" | "closing";

export type StepDef = {
  id: number;
  kind: "modal" | "coach";
  page:
    | "dashboard" | "queue" | "responses" | "attestation" | "portal"
    | "invoice-groups" | "group-detail" | "claims" | "claim-detail"
    | null;
  anchor?: { selector: string; placement: "right" | "bottom" | "top" | "left" };
  processStep: ProcessStepValue;
  title: string;
  body: string;
  nextLabel: string;
};

// Copy rules (V2):
// - 8th-grade reading level, ESL-friendly. Short sentences.
// - Define ClaimClear words once: MAS = the payor we bill. "Dispute" =
//   our ask to MAS to fix an invoice. "Re-attest" = re-bill after a fix.
// - Avoid idioms: no "drop everything", "boss for the day", "in flight",
//   "plow through", "your worklist", "kick the ride".
// - Modals: ~100 words. Coach cards: ~60 words.
// - Same copy lives in artifacts/claimclear/src/tour/tour-config.ts.
export const STEPS: StepDef[] = [
  // ═══════ Process orientation (7 modal steps) ═══════
  {
    id: 1, kind: "modal", page: "dashboard", processStep: "transition",
    title: "Welcome to ClaimClear",
    body:
      "Every claim here is one our system tried to bill on its own and couldn't. A person has to fix it by hand. ClaimClear is the playbook for that work. Same five steps, every time. Run them, and rides we couldn't bill turn into rides we can. The next few cards walk through those five steps. About three minutes — just hit Next.",
    nextLabel: "Start tour",
  },
  {
    id: 2, kind: "modal", page: "dashboard", processStep: 1,
    title: "Step 1 of 5 — Upload the rides",
    body:
      "Start by uploading the rides we couldn't bill yet. To bill them, we have to ask MAS (the payor we bill) to fix something on the invoice first. Every dispute starts as one row in this upload.",
    nextLabel: "Next: Understand",
  },
  {
    id: 3, kind: "modal", page: "dashboard", processStep: 2,
    title: "Step 2 of 5 — Find what's wrong",
    body:
      "For each invoice, figure out what MAS got wrong or what's missing. Then decide what proof we need to fix it. The right ask plus the right proof is what wins a dispute.",
    nextLabel: "Next: Gather",
  },
  {
    id: 4, kind: "modal", page: "dashboard", processStep: 3,
    title: "Step 3 of 5 — Gather the proof",
    body:
      "Open the Queue or the invoice page to start fact-finding. Fact-finding pulls together the documents, GPS, signatures, and notes that back up the change we want MAS to make.",
    nextLabel: "Next: Submit",
  },
  {
    id: 5, kind: "modal", page: "dashboard", processStep: 4,
    title: "Step 4 of 5 — Send it to MAS",
    body:
      "When the proof is clean, send the dispute to MAS. Some go through MAS's website (the portal). Some go by email. The app picks the right channel for each invoice — you don't have to guess.",
    nextLabel: "Next: Respond",
  },
  {
    id: 6, kind: "modal", page: "dashboard", processStep: 5,
    title: "Step 5 of 5 — Read the reply, decide right then",
    body:
      "When MAS writes back, the reply lands on the Responses page. Read it and choose, in that moment: re-bill the ride now if you're allowed and the reply is clean, or hand it to a supervisor. Nothing waits without a decision. Re-billed rides are money we got back.",
    nextLabel: "Next",
  },
  {
    id: 7, kind: "modal", page: "dashboard", processStep: "transition",
    title: "Now let's see where this lives",
    body:
      "Those are the five steps. The rest of the tour shows you which screen each step lives on, so you know where to go on a real day.",
    nextLabel: "See the app",
  },

  // ═══════ Dashboard ═══════
  {
    id: 8, kind: "modal", page: "dashboard", processStep: 5,
    title: "Dashboard — the whole money picture, on one screen",
    body:
      "The menu on the left is the whole app — Today's work up top, Browse below. Across the top, three numbers tell you where every group is: At risk (still working), Already lost (denied or expired), Reclaimed (got it back). Below, four columns show what each step owes you today. An empty column means that step is clean. Click any row to jump straight in.",
    nextLabel: "Next: the Queue",
  },

  // ═══════ Queue — intro + 4 anchored coaches ═══════
  {
    id: 9, kind: "modal", page: "queue", processStep: 3,
    title: "The Queue — where most of your day happens",
    body:
      "Steps 2, 3, and 4 of the playbook all live here. The page has four parts, stacked top to bottom: a status banner, a Classification Inbox, an Actionable list, and a side workspace that opens when you click a group. Let's walk down the page.",
    nextLabel: "Next: the urgency banner",
  },
  {
    id: 10, kind: "coach", page: "queue", processStep: 4,
    anchor: { selector: '[data-tour="queue-urgency-hero"]', placement: "bottom" },
    title: "The urgency banner — your priority for today",
    body:
      "Three colors. Red means file before end of day; the big number is how many groups are due. Amber means soon — next 3 days, or already sent but not yet confirmed. Green means you're caught up. 'Show urgent only' hides everything except the red ones so you can clear them fast.",
    nextLabel: "Next: Classification Inbox",
  },
  {
    id: 11, kind: "coach", page: "queue", processStep: 2,
    anchor: { selector: '[data-tour="queue-classification-inbox"]', placement: "bottom" },
    title: "Classification Inbox — Step 2, and a gate",
    body:
      "New uploads land here without an error type. Open a row, pick what MAS got wrong (wrong distance, missing signature, etc.), and the row moves down into Actionable. Until you do this, the group can't move forward. If this inbox has rows, work it before the list below.",
    nextLabel: "Next: Actionable",
  },
  {
    id: 12, kind: "coach", page: "queue", processStep: 3,
    anchor: { selector: '[data-tour="queue-tab-actionable"]', placement: "bottom" },
    title: "Actionable — every group ready to work today",
    body:
      "After you classify a group, it shows up here: New, Needs Evidence, or Generating Email. Click a row and a side workspace opens on the right. Pick by deadline, work top to bottom, send.",
    nextLabel: "Next: hidden tabs",
  },
  {
    id: 13, kind: "coach", page: "queue", processStep: "all",
    anchor: { selector: '[data-tour="queue-engagement-strip"]', placement: "bottom" },
    title: "⚠️ Two tabs are hidden right now",
    body:
      "By default the Queue only shows Actionable. Two more tabs — 'Portal Queued' (already sent, waiting for MAS to confirm) and 'On Hold' (parked or blocked) — are hidden because they don't need your hands today. If a group seems to disappear, switch 'Needs engagement' to 'All' and the hidden tabs come back. The same trap shows up on the Browse pages later.",
    nextLabel: "Next: Portal Submissions",
  },

  // ═══════ Portal Submissions — intro + 1 coach ═══════
  {
    id: 14, kind: "modal", page: "portal", processStep: 4,
    title: "Portal Submissions — where the bot files for you",
    body:
      "Once you finish a group in the Queue, the dispute lands here as a draft. A bot logs into MAS's website, fills the form, and submits every draft in order. You watch progress, retry failures, and step in only when something needs a human. The page has two parts: the list of submissions on the left, and the run-the-queue rail on the right.",
    nextLabel: "Next: the list",
  },
  {
    id: 15, kind: "coach", page: "portal", processStep: 4,
    anchor: { selector: '[data-tour="portal-submissions-list"]', placement: "right" },
    title: "The list — every submission, grouped by status",
    body:
      "Drafts up top, then Pending (queued for the bot), then In Progress, then Failed and Done. Click any row to open the drawer and see what the bot saw. A failed row tells you why so you can fix the draft and retry. The right rail next to this list is the engine — that's where you run the queue.",
    nextLabel: "Next: Responses",
  },

  // ═══════ Responses — 3 coaches ═══════
  {
    id: 16, kind: "coach", page: "responses", processStep: 5,
    anchor: { selector: '[data-tour="responses-thread"]', placement: "right" },
    title: "Responses — Step 5, column 1: pick a response",
    body:
      "This is a sample response — read-only — so you can poke around safely. The left column is every payor reply waiting on a verdict. Oldest first by default. Click one and the middle and right columns load it.",
    nextLabel: "Next: read what MAS said",
  },
  {
    id: 17, kind: "coach", page: "responses", processStep: 5,
    anchor: { selector: '[data-tour="responses-airead"]', placement: "left" },
    title: "Column 2: read MAS, then the AI",
    body:
      "MAS's actual words sit on top. The AI summary below is a second pair of eyes — not the decider. Read MAS first, scan the AI summary, then move to the right.",
    nextLabel: "Next: pick the verdict",
  },
  {
    id: 18, kind: "coach", page: "responses", processStep: 5,
    anchor: { selector: '[data-tour="responses-verdict"]', placement: "left" },
    title: "Column 3: decide right then",
    body:
      "Three lanes: re-bill the ride if you can, hand it to a supervisor, or close it as denied. Pick one before you move on. Nothing sits without a decision. Re-billed rides are money we got back.",
    nextLabel: "Next: Attestation",
  },

  // ═══════ Attestation — intro + 2 coaches ═══════
  {
    id: 19, kind: "modal", page: "attestation", processStep: 5,
    title: "Attestation Queue — closing the loop",
    body:
      "Groups MAS approved that still need to be re-billed in MAS's website. The amber number in the side menu is how many groups are owed. Once a group clears, the rides in it become money we recovered. The page has two parts: tabs at the top, and a workspace below.",
    nextLabel: "Next: the tabs",
  },
  {
    id: 20, kind: "coach", page: "attestation", processStep: 5,
    anchor: { selector: '[data-tour="attestation-tabs"]', placement: "bottom" },
    title: "Two tabs — Open vs Completed",
    body:
      "'Open' is what still needs your hands — groups MAS approved but you haven't re-billed yet. 'Completed re-attestations' is the audit trail of groups already closed out. Most days you'll live in Open and only flip to Completed when someone asks 'did we ever re-bill that one?'",
    nextLabel: "Next: the workspace",
  },
  {
    id: 21, kind: "coach", page: "attestation", processStep: 5,
    anchor: { selector: '[data-tour="attestation-workspace"]', placement: "top" },
    title: "Pick a group, work the right pane",
    body:
      "The list on the left is every group waiting on a re-attest. Click one and the right pane fills in: the last MAS reply for context, an action checklist of what to do in MAS's website, and a per-leg breakdown for the rare cases where one ride needs a different action. Check the boxes as you go; the re-attest button stays gated until every required action is done.",
    nextLabel: "Next: Browse",
  },

  // ═══════ Browse — Invoice Groups (intro + 3 coaches) + Claims ═══════
  {
    id: 22, kind: "modal", page: "invoice-groups", processStep: "transition",
    title: "Invoice Groups — every group, in one list",
    body:
      "When the Dashboard isn't enough — when you need to find one specific group, audit a status, or do bulk work — come here. Every group ever uploaded is in this list, no matter what step it's on. Three landmarks to know: the lifecycle tabs at the top, the filter bar below them, and the results table.",
    nextLabel: "Next: the lifecycle tabs",
  },
  {
    id: 23, kind: "coach", page: "invoice-groups", processStep: "all",
    anchor: { selector: '[data-tour="invoice-groups-tabs"]', placement: "bottom" },
    title: "Lifecycle tabs — jump to a stage",
    body:
      "Each tab is a stage in the group's lifecycle: All, Action Required (your work), Sent (waiting on MAS), Closed (won or lost). Click one to narrow the table to just that stage. The count on each tab is how many groups match.",
    nextLabel: "Next: the filter trap",
  },
  {
    id: 24, kind: "coach", page: "invoice-groups", processStep: "all",
    anchor: { selector: '[data-tour="invoice-groups-filters"]', placement: "bottom" },
    title: "⚠️ Two filters are hiding rows by default",
    body:
      "This page hides anything you can't act on right now. 'Engagement: Needs engagement' hides finished and waiting groups. 'Show past-deadline' is OFF, which hides expired ones (the badge shows how many). If a group isn't there when you search, switch 'Engagement' to 'All' or turn 'Show past-deadline' on. The Claims page has the same two filters.",
    nextLabel: "Next: the table",
  },
  {
    id: 25, kind: "coach", page: "invoice-groups", processStep: "all",
    anchor: { selector: '[data-tour="invoice-groups-table"]', placement: "top" },
    title: "The table — every column sortable, every row a group",
    body:
      "The results sit here. Click any column header to sort. Click any row to open the group's full detail page. Use 'Columns' in the toolbar above to hide what you don't need, and 'Density' to fit more rows on screen. Tick the checkboxes to bulk-assign or export.",
    nextLabel: "Next: opening a group",
  },
  {
    id: 26, kind: "coach", page: "group-detail", processStep: "all",
    anchor: { selector: '[data-tour="group-gauntlet"]', placement: "left" },
    title: "Group detail — the Gauntlet shows the path to done",
    body:
      "This is a sample group — read-only — so you can poke around safely. The list on the left is every ride in the group. The Gauntlet here on the right is a 4-step checklist that takes the group from 'needs evidence' to 'sent to MAS'. Work top to bottom. When the last step lights up, the group is on its way.",
    nextLabel: "Next: Claims",
  },
  {
    id: 27, kind: "modal", page: "claims", processStep: "transition",
    title: "Claims — same idea as Groups, one ride at a time",
    body:
      "Sometimes you need a single ride — by car number, client, or date. That's this page. The pills across the top (Investigating, Ready, Blocked, Submitted) jump you to a workflow state. ⚠️ Same two filters apply here as on Invoice Groups: 'Needs engagement' is on, 'Show past-deadline' is off. If a ride isn't showing, those are why.",
    nextLabel: "Next: a single claim",
  },
  {
    id: 28, kind: "coach", page: "claim-detail", processStep: "all",
    anchor: { selector: '[data-tour="claim-sop-player"]', placement: "top" },
    title: "Claim detail — the SOP Player tells you what to do",
    body:
      "This is a sample claim — read-only — so you can step through without changing anything. The SOP Player walks you through a set of questions made for the claim's error type. Answer each one in order. At the end, you have a finished ask with proof attached. Whatever the SOP Player says — that is the rule.",
    nextLabel: "Next: Replay",
  },

  // ═══════ Replay ═══════
  {
    id: 29, kind: "coach", page: "dashboard", processStep: "closing",
    anchor: { selector: '[data-tour="sidebar-take-tour"]', placement: "right" },
    title: "Replay anytime",
    body:
      "That's the playbook, and that's the tour. To run it again, click 'Take the tour' in the side menu under Help — handy when training a new teammate. Welcome to the team.",
    nextLabel: "Finish",
  },
];
