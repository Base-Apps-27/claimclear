import type { ClaimResponse } from "@workspace/api-client-react";

/**
 * The shared attestation checklist used by both tabs of the Re-attest
 * modal AND any other surface that displays the attestation steps.
 *
 * Single source of truth, two cases only:
 *
 *   1. All legs are clear (no denials) → one item:
 *        "Re-attest the invoice."
 *
 *   2. One or more legs were denied → one MAS line per affected
 *      invoice number, then the single re-attest line:
 *        "In MAS: cancel / accept GPS deviation for invoice #{X}."
 *        "Re-attest the invoice."
 *
 * No "open the portal" item, no per-approved-leg cancel item, no
 * screenshot/audit item — those were not in the spec and were removed
 * after the user pointed out approved+positive legs need no cancel.
 */

export interface ReattestInstructionItem {
  /** Stable id so the checkbox state can survive re-renders. */
  id: string;
  /** Operator-facing instruction sentence. */
  text: string;
}

/**
 * Pull the most useful invoice number for an MAS line. Prefer the leg's
 * own `invoiceNumbers` (first token of the comma/space-delimited field
 * already on `ClaimResponse`) so multi-invoice groups still address the
 * specific affected invoice. Fall back to the group invoice number when
 * the leg has nothing on file.
 */
function legInvoiceNumber(
  leg: ClaimResponse,
  groupInvoiceNumber: string | null,
): string {
  const raw = (leg.invoiceNumbers ?? "").trim();
  if (raw) {
    const first = raw.split(/[,\s]+/).filter(Boolean)[0];
    if (first) return first;
  }
  return groupInvoiceNumber || "this invoice";
}

export function buildReattestChecklist(
  deniedLegs: readonly ClaimResponse[],
  groupInvoiceNumber: string | null,
  rename?: { from: string; to: string } | null,
): ReattestInstructionItem[] {
  const items: ReattestInstructionItem[] = [];
  // Task #455 — when the operator confirmed a payor-cited new invoice
  // number, the rename is the *first* checklist line so it's the first
  // thing the portal user (or whoever picks this off the queue) sees.
  if (rename && rename.to && rename.to !== rename.from) {
    items.push({
      id: `rename-${rename.to}`,
      text: `Update the invoice # from #${rename.from} to #${rename.to}.`,
    });
  }
  // Case 2: one MAS line per denied leg, addressed at the affected
  // invoice number. De-duplicated when several denied legs share the
  // same invoice number so the operator doesn't tick the same MAS
  // gesture twice.
  const seen = new Set<string>();
  for (const leg of deniedLegs) {
    const inv = legInvoiceNumber(leg, groupInvoiceNumber);
    if (seen.has(inv)) continue;
    seen.add(inv);
    items.push({
      id: `mas-${inv}`,
      text: `In MAS: cancel / accept GPS deviation for invoice #${inv}.`,
    });
  }
  // The single re-attest step closes both cases. When there are no
  // denials this is the only item on the list.
  items.push({
    id: "reattest",
    text: "Re-attest the invoice.",
  });
  return items;
}

/**
 * Render the checklist as plain text for persistence on the
 * Attestation Queue surface so the queued row shows the literal
 * walkthrough text the operator was looking at when they parked it.
 */
export function renderChecklistAsText(items: readonly ReattestInstructionItem[]): string {
  return items.map((it, i) => `${i + 1}. ${it.text}`).join("\n");
}
