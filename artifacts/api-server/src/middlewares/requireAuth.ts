import { type Request, type Response, type NextFunction } from "express";

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  if (req.user?.status !== "approved") {
    res.status(403).json({ error: "Access pending approval", status: req.user?.status ?? "pending" });
    return;
  }
  next();
}
