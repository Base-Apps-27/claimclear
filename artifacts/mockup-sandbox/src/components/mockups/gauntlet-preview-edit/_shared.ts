export const group = {
  id: 4218,
  invoiceNumber: "INV-2026-04812",
  clientNumber: "CLT-44210",
  status: "New" as const,
  totalAmount: "$184.50",
  errorTypeName: "GPS Pickup Too Far from Residence",
  groupContext:
    "Client moved to assisted living on Apr 1; old residence GPS is invalid for any trip after that date. Confirmed via member intake form 04/02. The pickup-distance variance on every leg in this group is the SAME ROOT CAUSE — not a driver routing issue.",
  groupContextSavedAt: "Apr 28, 2026 11:14 AM",
  groupContextSavedBy: "M. Rivera",
};

export type Leg = {
  id: number;
  confNumber: string;
  date: string;
  amount: string;
  errorTypeName: string;
  subStatus: "ready" | "ready" | "ready";
  perLegContext: string | null;
  perLegContextSavedAt?: string;
};

export const legs: Leg[] = [
  {
    id: 88412,
    confNumber: "C-2026-04812-A",
    date: "Apr 24, 2026",
    amount: "$48.50",
    errorTypeName: "GPS Pickup Too Far from Residence",
    subStatus: "ready",
    perLegContext:
      "Member confirmed by phone (call log 04/24 14:02) that this leg's pickup was at the new assisted living facility, not the address on file. Driver notes match.",
    perLegContextSavedAt: "Apr 28, 11:18 AM",
  },
  {
    id: 88413,
    confNumber: "C-2026-04812-B",
    date: "Apr 24, 2026",
    amount: "$56.00",
    errorTypeName: "GPS Pickup Too Far from Residence",
    subStatus: "ready",
    perLegContext:
      "Same trip pair as #88412 — return leg from dialysis clinic. GPS variance identical because the destination is the new assisted living.",
    perLegContextSavedAt: "Apr 28, 11:19 AM",
  },
  {
    id: 88414,
    confNumber: "C-2026-04812-C",
    date: "Apr 25, 2026",
    amount: "$48.00",
    errorTypeName: "GPS Pickup Too Far from Residence",
    subStatus: "ready",
    perLegContext: null,
  },
  {
    id: 88415,
    confNumber: "C-2026-04812-D",
    date: "Apr 25, 2026",
    amount: "$32.00",
    errorTypeName: "GPS Pickup Too Far from Residence",
    subStatus: "ready",
    perLegContext: "Dropoff was at the same dialysis clinic. Variance explained by member's relocation.",
    perLegContextSavedAt: "Apr 28, 11:22 AM",
  },
];

export const specialCircumstances =
  "MAS portal has been down intermittently this week — second submission attempt if first 5xx's.";

export const aiRestatement = `You're disputing 4 legs (INV-2026-04812, $184.50 total) for member CLT-44210 because every leg is flagged "GPS Pickup Too Far from Residence." The root cause is the SAME for all 4 legs — the member moved to an assisted living facility on Apr 1 and the residence on file is stale. You've spoken to the member to confirm. Two of the legs (#88412, #88413) are a trip pair to a dialysis clinic on Apr 24; the other two (#88414, #88415) are the same pair on Apr 25. You want all 4 reconsidered together as a single relocation-based variance, not 4 separate driver-routing disputes.`;

export const aiRestatementGeneratedAt = "Apr 28, 11:30 AM";

export const draftSubject =
  "Dispute — INV-2026-04812 — GPS pickup variance reflects member relocation, not routing error";

export const draftDescriptionHtml = `<p>This dispute covers 4 legs on invoice <strong>INV-2026-04812</strong> for member CLT-44210 (total billed $184.50). All 4 legs were flagged with the same error code, "GPS Pickup Too Far from Residence." The variance is real, but it shares a single root cause that is not visible from the GPS data alone.</p>

<p>The member relocated to an assisted living facility on April 1, 2026. The residential address on file at the time of these trips (April 24 and 25) was the member's prior residence. We confirmed the relocation through the member's intake form dated 04/02 and a follow-up call with the member on April 24 at 14:02 (call log on file). Each of the four legs picked up or dropped off at the new assisted living facility, not the stale address that GPS is comparing against.</p>

<p>Legs C-2026-04812-A and C-2026-04812-B are an outbound/return pair to the member's dialysis clinic on April 24. Legs C-2026-04812-C and C-2026-04812-D are the same pair on April 25. Driver notes for both days are consistent with the member's stated pickup location.</p>

<p>Please reconsider all 4 legs together under the relocation context — they are not independent routing errors. We have updated the member's address of record and have attached the intake form and call log as evidence.</p>`;

export const evidenceFiles = [
  { name: "member-intake-form-2026-04-02.pdf", size: "212 KB", scope: "group" },
  { name: "call-log-04-24-1402.pdf", size: "48 KB", scope: "group" },
  { name: "driver-trip-notes-04-24.pdf", size: "96 KB", scope: "leg #88412" },
  { name: "driver-trip-notes-04-25.pdf", size: "104 KB", scope: "leg #88414" },
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
};

export const transitionSteps = [
  { key: "legs", label: "Every leg resolved", done: true, detail: "4 ready, 0 dropped, 0 excluded" },
  { key: "readback", label: "Understanding readback confirmed", done: true, detail: "Apr 28, 11:31 AM" },
  { key: "preview", label: "Preview generated", done: true, detail: "Apr 28, 11:34 AM" },
];
