import type { ClaimResponse } from "@workspace/api-client-react";

/**
 * The shared "what to do in the payor portal" checklist used by both
 * tabs of the Re-attest modal. The "Re-attest now" tab renders these
 * as live checkboxes; the "Queue for attestation" tab renders the
 * exact same items as a read-only preview AND ships the rendered text
 * to the API so the queue surface displays the literal instructions
 * the operator was looking at when they parked the work.
 *
 * One source of truth → both surfaces stay in lockstep automatically.
 */

export interface ReattestInstructionItem {
  /** Stable id so the checkbox state can survive re-renders. */
  id: string;
  /** Operator-facing instruction sentence. */
  text: string;
}

export function buildReattestChecklist(
  approvedLegs: readonly ClaimResponse[],
  groupInvoiceNumber: string | null,
): ReattestInstructionItem[] {
  const inv = groupInvoiceNumber || "this invoice";
  const items: ReattestInstructionItem[] = [
    {
      id: "open-portal",
      text: `Open invoice ${inv} in the payor portal.`,
    },
  ];
  for (const leg of approvedLegs) {
    items.push({
      id: `cancel-${leg.id}`,
      text: `Cancel the existing claim on leg ${leg.confNumber} in the payor portal so it doesn't double-up.`,
    });
    items.push({
      id: `reattest-${leg.id}`,
      text: `Re-attest leg ${leg.confNumber} with the corrected info.`,
    });
  }
  items.push({
    id: "screenshot",
    text: "Take a confirmation screenshot or note the portal reference number for the audit trail.",
  });
  return items;
}

/**
 * Render the checklist back to a plain-text block we can persist to
 * `attestation_note` so the Attestation Queue surface shows the exact
 * instruction set the operator was looking at when they queued the
 * work. Numbered to match the on-screen list ordering.
 */
export function renderChecklistAsText(items: readonly ReattestInstructionItem[]): string {
  return items.map((it, i) => `${i + 1}. ${it.text}`).join("\n");
}
