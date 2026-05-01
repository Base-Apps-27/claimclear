// Shared mock data for the gauntlet-preview-edit variants (E1 inline,
// E2 slide-over) and the queue-flow integration map.
//
// Two-panel model:
//   • Panel A — Rides & legs. Each leg goes through SOP (with per-leg
//     content + per-leg context) OR is marked Non-issue / Non-contestable.
//     Panel A is "complete" when every leg has reached one of those
//     conclusions. There is intentionally no "aggregate / group context"
//     surface — context lives per leg.
//   • Panel B — Submission preview. Locked until Panel A is complete.
//     Collects every disputed (SOP) leg's content + context, lets the
//     AI compose the dispute write-up, the operator reviews/edits, and
//     the result is queued for portal or email submission.

export const group = {
  id: 4218,
  invoiceNumber: "INV-2026-04812",
  clientNumber: "CLT-44210",
  status: "New" as const,
  totalAmount: "$184.50",
  errorTypeName: "GPS Pickup Too Far from Residence",
  // Submission channel is determined by error-type config in the real app.
  // GPS variance is portal-submittable; some error types route to email.
  submissionChannel: "portal" as const,
  portalName: "MAS Portal",
};

export type LegConclusion = "sop" | "non-issue" | "non-contestable";

export type Leg = {
  id: number;
  confNumber: string;
  date: string;
  amount: string;
  // --- Per-leg content (the data the leg itself carries — surfaced as
  // "what the leg says" in Panel A · Rides & legs). ---
  errorTypeName: string;
  gpsVarianceMeters: number;
  pickupAddressOnFile: string;
  pickupAddressActual: string;
  driverNote: string;
  // --- Per-leg conclusion. The Panel A → Panel B gate is satisfied when
  // every leg has a conclusion. Only "sop" legs are included in the
  // dispute write-up; the others are excluded with a brief mention. ---
  conclusion: LegConclusion;
  conclusionReason?: string;
  conclusionDecidedAt?: string;
  conclusionDecidedBy?: string;
  // --- Per-leg context (operator's notes about THIS leg, used by the
  // AI when composing the write-up). Only meaningful for "sop" legs. ---
  perLegContext: string | null;
  perLegContextSavedAt?: string;
  perLegContextSavedBy?: string;
};

export const legs: Leg[] = [
  {
    id: 88412,
    confNumber: "C-2026-04812-A",
    date: "Apr 24, 2026",
    amount: "$48.50",
    errorTypeName: "GPS Pickup Too Far from Residence",
    gpsVarianceMeters: 1840,
    pickupAddressOnFile: "418 Elm St, Springfield",
    pickupAddressActual: "Sunrise Assisted Living, 22 Maple Way",
    driverNote: "Member came out front door of assisted living facility; 5 min wait.",
    conclusion: "sop",
    conclusionDecidedAt: "Apr 28, 11:18 AM",
    conclusionDecidedBy: "M. Rivera",
    perLegContext:
      "Member confirmed by phone (call log 04/24 14:02) that this leg's pickup was at the new assisted living facility, not the address on file. Driver notes match.",
    perLegContextSavedAt: "Apr 28, 11:18 AM",
    perLegContextSavedBy: "M. Rivera",
  },
  {
    id: 88413,
    confNumber: "C-2026-04812-B",
    date: "Apr 24, 2026",
    amount: "$56.00",
    errorTypeName: "GPS Pickup Too Far from Residence",
    gpsVarianceMeters: 1820,
    pickupAddressOnFile: "418 Elm St, Springfield",
    pickupAddressActual: "Sunrise Assisted Living (return from dialysis)",
    driverNote: "Return leg of pair with #88412; same dialysis clinic dropoff origin.",
    conclusion: "sop",
    conclusionDecidedAt: "Apr 28, 11:19 AM",
    conclusionDecidedBy: "M. Rivera",
    perLegContext:
      "Same trip pair as #88412 — return leg from dialysis clinic. GPS variance identical because the destination is the new assisted living.",
    perLegContextSavedAt: "Apr 28, 11:19 AM",
    perLegContextSavedBy: "M. Rivera",
  },
  {
    id: 88414,
    confNumber: "C-2026-04812-C",
    date: "Apr 25, 2026",
    amount: "$48.00",
    errorTypeName: "GPS Pickup Too Far from Residence",
    gpsVarianceMeters: 1855,
    pickupAddressOnFile: "418 Elm St, Springfield",
    pickupAddressActual: "Sunrise Assisted Living",
    driverNote: "No notes recorded.",
    // SOP path chosen — but operator hasn't added per-leg context yet.
    // Conclusion gate is still satisfied (Panel B unlocked); write-up
    // quality for this leg degrades to "generic mention only".
    conclusion: "sop",
    conclusionDecidedAt: "Apr 28, 11:21 AM",
    conclusionDecidedBy: "M. Rivera",
    perLegContext: null,
  },
  {
    id: 88415,
    confNumber: "C-2026-04812-D",
    date: "Apr 25, 2026",
    amount: "$32.00",
    errorTypeName: "GPS Pickup Too Far from Residence",
    gpsVarianceMeters: 1835,
    pickupAddressOnFile: "418 Elm St, Springfield",
    pickupAddressActual: "Sunrise Assisted Living (return from dialysis)",
    driverNote: "Return pair of #88414.",
    // Excluded from dispute as a non-issue. Reaches a conclusion (so
    // Panel A is complete) but does not feed Panel B's write-up.
    conclusion: "non-issue",
    conclusionReason:
      "Reviewed against latest manifest — this leg was already corrected via address update on Apr 26. No dispute needed.",
    conclusionDecidedAt: "Apr 28, 11:24 AM",
    conclusionDecidedBy: "M. Rivera",
    perLegContext: null,
  },
];

// Aggregated counts derived once so every mockup uses the same numbers.
export const legCounts = {
  total: legs.length,
  sop: legs.filter((l) => l.conclusion === "sop").length,
  nonIssue: legs.filter((l) => l.conclusion === "non-issue").length,
  nonContestable: legs.filter((l) => l.conclusion === "non-contestable").length,
  pending: 0, // every leg in the demo has reached a conclusion
  sopWithContext: legs.filter((l) => l.conclusion === "sop" && l.perLegContext).length,
  sopMissingContext: legs.filter((l) => l.conclusion === "sop" && !l.perLegContext).length,
};

export const disputedTotal = "$152.50"; // 48.50 + 56.00 + 48.00
export const excludedTotal = "$32.00";  // 32.00 (non-issue)

export const aiRestatement = `You're disputing 3 of 4 legs on INV-2026-04812 ($152.50 of $184.50 billed) for member CLT-44210. The 4th leg (#88415) was reviewed and excluded as a non-issue. The 3 disputed legs share one root cause — the member relocated to assisted living on Apr 1 and the address on file is stale. You've spoken to the member to confirm. You want all 3 disputed legs reconsidered together as a single relocation-based variance, not 3 separate driver-routing disputes.`;

export const aiRestatementGeneratedAt = "Apr 28, 11:30 AM";

export const draftSubject =
  "Dispute — INV-2026-04812 — GPS pickup variance reflects member relocation, not routing error (3 of 4 legs)";

export const draftDescriptionHtml = `<p>This dispute covers 3 legs on invoice <strong>INV-2026-04812</strong> for member CLT-44210 (3 of 4 legs disputed; total disputed billing $152.50). Leg C-2026-04812-D was reviewed and <strong>excluded as a non-issue</strong> (resolved separately by the Apr 26 address update) and is not part of this submission. The disputed legs were all flagged with the same error code, "GPS Pickup Too Far from Residence." The variance is real, but it shares a single root cause that is not visible from the GPS data alone.</p>

<p>The member relocated to an assisted living facility on April 1, 2026. The residential address on file at the time of these trips (April 24 and 25) was the member's prior residence. We confirmed the relocation through the member's intake form dated 04/02 and a follow-up call with the member on April 24 at 14:02 (call log on file). Each of the three disputed legs picked up at the new assisted living facility, not the stale address that GPS is comparing against.</p>

<p>Legs C-2026-04812-A and C-2026-04812-B are an outbound/return pair to the member's dialysis clinic on April 24. Leg C-2026-04812-C is the outbound leg of the same pair on April 25 (no driver-supplied notes; included on the strength of the relocation context). Driver notes for the others are consistent with the member's stated pickup location.</p>

<p>Please reconsider all 3 disputed legs together under the relocation context — they are not independent routing errors. We have updated the member's address of record and have attached the intake form and call log as evidence.</p>`;

// Evidence files attach to one or more specific legs — there is no
// "group" scope. Files that apply to every leg list every leg id.
export const evidenceFiles = [
  { name: "member-intake-form-2026-04-02.pdf", size: "212 KB", attachedTo: "all 4 legs" },
  { name: "call-log-04-24-1402.pdf", size: "48 KB", attachedTo: "legs #88412 & #88413" },
  { name: "driver-trip-notes-04-24.pdf", size: "96 KB", attachedTo: "leg #88412" },
  { name: "driver-trip-notes-04-25.pdf", size: "104 KB", attachedTo: "leg #88414" },
];

export const gpsBreadcrumbs = ["pickup_lat_lng", "dropoff_lat_lng", "route_polyline"];

export const sopGuidance =
  "GPS Pickup Too Far from Residence: confirm member's address of record vs. trip pickup; if relocation, file with member intake form and call confirmation as supporting evidence.";

export const previewMeta = {
  generatedAt: "Apr 28, 2026 11:34 AM",
  generatedBy: "M. Rivera",
  model: "claude-sonnet-4-6",
  tokensIn: 1842,
  tokensOut: 421,
  legsCovered: 3, // SOP-conclusion legs only
  legsExcluded: 1, // non-issue / non-contestable
};

export const conclusionLabel = (c: LegConclusion): string => {
  switch (c) {
    case "sop": return "SOP";
    case "non-issue": return "Non-issue";
    case "non-contestable": return "Non-contestable";
  }
};

export const conclusionTone = (c: LegConclusion): "dispute" | "excluded" => {
  return c === "sop" ? "dispute" : "excluded";
};
