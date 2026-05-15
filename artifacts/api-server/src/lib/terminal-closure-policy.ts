// Task #758 — Unified terminal-closure override policy.
//
// Terminal closures (Denied, Approved, Partially Approved, Non-Issue,
// Withdrawn, No Action Needed) reflect the truth on the ground and must
// be reachable from any source status. Where the existing per-status
// outcome maps already permit the target outcome, the closure runs on
// the normal lane with no extra friction. Everywhere else, the operator
// supplies an explicit override reason and the closure goes through the
// same writers — flagged in audit metadata + notes — instead of being
// silently rejected with "Cannot transition from <status>".
//
// Future contributors: do NOT silently re-introduce per-status outcome
// blocklists for terminal outcomes. They must route through the override
// lane (override.reason ≥ TERMINAL_OVERRIDE_MIN_REASON chars). The only
// thing this policy refuses outright is moving INTO a system-controlled
// status (Portal Queued / Generating Email / Ready to Review); entry
// rules are out of scope here.
//
// Important — the system-controlled NORMAL-lane allowlist (below) is
// deliberately narrow: ONLY "Ready to Review" routes terminal closures
// on the normal lane. Portal Queued / Generating Email are mid-flight
// queue states the bot owns; closing into a terminal outcome from those
// reflects the operator stepping in around the bot, which must always
// be deliberate. They stay on the override lane (≥20-char reason) even
// though the per-status outcome envelope is empty.

/**
 * Source statuses where a terminal closure runs on the normal lane even
 * though the per-status outcome envelope is empty. Keep this set small
 * and explicit. See the file header for the rationale.
 */
export const NORMAL_LANE_SYSTEM_SOURCES: ReadonlySet<string> = new Set([
  "Ready to Review",
]);

export const TERMINAL_OUTCOMES = [
  "Denied",
  "Approved",
  "Partially Approved",
  "Non-Issue",
  "Withdrawn",
  "No Action Needed",
] as const;
export type TerminalOutcome = (typeof TERMINAL_OUTCOMES)[number];

export const TERMINAL_OVERRIDE_MIN_REASON = 20;

export type TerminalClosurePolicy =
  | "allowed-normally"
  | "allowed-with-override"
  | "forbidden";

export function isTerminalOutcome(outcome: string): outcome is TerminalOutcome {
  return (TERMINAL_OUTCOMES as readonly string[]).includes(outcome);
}

/**
 * Decide how a terminal-outcome flip from `currentStatus` should be
 * processed. `validOutcomesForCurrentStatus` is the writer's existing
 * VALID_OUTCOME_BY_STATUS row (claim or group); when the target outcome
 * is in that row the move is a normal one, otherwise it requires an
 * override reason.
 *
 * Sources in `NORMAL_LANE_SYSTEM_SOURCES` (currently just Ready to
 * Review) widen the normal lane: those statuses ship with empty
 * `validOutcomesForCurrentStatus` because operators don't pick
 * outcomes from queue rows, but a terminal closure originating there
 * (most importantly "Mark Denied by Payor" from the Ready to Review
 * response-review dialog) is the normal happy path and must not require
 * an override. Other system-controlled queue statuses (Portal Queued,
 * Generating Email) are deliberately NOT included — closing into a
 * terminal outcome from them means stepping in around the bot and must
 * stay on the override lane. The transition writers pair the normal-
 * lane allowlist with a closure-bypass that relaxes the per-status
 * status-transition + outcome-envelope guards in the same case, so the
 * UI can submit without an override panel and the backend accepts it.
 */
export function getTerminalClosurePolicy(
  currentStatus: string,
  targetOutcome: string,
  validOutcomesForCurrentStatus: readonly string[],
): TerminalClosurePolicy {
  if (!isTerminalOutcome(targetOutcome)) return "forbidden";
  if (NORMAL_LANE_SYSTEM_SOURCES.has(currentStatus)) return "allowed-normally";
  if (validOutcomesForCurrentStatus.includes(targetOutcome)) return "allowed-normally";
  return "allowed-with-override";
}

/**
 * True when a terminal closure from this source status should bypass the
 * per-status status-transition + outcome-envelope guards in the writers
 * even without an explicit operator override. Mirrors the normal-lane
 * arm of `getTerminalClosurePolicy` for system-controlled sources.
 */
export function isSystemControlledClosureBypass(
  currentStatus: string,
  targetOutcome: string,
): boolean {
  return NORMAL_LANE_SYSTEM_SOURCES.has(currentStatus) && isTerminalOutcome(targetOutcome);
}

/**
 * Task #758 review feedback — `terminalLane` UI hint computation.
 *
 * The writers' policy for combined status+outcome closures mirrors the
 * writer's own status-transition + target-status outcome envelope (see
 * `transition*StatusAndOutcome`). Earlier rev computed `terminalLane`
 * purely from the source-status outcome envelope, which disagreed with
 * the writer in cases like Needs Review → Resolved/Approved (writer
 * accepts on the normal lane, UI claimed override required).
 *
 * `derivedDestStatus` is the status the writer would land in for this
 * outcome (Resolved for most positive/closed outcomes, Denied for
 * Denied). `validStatusTransitions` and `validOutcomesForDestStatus`
 * are the writer's own lookup rows for the source status and the
 * derived destination status, respectively.
 */
export function getTerminalClosureLane(opts: {
  currentStatus: string;
  targetOutcome: string;
  derivedDestStatus: string;
  validOutcomesForCurrentStatus: readonly string[];
  validStatusTransitions: readonly string[];
  validOutcomesForDestStatus: readonly string[];
}): "normal" | "override" {
  const { currentStatus, targetOutcome, derivedDestStatus,
    validOutcomesForCurrentStatus, validStatusTransitions, validOutcomesForDestStatus } = opts;
  if (!isTerminalOutcome(targetOutcome)) return "override";
  if (NORMAL_LANE_SYSTEM_SOURCES.has(currentStatus)) return "normal";
  if (validOutcomesForCurrentStatus.includes(targetOutcome)) return "normal";
  const statusOk =
    currentStatus === derivedDestStatus || validStatusTransitions.includes(derivedDestStatus);
  const outcomeOk = validOutcomesForDestStatus.includes(targetOutcome);
  if (statusOk && outcomeOk) return "normal";
  return "override";
}

/**
 * Map a terminal outcome to the status the writer will land it in.
 * Mirrors the routes' newStatus derivation in /outcome PATCH handlers.
 */
export function destStatusForTerminalOutcome(outcome: string): string {
  if (outcome === "Denied") return "Denied";
  return "Resolved";
}

export type TerminalOverride = {
  reason: string;
};

export class TerminalOverrideRequiredError extends Error {
  readonly code = "terminal_override_required";
  constructor(public readonly currentStatus: string, public readonly targetOutcome: string) {
    super(
      `This item is currently in "${currentStatus}". Recording "${targetOutcome}" from this status requires an override reason (≥${TERMINAL_OVERRIDE_MIN_REASON} characters) explaining why the system's normal flow is being bypassed.`,
    );
  }
}

export class TerminalOverrideTooShortError extends Error {
  readonly code = "terminal_override_too_short";
  constructor() {
    super(
      `Override reason must be at least ${TERMINAL_OVERRIDE_MIN_REASON} characters so the audit log captures why the normal flow was bypassed.`,
    );
  }
}

/**
 * Validate an `override` payload against the policy decision. Returns
 * the trimmed reason when an override is being applied, or null when
 * the move is on the normal lane (no override).
 *
 * Throws TerminalOverrideRequiredError when the policy is
 * "allowed-with-override" and the caller did not supply one, and
 * TerminalOverrideTooShortError when the supplied reason is too short.
 */
export function resolveTerminalOverride(
  policy: TerminalClosurePolicy,
  currentStatus: string,
  targetOutcome: string,
  override: TerminalOverride | null | undefined,
): string | null {
  if (policy === "forbidden") {
    // Caller (the writer) handles this with its own error message; the
    // policy helper merely signals the structural impossibility.
    return null;
  }
  const supplied =
    override && typeof override.reason === "string" ? override.reason.trim() : "";
  if (policy === "allowed-with-override") {
    if (supplied.length === 0) {
      throw new TerminalOverrideRequiredError(currentStatus, targetOutcome);
    }
    if (supplied.length < TERMINAL_OVERRIDE_MIN_REASON) {
      throw new TerminalOverrideTooShortError();
    }
    return supplied;
  }
  // policy === "allowed-normally"
  // An override reason is allowed but not required; if supplied and
  // long enough, carry it into audit metadata so reviewers can see the
  // operator's note even on the happy path.
  if (supplied.length === 0) return null;
  if (supplied.length < TERMINAL_OVERRIDE_MIN_REASON) {
    throw new TerminalOverrideTooShortError();
  }
  return supplied;
}
