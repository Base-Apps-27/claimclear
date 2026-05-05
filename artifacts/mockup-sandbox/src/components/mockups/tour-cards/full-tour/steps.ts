export type ProcessStepValue = 1 | 2 | 3 | 4 | 5 | "all" | "transition" | "closing";

export type StepDef = {
  id: number;
  kind: "modal" | "coach";
  page:
    | "dashboard" | "queue" | "responses" | "attestation"
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

  // ═══════ Dashboard — one full-screen overview ═══════
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
    nextLabel: "Next: Responses",
  },

  // ═══════ Responses — intro + 3 column coaches ═══════
  {
    id: 14, kind: "modal", page: "responses", processStep: 5,
    title: "Responses Awaiting Review — Step 5 lives here",
    body:
      "When MAS replies to a dispute, it comes here for a decision. Three columns work together: the message thread on the left, the AI's read in the middle, and your decision on the right. Like the Queue, let's walk it column by column.",
    nextLabel: "Next: the thread",
  },
  {
    id: 15, kind: "coach", page: "responses", processStep: 5,
    anchor: { selector: '[data-tour="responses-thread"]', placement: "right" },
    title: "Thread — every reply, oldest first",
    body:
      "All open replies, sorted oldest first. Click one to read it. Bold rows haven't been opened yet — that's your list for the day. An empty list means nothing is waiting.",
    nextLabel: "Next: AI Read",
  },
  {
    id: 16, kind: "coach", page: "responses", processStep: 5,
    anchor: { selector: '[data-tour="responses-airead"]', placement: "top" },
    title: "AI Read — what MAS said, summarized",
    body:
      "MAS's actual reply is on top, the AI's summary and suggestion below. Use the AI as a second pair of eyes — not a decider. Always read the original reply first, then check what the AI thinks.",
    nextLabel: "Next: Decide",
  },
  {
    id: 17, kind: "coach", page: "responses", processStep: 5,
    anchor: { selector: '[data-tour="responses-verdict"]', placement: "left" },
    title: "Decide right then",
    body:
      "Three buttons. Pick one before you move on: Re-bill (the reply is clean and you're allowed), Hand to supervisor (it needs more than you can do), or Mark lost (MAS denied). Nothing sits without a decision. Once you click, it's done.",
    nextLabel: "Next: Attestation",
  },

  // ═══════ Attestation ═══════
  {
    id: 18, kind: "modal", page: "attestation", processStep: 5,
    title: "Attestation Queue — closing the loop",
    body:
      "Groups MAS approved that still need to be re-billed in MAS's website. The amber number in the side menu is how many groups are owed. Once a group clears, the rides in it become money we recovered.",
    nextLabel: "Next: Browse",
  },

  // ═══════ Browse — Invoice Groups + Claims ═══════
  {
    id: 19, kind: "modal", page: "invoice-groups", processStep: "transition",
    title: "Invoice Groups — every group, in one list",
    body:
      "When the Dashboard isn't enough — when you need to find one specific group, audit a status, or do bulk work — come here. Every group ever uploaded is in this list, no matter what step it's on. The filter bar at the top makes the page useful. It also makes it easy to lose rows. Let's look at what catches new people.",
    nextLabel: "Next: the filter trap",
  },
  {
    id: 20, kind: "coach", page: "invoice-groups", processStep: "all",
    anchor: { selector: '[data-tour="invoice-groups-filters"]', placement: "bottom" },
    title: "⚠️ Two filters are hiding rows by default",
    body:
      "This page hides anything you can't act on right now. 'Engagement: Needs engagement' hides finished and waiting groups. 'Show past-deadline' is OFF, which hides expired ones (the badge shows how many). If a group isn't there when you search, switch 'Engagement' to 'All' or turn 'Show past-deadline' on. The Claims page has the same two filters.",
    nextLabel: "Next: opening a group",
  },
  {
    id: 21, kind: "coach", page: "group-detail", processStep: "all",
    anchor: { selector: '[data-tour="group-gauntlet"]', placement: "left" },
    title: "Group detail — the Gauntlet shows the path to done",
    body:
      "When you open a group, this is your workspace. The list on the left is every ride in the group. The Gauntlet on the right is a 4-step checklist that takes the group from 'needs evidence' to 'sent to MAS'. Work top to bottom. When the last step lights up, the group is on its way. The 'What's next' card gives you AI hints if you're stuck.",
    nextLabel: "Next: Claims",
  },
  {
    id: 22, kind: "modal", page: "claims", processStep: "transition",
    title: "Claims — same idea as Groups, one ride at a time",
    body:
      "Sometimes you need a single ride — by car number, client, or date. That's this page. The pills across the top (Investigating, Ready, Blocked, Submitted) jump you to a workflow state. ⚠️ Same two filters apply here as on Invoice Groups: 'Needs engagement' is on, 'Show past-deadline' is off. If a ride isn't showing, those are why.",
    nextLabel: "Next: a single claim",
  },
  {
    id: 23, kind: "coach", page: "claim-detail", processStep: "all",
    anchor: { selector: '[data-tour="claim-sop-player"]', placement: "left" },
    title: "Claim detail — the SOP Player tells you what to do",
    body:
      "Open any claim and you'll see this. The SOP Player walks you through a set of questions made for that claim's error type. Answer each one in order. At the end, you have a finished ask with proof attached, ready to roll up into the group. Whatever the SOP Player says — that is the rule. No improvising.",
    nextLabel: "Next: Replay",
  },

  // ═══════ Replay ═══════
  {
    id: 24, kind: "coach", page: "dashboard", processStep: "closing",
    anchor: { selector: '[data-tour="sidebar-take-tour"]', placement: "right" },
    title: "Replay anytime",
    body:
      "That's the playbook, and that's the tour. To run it again, click 'Take the tour' in the side menu under Help — handy when training a new teammate. Welcome to the team.",
    nextLabel: "Finish",
  },
];
