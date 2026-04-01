import { type Request, type Response, type NextFunction } from "express";

const BOT_TOKEN = process.env.BOT_SERVICE_TOKEN;

if (!BOT_TOKEN) {
  console.warn("[AUTH] BOT_SERVICE_TOKEN is not set. Bot endpoints will reject all requests until configured.");
}

function isValidBotToken(headerValue: string | string[] | undefined): boolean {
  if (!BOT_TOKEN) return false;
  return headerValue === BOT_TOKEN;
}

export function requireBotToken(req: Request, res: Response, next: NextFunction) {
  if (isValidBotToken(req.headers["x-bot-token"])) {
    next();
    return;
  }

  res.status(401).json({ error: "Bot authentication required" });
}

export function requireAuthOrBot(req: Request, res: Response, next: NextFunction) {
  if (req.isAuthenticated()) {
    next();
    return;
  }

  if (isValidBotToken(req.headers["x-bot-token"])) {
    next();
    return;
  }

  res.status(401).json({ error: "Authentication required" });
}
