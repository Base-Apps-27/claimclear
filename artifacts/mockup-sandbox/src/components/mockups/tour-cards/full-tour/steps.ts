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

export const STEPS: StepDef[] = [
  // ═══════ Process orientation (7 modal steps) ═══════
  {
    id: 1, kind: "modal", page: "dashboard", processStep: "transition",
    title: "Welcome to ClaimClear",
    body:
      "Every claim that lands in ClaimClear is one our automated attestation system already tried — and rejected. The auto-system couldn't safely attest it, so it kicked the ride to us to work by hand. ClaimClear is the playbook for that hand-work: a single repeatable process that turns those rejected rides into rides we can attest, and the revenue that comes with them. Before we tour the screens, let's anchor on the five steps you'll repeat for every batch. About three minutes, no clicks required — just hit Next.",
    nextLabel: "Start tour",
  },
  {
    id: 2, kind: "modal", page: "dashboard", processStep: 1,
    title: "Step 1 of 5 — Upload the transactions",
    body:
      "Start by importing the rides that weren't attestable at attestation time. These are rides we now want to attest, but to do that we first have to ask MAS to make a change on the invoice. Every dispute starts its life as a transaction in this upload.",
    nextLabel: "Next: Understand",
  },
  {
    id: 3, kind: "modal", page: "dashboard", processStep: 2,
    title: "Step 2 of 5 — Understand what's wrong with each invoice",
    body:
      "For every invoice, figure out what specifically MAS got wrong (or what's missing) and what evidence we'd need to prove it. This is the difference between a dispute that lands and one that gets denied: the right ask, paired with the right proof.",
    nextLabel: "Next: Gather",
  },
  {
    id: 4, kind: "modal", page: "dashboard", processStep: 3,
    title: "Step 3 of 5 — Gather the evidence",
    body:
      "Use the Queue or the invoice page to kick off our fact-finding process. That process pulls together the documents, GPS, signatures, and notes that back up the change we're asking MAS to make.",
    nextLabel: "Next: Submit",
  },
  {
    id: 5, kind: "modal", page: "dashboard", processStep: 4,
    title: "Step 4 of 5 — Submit the dispute",
    body:
      "Once fact-finding produces clean evidence, submit the dispute to MAS — either through the payor portal or by email, depending on what each invoice requires. The app routes you to the right channel.",
    nextLabel: "Next: Respond",
  },
  {
    id: 6, kind: "modal", page: "dashboard", processStep: 5,
    title: "Step 5 of 5 — Read the response and decide, right then",
    body:
      "When MAS responds, it lands on the Responses page. The decision happens in that moment: read it back, and either (a) re-attest the ride right there if you have the authority and the response is clean, or (b) queue it at the station for a billing supervisor to process. Either way the call is made when you read the response — nothing sits unowned. Reattested rides are revenue we recovered.",
    nextLabel: "Next",
  },
  {
    id: 7, kind: "modal", page: "dashboard", processStep: "transition",
    title: "Now let's see where this lives in the app",
    body:
      "That's the loop. The rest of the tour shows you exactly which screen corresponds to each of those five steps, so you know where to go when you're working a real batch.",
    nextLabel: "See the app",
  },

  // ═══════ Dashboard — one full-screen overview ═══════
  {
    id: 8, kind: "modal", page: "dashboard", processStep: 5,
    title: "Dashboard — your money model and your work surface, on one screen",
    body:
      "The sidebar on the left is the whole app — Today's work up top, Browse below. The KPI strip across the top is the money model: every group lands in exactly one bucket — At risk (in flight), Already lost (denied or expired), or Reclaimed (recovered). The numbers reconcile, so the totals are trustworthy. Below it, four hero columns surface what each of the five steps owes you today: file today, stuck after submit, respond, re-attest. Empty column = clean lane. Click any row to jump straight into a group.",
    nextLabel: "Next: the Queue",
  },

  // ═══════ Queue — intro + 4 lane coaches ═══════
  {
    id: 9, kind: "modal", page: "queue", processStep: 3,
    title: "The Queue — where most of your day actually happens",
    body:
      "Steps 2, 3, and 4 of the loop all happen here. Each column is a stage, left to right: Triage, Investigate, Gather proof, Submit. Pick the leftmost non-empty column and walk it down. Let's go column by column — what each one is, and what you do there.",
    nextLabel: "Next: Triage",
  },
  {
    id: 10, kind: "coach", page: "queue", processStep: 2,
    anchor: { selector: '[data-tour="queue-lane-triage"]', placement: "right" },
    title: "Triage — first look at every new dispute",
    body:
      "Brand-new uploads land here. Open each card, classify what kind of issue MAS got wrong (wrong distance, missing signature, wrong code, etc.), and tag it. A 30-second judgment call per invoice is enough — we're sorting, not solving yet.",
    nextLabel: "Next: Investigate",
  },
  {
    id: 11, kind: "coach", page: "queue", processStep: 2,
    anchor: { selector: '[data-tour="queue-lane-investigate"]', placement: "right" },
    title: "Investigate — figure out the exact ask",
    body:
      "Now go deeper. For each invoice, decide the precise change you'll ask MAS to make and what proof would convince them. This is the most thinking-heavy column — the difference between a dispute that lands and one that bounces back as denied.",
    nextLabel: "Next: Gather proof",
  },
  {
    id: 12, kind: "coach", page: "queue", processStep: 3,
    anchor: { selector: '[data-tour="queue-lane-gather"]', placement: "left" },
    title: "Gather proof — pull the evidence together",
    body:
      "Kick off the fact-finding workflow that pulls GPS pings, driver signatures, dispatch notes, and any uploaded documents. The system does most of the legwork; your job is to confirm the packet is clean and complete before it ships.",
    nextLabel: "Next: Submit",
  },
  {
    id: 13, kind: "coach", page: "queue", processStep: 4,
    anchor: { selector: '[data-tour="queue-lane-submit"]', placement: "left" },
    title: "Submit — send the packet to MAS",
    body:
      "The evidence packet is ready. Click submit and the app routes you to the right channel for that invoice — either the MAS portal or an Outlook email — and the dispute is officially in flight. From here it shows up on the dashboard as At Risk until MAS responds.",
    nextLabel: "Next: Responses",
  },

  // ═══════ Responses — intro + 3 column coaches ═══════
  {
    id: 14, kind: "modal", page: "responses", processStep: 5,
    title: "Responses Awaiting Review — Step 5 lives here",
    body:
      "When MAS replies to a submitted dispute, it lands here with a verdict pending. Three columns work together: the response thread on the left, the AI's read in the middle, and your verdict on the right. Same rule as the Queue — let's walk them column by column.",
    nextLabel: "Next: the thread",
  },
  {
    id: 15, kind: "coach", page: "responses", processStep: 5,
    anchor: { selector: '[data-tour="responses-thread"]', placement: "right" },
    title: "Thread — every MAS reply, oldest first",
    body:
      "All open responses across every group, sorted by oldest. Click one to open it for review. The bold rows are responses you haven't read yet — that's your worklist for the day. Empty list = nothing pending.",
    nextLabel: "Next: AI read",
  },
  {
    id: 16, kind: "coach", page: "responses", processStep: 5,
    anchor: { selector: '[data-tour="responses-airead"]', placement: "top" },
    title: "AI Read — what MAS said, summarized",
    body:
      "MAS's actual reply on top, the AI's summary and recommended verdict below. Use the AI as a second pair of eyes, not a decision: it tells you what it would do, but you make the call. Always read the original reply before trusting the summary.",
    nextLabel: "Next: Verdict",
  },
  {
    id: 17, kind: "coach", page: "responses", processStep: 5,
    anchor: { selector: '[data-tour="responses-verdict"]', placement: "left" },
    title: "Verdict — decide right then, in the moment of reading",
    body:
      "Three buttons, one of them gets clicked before you move on: Re-attest if the response is clean and you have the authority, Queue at station if a billing supervisor needs to handle it, Mark lost if MAS denied. Nothing sits unowned. The decision is final the moment you click.",
    nextLabel: "Next: Attestation",
  },

  // ═══════ Attestation ═══════
  {
    id: 18, kind: "modal", page: "attestation", processStep: 5,
    title: "Attestation Queue — closing the loop",
    body:
      "Invoice groups with approved verdicts that still need to be re-attested in the payor portal. The amber badge in the sidebar is the count of groups owed off-system. Once a group clears, every ride in it is recovered revenue.",
    nextLabel: "Next: Browse",
  },

  // ═══════ Browse section — Invoice Groups + Claims (with the filter trap) ═══════
  {
    id: 19, kind: "modal", page: "invoice-groups", processStep: "transition",
    title: "Invoice Groups — every group, every state, in one list",
    body:
      "When the dashboard's hero columns aren't enough — when you need to find a specific group, audit a status, or do bulk work — this is the catalog. Every invoice group ever uploaded lives here, regardless of which step it's on. The filter bar at the top makes this page usable. It also makes it easy to get lost. Let's look at it next, because there's one thing every new operator gets caught by.",
    nextLabel: "Next: the filter trap",
  },
  {
    id: 20, kind: "coach", page: "invoice-groups", processStep: "all",
    anchor: { selector: '[data-tour="invoice-groups-filters"]', placement: "bottom" },
    title: "⚠️ Two filters hide rows by default — read this carefully",
    body:
      "By default this page hides anything you can't act on right now. 'Engagement: Needs engagement' is set, which hides resolved and awaiting-response groups. 'Show past-deadline' is OFF, which hides expired groups (47 hidden right now, see the badge). If you hunt for a group and it doesn't appear — these are why. Flip 'Engagement' to All, or check 'Show past-deadline', and the missing rows come back. The exact same two filters apply on the Claims page — same trap.",
    nextLabel: "Next: opening a group",
  },
  {
    id: 21, kind: "coach", page: "group-detail", processStep: "all",
    anchor: { selector: '[data-tour="group-gauntlet"]', placement: "left" },
    title: "Group detail — the Submission Gauntlet is the path to done",
    body:
      "When you open a group, this is your workspace. The legs on the left are every ride in the group; the Submission Gauntlet on the right is a 4-step checklist that takes the group from 'needs evidence' to 'submitted to MAS'. Follow it top to bottom — when the last step lights up, the group is in flight. The 'What's next' card under the gauntlet gives you AI-driven suggestions if you're stuck on what to do.",
    nextLabel: "Next: Claims",
  },
  {
    id: 22, kind: "modal", page: "claims", processStep: "transition",
    title: "Claims — same idea as Groups, but one ride at a time",
    body:
      "Sometimes you're not looking for a group, you're looking for a specific ride — by car number, client, or date. That's this page. The sub-status pills at the top (Investigating, Ready, Blocked, Submitted) jump you straight to a workflow state. ⚠️ The same two default filters apply here as on Invoice Groups: 'Needs engagement' is on, 'Show past-deadline' is off (128 hidden right now). If a leg seems missing, those filters are why.",
    nextLabel: "Next: a single claim",
  },
  {
    id: 23, kind: "coach", page: "claim-detail", processStep: "all",
    anchor: { selector: '[data-tour="claim-sop-player"]', placement: "left" },
    title: "Claim detail — the SOP Player is the source of truth",
    body:
      "Open any claim and this is what you get. The SOP Player walks you through a decision tree custom-built for this claim's error type — answer each question in order, and at the end you have a fully-justified ask, evidence attached and ready to roll up into the group's submission. Whatever the SOP Player says, that IS the SOP. No off-script work, no improvising.",
    nextLabel: "Next: Replay",
  },

  // ═══════ Replay ═══════
  {
    id: 24, kind: "coach", page: "dashboard", processStep: "closing",
    anchor: { selector: '[data-tour="sidebar-take-tour"]', placement: "right" },
    title: "Replay anytime",
    body:
      "That's the whole loop, and the whole tour. You can re-launch it whenever you want from the Help section in the sidebar — handy when onboarding a new teammate. Welcome aboard.",
    nextLabel: "Finish",
  },
];
