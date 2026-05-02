import Anthropic from "@anthropic-ai/sdk";

let _anthropic: Anthropic | null = null;

export function getAnthropicClient(): Anthropic {
  if (_anthropic) return _anthropic;

  if (!process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL) {
    throw new Error(
      "AI_INTEGRATIONS_ANTHROPIC_BASE_URL must be set. Did you forget to provision the Anthropic AI integration?",
    );
  }

  if (!process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY) {
    throw new Error(
      "AI_INTEGRATIONS_ANTHROPIC_API_KEY must be set. Did you forget to provision the Anthropic AI integration?",
    );
  }

  _anthropic = new Anthropic({
    apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
    baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
  });

  return _anthropic;
}

/**
 * Test-only seam: lets integration tests inject a fake `Anthropic`-shaped
 * client so route-level handlers can be exercised without a real SDK or
 * AI integration credentials. Pass `null` to reset back to lazy
 * construction. Production code MUST NOT call this.
 */
export function __setAnthropicClientForTesting(client: Anthropic | null): void {
  _anthropic = client;
}

export const anthropic = new Proxy({} as Anthropic, {
  get(_target, prop) {
    return (getAnthropicClient() as unknown as Record<string | symbol, unknown>)[prop];
  },
});
