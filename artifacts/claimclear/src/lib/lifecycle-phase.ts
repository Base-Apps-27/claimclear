// One-page mapping of every claim/group status to a small set of
// "lifecycle phases". Phase, not status, is what the workflow player and the
// list-page tabs branch on — so adding or renaming a status only requires
// touching this file.
//
// Phases (the only thing UI code should switch on):
//   pre-submit          — work the dispute is still being prepared for the portal
//   in-flight           — portal/email submission queued, sent, or awaiting reply
//   response-pending    — payer response landed and needs a human verdict
//   mas-action-required — MAS portal verdict received (Eligible); operator must
//                         re-attest in MAS portal before funds release
//   on-hold             — manually parked; deadline clock still ticks
//   closed              — terminal state, nothing else to do
//
// The "two flavors of Needs Review" semantic split (pre-classification vs
// post-response) is a separate task — for now Needs Review maps to
// response-pending because the dominant operator action on it is "review the
// payer response that just arrived".

export type LifecyclePhase =
  | "pre-submit"
  | "in-flight"
  | "response-pending"
  | "mas-action-required"
  | "closed"
  | "on-hold";

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
  // dispute path). See `engageMasEligibleAttestationCascade` on the
  // server for the auto-routing into the attestation queue.
  "mas-action-required": ["MAS Eligible"],
  "closed": ["Resolved", "Denied", "Withdrawn"],
  "on-hold": ["On Hold"],
};

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
// Engagement-needed = pre-submit + response-pending + mas-action-required.
//   pre-submit          — operator owes work to package & file
//   response-pending    — payor response landed, operator must verdict it
//   mas-action-required — MAS verdict in, operator must re-attest
//
// Parked / managed = in-flight (waiting on portal/payor), on-hold (manually
// parked), closed (terminal). Expired is its own gate, filtered via the
// separate `includeExpired` URL param.
// ──────────────────────────────────────────────────────────────────────────
export const ENGAGEMENT_NEEDED_PHASES: readonly LifecyclePhase[] = [
  "pre-submit",
  "response-pending",
  "mas-action-required",
];

export const ENGAGEMENT_NEEDED_STATUSES: readonly string[] = ENGAGEMENT_NEEDED_PHASES.flatMap(
  (p) => STATUSES_BY_PHASE[p],
);

// Group rollup: when collapsing a set of leg statuses into one phase for the
// invoice group, only "disputed" legs (errorTypeId != null) count. Clean legs
// sit on the same invoice but were never part of any dispute and must not
// drag the group's phase backwards. Earliest (most-blocking) phase wins —
// one stuck leg blocks the whole invoice's submission, by design.
//
// Order is the natural reading direction of work; on-hold is grouped with
// the in-flight stretch so a parked leg shows up as still blocking
// downstream work but doesn't masquerade as either pre-submit or closed.
// `mas-action-required` sits just before `closed` because a MAS-Eligible
// leg has a positive verdict and only one off-system step remaining
// (re-attest in MAS portal) — closer to closed than to response-pending,
// but still active work.
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

// Shared tab vocabulary for the Claims and Invoice Groups list pages. Both
// pages must use the same labels and the same status buckets — the only
// difference is the row entity. Source of truth lives here so a status added
// to STATUSES_BY_PHASE flows into both filter strips without further edits.
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
