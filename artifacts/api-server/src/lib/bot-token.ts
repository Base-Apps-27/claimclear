import crypto from "crypto";

let lastBotAuthAt: Date | null = null;

export function getValidTokens(): string[] {
  const tokens: string[] = [];
  const current = process.env.BOT_SERVICE_TOKEN;
  const previous = process.env.BOT_SERVICE_TOKEN_PREVIOUS;
  if (current && current.length > 0) tokens.push(current);
  if (previous && previous.length > 0) tokens.push(previous);
  return tokens;
}

function constantTimeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");
  if (aBuf.length !== bBuf.length) {
    crypto.timingSafeEqual(aBuf, aBuf);
    return false;
  }
  return crypto.timingSafeEqual(aBuf, bBuf);
}

export function verifyBotToken(headerValue: string | string[] | undefined): boolean {
  if (typeof headerValue !== "string" || headerValue.length === 0) return false;
  const valid = getValidTokens();
  if (valid.length === 0) return false;
  let matched = false;
  for (const candidate of valid) {
    if (constantTimeEqual(headerValue, candidate)) {
      matched = true;
    }
  }
  if (matched) {
    lastBotAuthAt = new Date();
  }
  return matched;
}

export function getLastBotAuthAt(): Date | null {
  return lastBotAuthAt;
}

export function getActiveTokenHashPrefix(): string | null {
  const current = process.env.BOT_SERVICE_TOKEN;
  if (!current || current.length === 0) return null;
  const hash = crypto.createHash("sha256").update(current, "utf8").digest("hex");
  return hash.slice(0, 8);
}

export function hasGraceToken(): boolean {
  const previous = process.env.BOT_SERVICE_TOKEN_PREVIOUS;
  return typeof previous === "string" && previous.length > 0;
}
