// Task #889 — server-side enforcement for portal-only users.
//
// `users.is_portal_only = true` users (responsible-party supervisors who
// should NOT see operator views) are restricted to a tiny allowlist of
// API paths so that a frontend nav-only restriction can never be
// bypassed by hitting an operator endpoint directly via URL/curl.
//
// Admins (`role === "admin"`) and clerks (`role === "clerk"`) are
// never portal-isolated, regardless of the flag, so an operator who
// is also assigned a responsible role keeps full access.
//
// The allowlist is intentionally tiny:
//   - /my-closures*           (the portal itself)
//   - /auth/*                 (login/session/logout)
//   - /health*                (uptime checks)
//   - /tour*                  (first-login tour state for the portal)
// Everything else returns 403 with a stable error code so the client
// can render a clear message and link the user back to /my-closures.
import { type Request, type Response, type NextFunction } from "express";

const PORTAL_ALLOWED_PREFIXES = [
  "/my-closures",
  "/auth/",
  "/health",
  "/tour",
];

function isAllowedForPortal(pathname: string): boolean {
  // Exact /auth and /health (no trailing) should also pass.
  if (pathname === "/auth" || pathname === "/health") return true;
  return PORTAL_ALLOWED_PREFIXES.some(p => pathname === p || pathname.startsWith(p));
}

export function portalOnlyGuard(req: Request, res: Response, next: NextFunction) {
  const user = req.user;
  if (!user) return next();
  // Admin / clerk are never portal-isolated — the explicit boolean
  // only constrains the lower "user" role.
  if (user.role === "admin" || user.role === "clerk") return next();
  if (!user.isPortalOnly) return next();
  if (isAllowedForPortal(req.path)) return next();
  res.status(403).json({
    error: "Portal-only account — this view isn't available to you.",
    code: "PORTAL_ONLY_RESTRICTED",
  });
}
