import { type Request, type Response, type NextFunction } from "express";
import type { AuthUser } from "@workspace/api-zod";
import {
  clearSession,
  getSessionId,
  getSession,
  touchSession,
  type SessionExpiry,
} from "../lib/auth";
import { logger } from "../lib/logger";

declare global {
  namespace Express {
    interface User extends AuthUser {}

    interface Request {
      isAuthenticated(): this is AuthedRequest;

      user?: User | undefined;
      sessionExpiry?: SessionExpiry;
    }

    export interface AuthedRequest {
      user: User;
    }
  }
}

const TOUCH_INTERVAL = 60 * 1000;

let lastTouchMap = new Map<string, number>();

setInterval(() => {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [key, ts] of lastTouchMap) {
    if (ts < cutoff) lastTouchMap.delete(key);
  }
}, 5 * 60 * 1000);

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  req.isAuthenticated = function (this: Request) {
    return this.user != null;
  } as Request["isAuthenticated"];

  const sid = getSessionId(req);
  if (!sid) {
    next();
    return;
  }

  const { data: session, expiry } = await getSession(sid);

  if (!session?.user?.id) {
    if (expiry) {
      logger.info(
        { sid: sid.slice(0, 8) + "...", reason: expiry },
        "Session expired — clearing"
      );
      req.sessionExpiry = expiry;
    }
    await clearSession(res, sid);
    next();
    return;
  }

  const now = Date.now();
  const lastTouch = lastTouchMap.get(sid) ?? 0;
  if (now - lastTouch > TOUCH_INTERVAL) {
    lastTouchMap.set(sid, now);
    touchSession(sid, session).catch(err => {
      logger.error({ err }, "Failed to touch session");
    });
  }

  req.user = session.user;
  next();
}
