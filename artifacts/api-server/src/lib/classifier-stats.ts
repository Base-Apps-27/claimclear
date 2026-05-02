// Pure rollup math for the LLM email-classifier monitoring (Task #320).
// Extracted from the route so the daily aggregation + spike detector can
// be unit-tested without spinning up Postgres or Express.
//
// The route layer is responsible for fetching `portal_responses` rows
// (filtered to `metadata.classifierVersion IN ('llm-first-v1','llm-first-v2')`) and
// passing them in as the flat `ClassifierStatsRow[]` shape below.
// Everything past that point — including the alert math — lives here.

import type { ClassifiedDecision } from "./inbound-email-classifier";

/**
 * Verdict bins surfaced on the dashboard. Mirrors `ClassifiedDecision`
 * plus an explicit `abstain` bin for rows where the AI call was attempted
 * but failed (those rows live in the DB as `responseType=other` /
 * `classifierSource=abstain`; we promote them to their own bin so the
 * dashboard can show "the model is silent on N/day" separately from
 * legitimate `other` verdicts).
 */
export type ClassifierVerdictBin =
  | ClassifiedDecision
  | "abstain";

export const VERDICT_BINS: readonly ClassifierVerdictBin[] = [
  "approval",
  "denial",
  "partial_approval",
  "info_request",
  "acknowledgment",
  "other",
  "abstain",
] as const;

export type ClassifierSource =
  | "phrase_signature"
  | "ai"
  | "abstain"
  | "manual"
  | "keyword"
  | "retro_phrase_signature"
  | (string & {});

/**
 * One inbound `portal_responses` row, projected down to just the fields
 * the rollup needs. The route layer normalizes raw DB rows into this
 * shape so the test harness can feed plain literals.
 */
export interface ClassifierStatsRow {
  receivedAt: Date;
  classifierSource: ClassifierSource;
  responseType: ClassifiedDecision;
  /** USD spend for this row's AI call. Null/0 for non-AI rows. */
  costUsd: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface DailyClassifierStats {
  /** ISO YYYY-MM-DD in the bucketing timezone. */
  day: string;
  verdicts: Record<ClassifierVerdictBin, number>;
  /** Rows where the deterministic phrase classifier ran (no AI call). */
  phraseSignatureCount: number;
  /** Rows where the AI call was attempted (ai + abstain). */
  aiAttemptCount: number;
  /** Rows where the AI call returned a verdict. */
  aiCallCount: number;
  /** Rows where the AI call failed. */
  abstainCount: number;
  totalRows: number;
  spendUsd: number;
  inputTokens: number;
  outputTokens: number;
}

export type ClassifierAlertKind = "spike_other" | "spike_abstain";

export interface ClassifierAlert {
  kind: ClassifierAlertKind;
  message: string;
  /** The most-recent-day rate that tripped the alert (0..1). */
  recentRate: number;
  /** The trailing-window baseline rate the recent rate is compared to (0..1). */
  baselineRate: number;
  /** Sample size used to compute `recentRate`. */
  recentSample: number;
}

export interface ClassifierStatsTotals {
  rows: number;
  aiCalls: number;
  spendUsd: number;
  inputTokens: number;
  outputTokens: number;
}

export interface ClassifierStatsRollup {
  windowDays: number;
  daily: DailyClassifierStats[];
  totals: ClassifierStatsTotals;
  alerts: ClassifierAlert[];
}

function emptyVerdicts(): Record<ClassifierVerdictBin, number> {
  return {
    approval: 0,
    denial: 0,
    partial_approval: 0,
    info_request: 0,
    acknowledgment: 0,
    other: 0,
    abstain: 0,
  };
}

function dayKey(d: Date): string {
  // UTC bucketing — production runs in America/New_York but the operator
  // looks at "rough daily counts", not penny-perfect timezone math. Using
  // UTC keeps the rollup deterministic regardless of where the API
  // happens to be hosted.
  return d.toISOString().slice(0, 10);
}

function emptyDay(day: string): DailyClassifierStats {
  return {
    day,
    verdicts: emptyVerdicts(),
    phraseSignatureCount: 0,
    aiAttemptCount: 0,
    aiCallCount: 0,
    abstainCount: 0,
    totalRows: 0,
    spendUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
  };
}

/**
 * Roll a flat list of rows into the per-day series + totals + alerts.
 * Any day in the window with no rows is included as a zero row so the
 * dashboard renders a continuous timeline.
 */
export function computeClassifierStats(input: {
  windowDays: number;
  now: Date;
  rows: ClassifierStatsRow[];
  /**
   * Spike-detection thresholds. Defaults intentionally conservative:
   * ignore days with a tiny sample and require the recent rate to be at
   * least 2x the baseline AND >= 25% absolute before alerting.
   */
  spikeOptions?: {
    /** Minimum AI-attempt count on the recent day before we'll alert. */
    minRecentSample?: number;
    /** Recent rate must be >= this multiple of the baseline rate. */
    spikeMultiplier?: number;
    /** Recent rate must also clear this absolute floor. */
    minAbsoluteRate?: number;
  };
}): ClassifierStatsRollup {
  const windowDays = Math.max(1, Math.floor(input.windowDays));
  const days: string[] = [];
  // Build the day list anchored at "today" in UTC and walking back.
  const anchorUtc = Date.UTC(
    input.now.getUTCFullYear(),
    input.now.getUTCMonth(),
    input.now.getUTCDate(),
  );
  for (let i = windowDays - 1; i >= 0; i--) {
    const d = new Date(anchorUtc - i * 86_400_000);
    days.push(dayKey(d));
  }

  const byDay = new Map<string, DailyClassifierStats>();
  for (const day of days) byDay.set(day, emptyDay(day));

  for (const row of input.rows) {
    const day = dayKey(row.receivedAt);
    const bucket = byDay.get(day);
    if (!bucket) continue; // outside window

    bucket.totalRows++;
    bucket.inputTokens += row.inputTokens ?? 0;
    bucket.outputTokens += row.outputTokens ?? 0;
    bucket.spendUsd += row.costUsd ?? 0;

    if (row.classifierSource === "ai") {
      bucket.aiAttemptCount++;
      bucket.aiCallCount++;
      bucket.verdicts[row.responseType]++;
    } else if (row.classifierSource === "abstain") {
      bucket.aiAttemptCount++;
      bucket.abstainCount++;
      bucket.verdicts.abstain++;
    } else if (
      row.classifierSource === "phrase_signature" ||
      row.classifierSource === "retro_phrase_signature"
    ) {
      bucket.phraseSignatureCount++;
      bucket.verdicts[row.responseType]++;
    } else {
      // manual / keyword / future source — count toward the verdict mix
      // but don't attribute to AI or phrase totals.
      bucket.verdicts[row.responseType]++;
    }
  }

  // Round spend at the day boundary so the dashboard JSON stays compact.
  for (const bucket of byDay.values()) {
    bucket.spendUsd = Math.round(bucket.spendUsd * 1e8) / 1e8;
  }

  const daily = days.map((d) => byDay.get(d)!);

  const totals: ClassifierStatsTotals = {
    rows: 0,
    aiCalls: 0,
    spendUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
  };
  for (const d of daily) {
    totals.rows += d.totalRows;
    totals.aiCalls += d.aiCallCount;
    totals.spendUsd += d.spendUsd;
    totals.inputTokens += d.inputTokens;
    totals.outputTokens += d.outputTokens;
  }
  totals.spendUsd = Math.round(totals.spendUsd * 1e8) / 1e8;

  const alerts = detectSpikes(daily, input.spikeOptions ?? {});

  return { windowDays, daily, totals, alerts };
}

/**
 * Spike detector: compare the most recent day's "other" and "abstain"
 * rates (within ai-attempted rows) against the trailing baseline.
 *
 * "Most recent" intentionally means yesterday — today is partial and
 * would otherwise produce false alarms in the early hours. The baseline
 * is the previous 7 complete days before that.
 *
 * Exported for unit testing.
 */
export function detectSpikes(
  daily: DailyClassifierStats[],
  opts: {
    minRecentSample?: number;
    spikeMultiplier?: number;
    minAbsoluteRate?: number;
  },
): ClassifierAlert[] {
  const minRecentSample = opts.minRecentSample ?? 5;
  const spikeMultiplier = opts.spikeMultiplier ?? 2;
  const minAbsoluteRate = opts.minAbsoluteRate ?? 0.25;

  // Need at least one "complete" day + a baseline. With <2 days of data
  // we can't say anything useful, so stay silent.
  if (daily.length < 2) return [];

  // The last entry in `daily` is "today" (partial); use the day before
  // as the recent-complete day.
  const recent = daily[daily.length - 2];
  const baselineDays = daily.slice(0, daily.length - 2).slice(-7);
  if (baselineDays.length === 0) return [];

  const baselineAttempts = baselineDays.reduce((s, d) => s + d.aiAttemptCount, 0);
  const baselineOther = baselineDays.reduce((s, d) => s + d.verdicts.other, 0);
  const baselineAbstain = baselineDays.reduce((s, d) => s + d.abstainCount, 0);

  const alerts: ClassifierAlert[] = [];

  if (recent.aiAttemptCount >= minRecentSample) {
    const recentOtherRate = recent.verdicts.other / recent.aiAttemptCount;
    const baselineOtherRate = baselineAttempts > 0
      ? baselineOther / baselineAttempts
      : 0;
    if (
      recentOtherRate >= minAbsoluteRate &&
      recentOtherRate >= baselineOtherRate * spikeMultiplier
    ) {
      alerts.push({
        kind: "spike_other",
        message: `'other' verdicts are ${pct(recentOtherRate)} of AI calls on ${recent.day} (baseline ${pct(baselineOtherRate)}). The model may be misreading a new template — spot-check the recent rows.`,
        recentRate: recentOtherRate,
        baselineRate: baselineOtherRate,
        recentSample: recent.aiAttemptCount,
      });
    }

    const recentAbstainRate = recent.abstainCount / recent.aiAttemptCount;
    const baselineAbstainRate = baselineAttempts > 0
      ? baselineAbstain / baselineAttempts
      : 0;
    if (
      recentAbstainRate >= minAbsoluteRate &&
      recentAbstainRate >= baselineAbstainRate * spikeMultiplier
    ) {
      alerts.push({
        kind: "spike_abstain",
        message: `Abstain rate is ${pct(recentAbstainRate)} on ${recent.day} (baseline ${pct(baselineAbstainRate)}). The Anthropic call may be failing — check the connector + recent logs.`,
        recentRate: recentAbstainRate,
        baselineRate: baselineAbstainRate,
        recentSample: recent.aiAttemptCount,
      });
    }
  }

  return alerts;
}

function pct(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}
