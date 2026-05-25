import { type Request, type Response, type NextFunction } from "express";

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  if (req.user?.status !== "approved") {
    const status = req.user?.status ?? "pending";
    const error = status === "paused"
      ? "Your account was paused due to inactivity — contact an admin"
      : "Access pending approval";
    res.status(403).json({ error, status });
    return;
  }
  next();
}
