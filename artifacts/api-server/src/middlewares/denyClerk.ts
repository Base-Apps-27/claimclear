// Mounts on bulk-action and setup endpoints that admins + users are
// allowed to use but clerks are not. See `lib/role.ts` for the role
// model. Returns 403 (not 404) so the client can detect "you don't
// have permission for this" cleanly and render a Not Available state.
//
// Pairs with the existing `requireAuth` (mounted globally upstream),
// so by the time we run here we already know the user is authenticated
// and approved — we only need to check the role.
import { type Request, type Response, type NextFunction } from "express";
import { isClerk } from "../lib/role";

export function denyClerk(req: Request, res: Response, next: NextFunction) {
  if (isClerk(req.user)) {
    res.status(403).json({ error: "Not available for your role" });
    return;
  }
  next();
}
