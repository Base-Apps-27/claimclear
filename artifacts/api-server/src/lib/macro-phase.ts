// MacroPhase — the 7-bucket UI/transition phase used by per-invoice
// surfaces (group detail header, MAS Action checklist, dashboard
// macro-phase rollups, denormalized cache, etc.). This module is now a
// THIN PASSTHROUGH on top of the canonical `invoice_groups.phase`
// column shipped in Wave A/B of the hierarchical state-machine refactor
// (see docs/architecture/state-hierarchy-v1.md and
// state-hierarchy-execution-plan.md §6 / Wave C).
//
// Read order during Wave C/D:
//   1. `On Hold` is sourced from legacy `status` — the canonical phase
//      column treats hold as a flag, not a phase, and backfills
//      hold-suspended rows to `triage`. Until Wave D restructures the
//      hold representation, the macro `on-hold` bucket has to come
//      from `status === "On Hold"`.
//   2. `awaiting-payout` is the transient "re-attest done, payor not
//      yet booked" phase. The phase column flips straight from
//      `awaiting_reattestation` to `closed` on re-attest completion;
//      the macro `awaiting-payout` lane is preserved here by reading
//      `reattestCompletedAt` ahead of the phase mapping for groups
//      that haven't yet flipped to closed.
//   3. Otherwise: `group.phase` → MacroPhase via PHASE_TO_MACRO.
//   4. Legacy fallback to `status` for callers that haven't been
//      switched to read the full row yet (denormalized cache write
//      path, portal-submissions ctx, Wave D writers).
import type { InvoicePhase } from "@workspace/vocab";

export type MacroPhase =
  | "pre-submit"
  | "in-flight"
  | "response-pending"
  | "mas-action-required"
  | "awaiting-payout"
  | "closed"
  | "on-hold";

// Canonical mapping. `reviewed` collapses to `response-pending` because
// from the operator's perspective a fully-verdicted invoice that hasn't
// transitioned to MAS work yet is still in the "review the response"
// lane. Once any verdict requires re-attest it advances to
// `awaiting_reattestation` (→ `mas-action-required`).
const PHASE_TO_MACRO: Record<InvoicePhase, Exclude<MacroPhase, "on-hold" | "awaiting-payout">> = {
  triage: "pre-submit",
  ready_to_submit: "pre-submit",
  submitted: "in-flight",
  response_received: "response-pending",
  reviewed: "response-pending",
  awaiting_reattestation: "mas-action-required",
  closed: "closed",
};

const STATUSES_BY_PHASE: Record<Exclude<MacroPhase, "awaiting-payout">, readonly string[]> = {
  "pre-submit": ["New", "Needs Evidence"],
  "in-flight": ["Portal Queued", "Generating Email", "Awaiting Response"],
  "response-pending": ["Ready to Review", "Needs Review"],
  "mas-action-required": ["MAS Eligible"],
  "closed": ["Resolved", "Denied"],
  "on-hold": ["On Hold"],
};

/**
 * Status-based legacy fallback. Kept exported so write-side handlers
 * that only have a status string in scope (denormalized-cache
 * recompute, portal-submissions ctx) continue to compile during Wave
 * C/D. New reader code MUST call {@link getGroupMacroPhase} on the
 * full group row instead.
 *
 * @deprecated Wave C — read `group.phase` via getGroupMacroPhase.
 */
export function getMacroPhase(status: string | null | undefined): Exclude<MacroPhase, "awaiting-payout"> {
  if (!status) return "pre-submit";
  for (const phase of Object.keys(STATUSES_BY_PHASE) as Array<keyof typeof STATUSES_BY_PHASE>) {
    if (STATUSES_BY_PHASE[phase].includes(status)) return phase;
  }
  return "pre-submit";
}

export interface GroupForMacroPhase {
  phase?: InvoicePhase | string | null;
  status?: string | null | undefined;
  reattestRequired?: boolean | null;
  reattestCompletedAt?: Date | string | null;
}

export function getGroupMacroPhase(group: GroupForMacroPhase): MacroPhase {
  // 1. On-hold is sourced from legacy status (see module header note 1).
  if (group.status === "On Hold") return "on-hold";

  // 2. awaiting-payout = re-attest completed but the group has not yet
  //    flipped to phase=closed. Derived from the legacy timestamp
  //    column until Wave D re-models payout.
  if (group.reattestCompletedAt != null && group.phase !== "closed") {
    return "awaiting-payout";
  }

  // 3. Canonical: read the phase column.
  if (group.phase && group.phase in PHASE_TO_MACRO) {
    return PHASE_TO_MACRO[group.phase as InvoicePhase];
  }

  // 4. Legacy fallback: status-driven mapping. Used only by callers
  //    that pass a partial shape (no phase column yet). Removed in
  //    Wave D once every reader pulls the full row.
  if (group.reattestCompletedAt != null) return "awaiting-payout";
  if (group.reattestRequired === true) return "mas-action-required";
  return getMacroPhase(group.status);
}
