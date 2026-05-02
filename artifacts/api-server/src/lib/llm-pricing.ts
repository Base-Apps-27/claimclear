/**
 * Per-model token pricing for the LLM-classifier monitoring (Task #320).
 *
 * Rates are USD per 1M tokens, sourced from Anthropic's public pricing page
 * for the models exposed via the Replit AI Integrations proxy. They are
 * intentionally hard-coded here (rather than fetched at runtime) because
 * the classifier-stats dashboard just needs an order-of-magnitude estimate
 * of "are we burning money?" — not a billable invoice. Refresh this table
 * if Anthropic changes its sticker prices.
 *
 * Cache-read / cache-write tiers are NOT modelled because the classifier
 * makes a single, unique-per-email request that does not use prompt
 * caching.
 */
export interface ModelPricing {
  /** USD per 1,000,000 input tokens. */
  inputPerMtokUsd: number;
  /** USD per 1,000,000 output tokens. */
  outputPerMtokUsd: number;
}

export const MODEL_PRICING: Readonly<Record<string, ModelPricing>> = {
  // The model the inbound-email classifier currently calls. Cheapest
  // model the AI integrations proxy exposes.
  "claude-haiku-4-5": { inputPerMtokUsd: 1, outputPerMtokUsd: 5 },
  // Useful fallbacks so the dashboard still produces a number if a future
  // change routes the classifier through a different model without
  // updating this table.
  "claude-sonnet-4-6": { inputPerMtokUsd: 3, outputPerMtokUsd: 15 },
  "claude-sonnet-4-5": { inputPerMtokUsd: 3, outputPerMtokUsd: 15 },
  "claude-opus-4-7": { inputPerMtokUsd: 15, outputPerMtokUsd: 75 },
  "claude-opus-4-6": { inputPerMtokUsd: 15, outputPerMtokUsd: 75 },
  "claude-opus-4-5": { inputPerMtokUsd: 15, outputPerMtokUsd: 75 },
  "claude-opus-4-1": { inputPerMtokUsd: 15, outputPerMtokUsd: 75 },
};

/**
 * Look up the pricing row for a model. Returns `null` for unknown models
 * so callers can surface "unknown model — cost not estimable" rather than
 * silently treating it as free.
 */
export function getPricing(model: string): ModelPricing | null {
  return MODEL_PRICING[model] ?? null;
}

export interface UsageInput {
  model: string;
  inputTokens: number;
  outputTokens: number;
}

/**
 * Compute the USD cost of a single call. Returns 0 (not null) for
 * unknown models so the caller can sum a daily total without nullable
 * arithmetic; the per-row absence of a pricing row is logged elsewhere.
 *
 * Result is rounded to 8 decimal places to keep JSON responses compact —
 * an individual Haiku call costs well under 1¢ but 5+ digits matter when
 * we sum over weeks.
 */
export function computeCostUsd(usage: UsageInput): number {
  const pricing = getPricing(usage.model);
  if (!pricing) return 0;
  const inputCost = (usage.inputTokens / 1_000_000) * pricing.inputPerMtokUsd;
  const outputCost = (usage.outputTokens / 1_000_000) * pricing.outputPerMtokUsd;
  return Math.round((inputCost + outputCost) * 1e8) / 1e8;
}
