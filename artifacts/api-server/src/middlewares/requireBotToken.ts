import { type Request, type Response, type NextFunction } from "express";
import { verifyBotToken, getValidTokens } from "../lib/bot-token";

if (getValidTokens().length === 0) {
  console.warn("[AUTH] BOT_SERVICE_TOKEN is not set. Bot endpoints will reject all requests until configured.");
}

export function requireBotToken(req: Request, res: Response, next: NextFunction) {
  if (verifyBotToken(req.headers["x-bot-token"])) {
    next();
    return;
  }

  res.status(401).json({ error: "Bot authentication required" });
}

export function requireAuthOrBot(req: Request, res: Response, next: NextFunction) {
  if (req.isAuthenticated()) {
    if (req.user?.status !== "approved") {
      const status = req.user?.status ?? "pending";
      const error = status === "paused"
        ? "Your account was paused due to inactivity — contact an admin"
        : "Access pending approval";
      res.status(403).json({ error, status });
      return;
    }
    next();
    return;
  }

  if (verifyBotToken(req.headers["x-bot-token"])) {
    next();
    return;
  }

  res.status(401).json({ error: "Authentication required" });
}
