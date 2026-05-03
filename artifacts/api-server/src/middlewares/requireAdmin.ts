import { type Request, type Response, type NextFunction } from "express";

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.isAuthenticated() || req.user?.role !== "admin") {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  if (req.user?.status !== "approved") {
    res.status(403).json({ error: "Access pending approval", status: req.user?.status ?? "pending" });
    return;
  }
  next();
}
