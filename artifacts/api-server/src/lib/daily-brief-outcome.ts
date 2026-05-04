// Pure helpers for the daily-brief outcome → cron-status mapping,
// at-risk-dollar sum, and bounce-spike downgrade rule.

export type BriefOutcome = "ok" | "degraded" | "failed";

export interface BriefRecipientResult {
  email: string;
  ok: boolean;
  errorExcerpt: string | null;
}

export interface ComputeBriefOutcomeInput {
  recipientCount: number;
  results: BriefRecipientResult[];
  // Forces "failed" when an upstream guard prevented any send.
  topLevelFailure?: boolean;
}

export interface BriefOutcomeSummary {
  outcome: BriefOutcome;
  sentCount: number;
  recipientCount: number;
  failureCount: number;
  failures: { email: string; error: string }[];
  message: string;
}

// topLevelFailure → failed; 0 recipients → failed; all sent → ok;
// 0 sent → failed; otherwise degraded.
export function computeBriefOutcome(input: ComputeBriefOutcomeInput): BriefOutcomeSummary {
  const sentCount = input.results.filter((r) => r.ok).length;
  const failureCount = input.results.length - sentCount;
  const failures = input.results
    .filter((r) => !r.ok)
    .map((r) => ({ email: r.email, error: (r.errorExcerpt ?? "unknown error").slice(0, 200) }));

  let outcome: BriefOutcome;
  if (input.topLevelFailure) {
    outcome = "failed";
  } else if (input.recipientCount === 0) {
    outcome = "failed";
  } else if (sentCount === input.recipientCount && failureCount === 0) {
    outcome = "ok";
  } else if (sentCount === 0) {
    outcome = "failed";
  } else {
    outcome = "degraded";
  }

  let message: string;
  if (outcome === "failed" && input.recipientCount === 0) {
    message = "Daily brief: 0 recipients (no users opted in or recipient query failed)";
  } else if (outcome === "failed" && input.topLevelFailure) {
    message = "Daily brief failed before per-recipient sends could run";
  } else if (outcome === "failed") {
    message = `Daily brief: 0 of ${input.recipientCount} recipients received the email`;
  } else if (outcome === "degraded") {
    message = `Daily brief degraded: ${sentCount} of ${input.recipientCount} sent, ${failureCount} failed`;
  } else {
    message = `Daily brief: ${sentCount} of ${input.recipientCount} sent`;
  }

  return { outcome, sentCount, recipientCount: input.recipientCount, failureCount, failures, message };
}

export function mapBriefOutcomeToCronStatus(outcome: BriefOutcome): "ok" | "degraded" | "failed" {
  return outcome;
}

export interface ClaimAmountAtRiskInput {
  claimAmount: string | number | null | undefined;
}

// Sums claim_amount, treating null/NaN/empty-string as $0.
export function safeClaimAmountAtRisk(claims: ClaimAmountAtRiskInput[]): number {
  let total = 0;
  for (const c of claims) {
    const raw = c.claimAmount;
    if (raw == null) continue;
    const n = typeof raw === "number" ? raw : parseFloat(String(raw));
    if (Number.isFinite(n)) total += n;
  }
  return total;
}

export interface BounceDowngradeInput {
  recipientCount: number;
  bounceCount: number;
}

export const BOUNCE_DOWNGRADE_SHARE = 0.5;
export const BOUNCE_DOWNGRADE_SMALL_LIST_THRESHOLD = 2;
export const BOUNCE_DOWNGRADE_SMALL_LIST_CAP = 5;
export const BOUNCE_RECHECK_WINDOW_MS = 10 * 60 * 1000;

// Returns "degraded" if bounces are >=50% of recipients OR >=2 bounces
// on a list of <=5 recipients; "ok" otherwise.
export function evaluateBounceDowngrade(input: BounceDowngradeInput): "ok" | "degraded" {
  if (input.recipientCount <= 0 || input.bounceCount <= 0) return "ok";
  const share = input.bounceCount / input.recipientCount;
  if (share >= BOUNCE_DOWNGRADE_SHARE) return "degraded";
  if (
    input.recipientCount <= BOUNCE_DOWNGRADE_SMALL_LIST_CAP &&
    input.bounceCount >= BOUNCE_DOWNGRADE_SMALL_LIST_THRESHOLD
  ) {
    return "degraded";
  }
  return "ok";
}
