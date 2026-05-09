// LifecyclePhase — the 6-bucket UI phase the workflow player and the
// list-page tabs branch on.
//
// PASSTHROUGH MODULE (Wave C of the hierarchical state-machine
// refactor — docs/architecture/state-hierarchy-v1.md and
// state-hierarchy-execution-plan.md §6). The canonical source for an
// invoice group's lifecycle is now the `invoice_groups.phase` column
// surfaced as `group.phase` on every InvoiceGroupResponse. This file:
//
//   * defines the LifecyclePhase union (unchanged tab vocabulary —
//     `LIFECYCLE_TABS` is what the URL filter strip serializes, so it
//     stays status-keyed for one wave; Wave D restructures filters)
//   * exposes `getGroupLifecyclePhaseFromGroup(group)` — the new
//     canonical reader, maps `group.phase` → LifecyclePhase and
//     handles the on-hold / awaiting-payout edge cases the same way
//     `lib/macro-phase.ts` does on the server
//   * keeps the legacy `getLifecyclePhase(status)` and
//     `getGroupLifecyclePhase(status, legs)` signatures alive (now
//     marked @deprecated) so a small number of call sites that still
//     have only a status string in scope continue to work until
//     Wave D
//
// Phases (the only thing UI code should switch on):
//   pre-submit          — work the dispute is still being prepared for the portal
//   in-flight           — portal/email submission queued, sent, or awaiting reply
//   response-pending    — payer response landed and needs a human verdict
//   mas-action-required — MAS portal verdict received (Eligible); operator must
//                         re-attest in MAS portal before funds release
//   on-hold             — manually parked; deadline clock still ticks
//   closed              — terminal state, nothing else to do
import type { InvoicePhase } from "@workspace/vocab";

export type LifecyclePhase =
  | "pre-submit"
  | "in-flight"
  | "response-pending"
  | "mas-action-required"
  | "closed"
  | "on-hold";

// Canonical operator-facing labels for each macro phase. Single source
// of truth for phase chip text everywhere — Dashboard tiles, Queue
// tabs, Sidebar badges, Responses screens. Routing UI text through
// here keeps the labels exactly consistent the way `<StateBadge
// variant="phase">` does for the wire-level `InvoicePhase` enum.
// (Task #559 — surfaces share rollup counts and labels.)
export const MACRO_PHASE_LABEL: Record<LifecyclePhase | "awaiting-payout", string> = {
  "pre-submit": "Pre-submit",
  "in-flight": "In Flight",
  "response-pending": "Response Pending",
  "mas-action-required": "MAS Action Required",
  "awaiting-payout": "Awaiting Payout",
  "closed": "Closed",
  "on-hold": "On Hold",
};

/** Display label for a macro/lifecycle phase (e.g. "MAS Action Required"). */
export function macroPhaseLabel(phase: LifecyclePhase | "awaiting-payout"): string {
  return MACRO_PHASE_LABEL[phase];
}

// Canonical phase → LifecyclePhase mapping. `reviewed` rolls up to
// `response-pending` because the operator-facing surface for a
// fully-verdicted-but-not-MAS-yet invoice is still the response-review
// lane. (Same call as the server's PHASE_TO_MACRO in lib/macro-phase.ts.)
const PHASE_TO_LIFECYCLE: Record<InvoicePhase, Exclude<LifecyclePhase, "on-hold">> = {
  triage: "pre-submit",
  ready_to_submit: "pre-submit",
  submitted: "in-flight",
  response_received: "response-pending",
  reviewed: "response-pending",
  awaiting_reattestation: "mas-action-required",
  closed: "closed",
};

export const STATUSES_BY_PHASE: Record<LifecyclePhase, readonly string[]> = {
  // "Processed" sits in pre-submit alongside New / Needs Evidence —
  // the leg's worktree is done but the parent invoice has not yet
  // been packaged. The "Action Required" tab below picks up every
  // status in this bucket, so a Processed leg keeps showing up in
  // the operator's queue until the invoice is packaged. (See
  // task-231 for the full rationale.)
  "pre-submit": ["New", "Needs Evidence", "Processed"],
  "in-flight": ["Portal Queued", "Generating Email", "Awaiting Response"],
  "response-pending": ["Ready to Review", "Needs Review"],
  // MAS Eligible: positive MAS portal verdict, re-attestation owed in
  // MAS portal before the carrier releases funds. Distinct from
  // response-pending (which means a payor response landed via the
  // dispute path).
  "mas-action-required": ["MAS Eligible"],
  "closed": ["Resolved", "Denied", "Withdrawn"],
  "on-hold": ["On Hold"],
};

/**
 * Status-based legacy reader. Used only by callers that still hold a
 * status string (URL filter strips, list-page tab serialization). New
 * reader code MUST call {@link getGroupLifecyclePhaseFromGroup} on the
 * full group/claim row instead.
 *
 * @deprecated Wave C — read `group.phase` via getGroupLifecyclePhaseFromGroup.
 */
export function getLifecyclePhase(
  status: string | null | undefined,
): LifecyclePhase {
  if (!status) return "pre-submit";
  for (const phase of Object.keys(STATUSES_BY_PHASE) as LifecyclePhase[]) {
    if (STATUSES_BY_PHASE[phase].includes(status)) return phase;
  }
  return "pre-submit";
}

export const isPreSubmit = (s: string | null | undefined) =>
  getLifecyclePhase(s) === "pre-submit";
export const isInFlight = (s: string | null | undefined) =>
  getLifecyclePhase(s) === "in-flight";
export const isResponsePending = (s: string | null | undefined) =>
  getLifecyclePhase(s) === "response-pending";
export const isClosed = (s: string | null | undefined) =>
  getLifecyclePhase(s) === "closed";
export const isOnHold = (s: string | null | undefined) =>
  getLifecyclePhase(s) === "on-hold";

// ──────────────────────────────────────────────────────────────────────────
// Operator-engagement filter — what counts as "needs my action right now"
// vs. "managed / parked / done". Used by the prominent default-on
// "Needs engagement" toggle on the Claims, Invoice Groups, and Queue
// list pages (Task: needs-engagement-default-filter).
//
// Engagement-needed = pre-submit + response-pending.
//   pre-submit          — operator owes work to package & file
//   response-pending    — payor response landed, operator must verdict it
//
// Parked / managed = in-flight (waiting on portal/payor), on-hold (manually
// parked), closed (terminal). Expired is its own gate, filtered via the
// separate `includeExpired` URL param. Re-attestation work lives on the
// dedicated Attestation Queue page and is not surfaced as a separate
// "needs engagement" bucket here.
// ──────────────────────────────────────────────────────────────────────────
export const ENGAGEMENT_NEEDED_PHASES: readonly LifecyclePhase[] = [
  "pre-submit",
  "response-pending",
];

export const ENGAGEMENT_NEEDED_STATUSES: readonly string[] = ENGAGEMENT_NEEDED_PHASES.flatMap(
  (p) => STATUSES_BY_PHASE[p],
);

// Group rollup ordering — earliest (most-blocking) phase wins. On-hold
// is grouped between response-pending and mas-action-required so a
// parked leg shows up as still blocking downstream work but doesn't
// masquerade as either pre-submit or closed.
const PHASE_ORDER: readonly LifecyclePhase[] = [
  "pre-submit",
  "in-flight",
  "response-pending",
  "on-hold",
  "mas-action-required",
  "closed",
];

export interface RideForRollup {
  status: string;
  errorTypeId?: string | null;
}

/**
 * Status-based legacy group rollup. Folds disputed legs' statuses into
 * the earliest LifecyclePhase. Kept for callers that still walk legs by
 * status; new code should consume `group.phase` directly via
 * {@link getGroupLifecyclePhaseFromGroup}.
 *
 * @deprecated Wave C — read `group.phase`.
 */
export function getGroupLifecyclePhase(
  groupStatus: string | null | undefined,
  legs: ReadonlyArray<RideForRollup> = [],
): LifecyclePhase {
  if (groupStatus && (groupStatus === "Resolved" || groupStatus === "Denied" || groupStatus === "Withdrawn")) {
    return "closed";
  }
  const disputed = legs.filter((l) => l.errorTypeId != null);
  if (disputed.length === 0) return getLifecyclePhase(groupStatus);
  let earliest: LifecyclePhase = "closed";
  for (const l of disputed) {
    const p = getLifecyclePhase(l.status);
    if (PHASE_ORDER.indexOf(p) < PHASE_ORDER.indexOf(earliest)) earliest = p;
  }
  return earliest;
}

// ──────────────────────────────────────────────────────────────────────────
// CANONICAL Wave-C reader. Reads `group.phase` from the row directly;
// falls back to the status-based path only when the caller hasn't
// fetched the new column yet.
// ──────────────────────────────────────────────────────────────────────────
export interface GroupForLifecyclePhase {
  phase?: InvoicePhase | string | null;
  status?: string | null | undefined;
  reattestCompletedAt?: string | null;
}

export function getGroupLifecyclePhaseFromGroup(
  group: GroupForLifecyclePhase,
): LifecyclePhase {
  // On-hold is sourced from legacy status — the phase column treats
  // hold as a flag and backfills hold-suspended rows to `triage`.
  // Mirrors the server's macro-phase.ts derivation.
  if (group.status === "On Hold") return "on-hold";
  if (group.phase && group.phase in PHASE_TO_LIFECYCLE) {
    return PHASE_TO_LIFECYCLE[group.phase as InvoicePhase];
  }
  return getLifecyclePhase(group.status);
}

// Shared tab vocabulary for the Claims and Invoice Groups list pages. Both
// pages must use the same labels and the same status buckets — the only
// difference is the row entity. Source of truth lives here so a status added
// to STATUSES_BY_PHASE flows into both filter strips without further edits.
//
// Tabs stay status-keyed for Wave C because the URL ?status=… filter
// param serializes status strings; Wave D will restructure the filter
// API to take phase values directly.
export type LifecycleTabKey =
  | "All"
  | "Action Required"
  | "In Flight"
  | "Response Pending"
  | "MAS Action"
  | "On Hold"
  | "Closed";

export interface LifecycleTab {
  key: LifecycleTabKey;
  label: string;
  statuses: string[];
}

export const LIFECYCLE_TABS: LifecycleTab[] = [
  { key: "All", label: "All", statuses: [] },
  {
    key: "Action Required",
    label: "Action Required",
    statuses: [...STATUSES_BY_PHASE["pre-submit"]],
  },
  {
    key: "In Flight",
    label: "In Flight",
    statuses: [...STATUSES_BY_PHASE["in-flight"]],
  },
  {
    key: "Response Pending",
    label: "Response Pending",
    statuses: [...STATUSES_BY_PHASE["response-pending"]],
  },
  {
    key: "MAS Action",
    label: "MAS Action",
    statuses: [...STATUSES_BY_PHASE["mas-action-required"]],
  },
  {
    key: "On Hold",
    label: "On Hold",
    statuses: [...STATUSES_BY_PHASE["on-hold"]],
  },
  {
    key: "Closed",
    label: "Closed",
    statuses: [...STATUSES_BY_PHASE["closed"]],
  },
];

// ──────────────────────────────────────────────────────────────────────────
// Per-leg sub-status — derived projection used by the per-invoice / per-leg
// UI surfaces (legs panel, MAS Action checklist, attestation queue). NEVER
// stored — always recomputed from the discrete columns introduced in the
// per-leg state-machine schema reshape (see Task #195 / per-invoice-
// transition design doc).
//
// The pinned vocabulary, the input shape, and the derivation function all
// live in `@workspace/leg-state` (a tiny dependency-free shared package
// also re-exported by `@workspace/db`) so server endpoints (contracts
// task) and client UI surfaces use a single source of truth and cannot
// drift. This module re-exports them for backwards compatibility with
// existing client imports.
// ──────────────────────────────────────────────────────────────────────────
export {
  type LegSubStatus,
  type LegForSubStatus,
  deriveLegSubStatus,
  LEG_SUB_STATUSES,
} from "@workspace/leg-state";

export function deriveLifecycleTab(filterStatuses: string[]): LifecycleTabKey {
  if (filterStatuses.length === 0) return "All";
  for (const t of LIFECYCLE_TABS) {
    if (t.statuses.length === 0) continue;
    if (
      t.statuses.length === filterStatuses.length &&
      t.statuses.every((s) => filterStatuses.includes(s))
    ) {
      return t.key;
    }
  }
  return "All";
}
