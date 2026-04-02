import * as oidc from "openid-client";
import { Router, type IRouter, type Request, type Response } from "express";
import {
  GetCurrentAuthUserResponse,
} from "@workspace/api-zod";
import { db, usersTable } from "@workspace/db";
import { eq, sql, count } from "drizzle-orm";
import {
  clearSession,
  getOidcConfig,
  getSessionId,
  createSession,
  deleteSession,
  SESSION_COOKIE,
  SESSION_TTL,
  ISSUER_URL,
  type SessionData,
} from "../lib/auth";

const OIDC_COOKIE_TTL = 10 * 60 * 1000;

const router: IRouter = Router();

function getOrigin(req: Request): string {
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host =
    req.headers["x-forwarded-host"] || req.headers["host"] || "localhost";
  return `${proto}://${host}`;
}

function setSessionCookie(res: Response, sid: string) {
  res.cookie(SESSION_COOKIE, sid, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL,
  });
}

function setOidcCookie(res: Response, name: string, value: string) {
  res.cookie(name, value, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: OIDC_COOKIE_TTL,
  });
}

function getSafeReturnTo(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
    return "/";
  }
  return value;
}

async function upsertUser(claims: Record<string, unknown>) {
  const userData = {
    id: claims.sub as string,
    email: (claims.email as string) || null,
    firstName: (claims.first_name as string) || null,
    lastName: (claims.last_name as string) || null,
    profileImageUrl: (claims.profile_image_url || claims.picture) as
      | string
      | null,
  };

  const [existing] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, userData.id));

  if (existing) {
    const [user] = await db
      .update(usersTable)
      .set({ ...userData, updatedAt: new Date() })
      .where(eq(usersTable.id, userData.id))
      .returning();
    return user;
  }

  const [{ value: userCount }] = await db.select({ value: count() }).from(usersTable);
  const isFirstUser = userCount === 0;

  const [user] = await db
    .insert(usersTable)
    .values({
      ...userData,
      role: isFirstUser ? "admin" : "user",
      status: isFirstUser ? "approved" : "pending",
    })
    .returning();
  return user;
}

router.get("/auth/user", (req: Request, res: Response) => {
  if (!req.isAuthenticated() || !req.user) {
    res.json({ user: null });
    return;
  }
  res.json({
    user: {
      id: String(req.user.id),
      email: req.user.email,
      displayName: req.user.displayName ?? null,
      profileImageUrl: req.user.profileImageUrl ?? null,
      role: req.user.role,
      status: req.user.status ?? "pending",
    },
  });
});

router.get("/auth/session", (req: Request, res: Response) => {
  if (!req.isAuthenticated() || !req.user) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  res.json({
    user: {
      id: String(req.user.id),
      email: req.user.email,
      displayName: req.user.displayName ?? null,
      profileImageUrl: req.user.profileImageUrl ?? null,
      role: req.user.role,
      status: req.user.status ?? "pending",
    },
  });
});

router.get("/admin/users", async (req: Request, res: Response) => {
  if (!req.isAuthenticated() || req.user?.role !== "admin") {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  const users = await db.select().from(usersTable).orderBy(usersTable.createdAt);
  res.json(users.map(u => ({
    id: u.id,
    email: u.email,
    firstName: u.firstName,
    lastName: u.lastName,
    profileImageUrl: u.profileImageUrl,
    role: u.role,
    status: u.status,
    createdAt: u.createdAt,
  })));
});

router.patch("/admin/users/:userId/approve", async (req: Request, res: Response) => {
  if (!req.isAuthenticated() || req.user?.role !== "admin") {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  const userId = req.params.userId as string;
  const [user] = await db
    .update(usersTable)
    .set({ status: "approved", updatedAt: new Date() })
    .where(eq(usersTable.id, userId))
    .returning();
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json({ message: "User approved", user: { id: user.id, email: user.email, status: user.status } });
});

router.patch("/admin/users/:userId/deny", async (req: Request, res: Response) => {
  if (!req.isAuthenticated() || req.user?.role !== "admin") {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  const userId = req.params.userId as string;
  const [user] = await db
    .update(usersTable)
    .set({ status: "denied", updatedAt: new Date() })
    .where(eq(usersTable.id, userId))
    .returning();
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json({ message: "User denied", user: { id: user.id, email: user.email, status: user.status } });
});

router.patch("/admin/users/:userId/role", async (req: Request, res: Response) => {
  if (!req.isAuthenticated() || req.user?.role !== "admin") {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  const userId = req.params.userId as string;
  const { role } = req.body;
  if (!role || !["admin", "user"].includes(role)) {
    res.status(400).json({ error: "Invalid role. Must be 'admin' or 'user'" });
    return;
  }
  const [user] = await db
    .update(usersTable)
    .set({ role, updatedAt: new Date() })
    .where(eq(usersTable.id, userId))
    .returning();
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json({ message: "Role updated", user: { id: user.id, email: user.email, role: user.role } });
});

router.get("/login", async (req: Request, res: Response) => {
  const config = await getOidcConfig();
  const callbackUrl = `${getOrigin(req)}/api/callback`;

  const returnTo = getSafeReturnTo(req.query.returnTo);

  const state = oidc.randomState();
  const nonce = oidc.randomNonce();
  const codeVerifier = oidc.randomPKCECodeVerifier();
  const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);

  const redirectTo = oidc.buildAuthorizationUrl(config, {
    redirect_uri: callbackUrl,
    scope: "openid email profile offline_access",
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    prompt: "login consent",
    state,
    nonce,
  });

  setOidcCookie(res, "code_verifier", codeVerifier);
  setOidcCookie(res, "nonce", nonce);
  setOidcCookie(res, "state", state);
  setOidcCookie(res, "return_to", returnTo);

  res.redirect(redirectTo.href);
});

// Query params are not validated because the OIDC provider may include
// parameters not expressed in the schema.
router.get("/callback", async (req: Request, res: Response) => {
  const config = await getOidcConfig();
  const callbackUrl = `${getOrigin(req)}/api/callback`;

  const codeVerifier = req.cookies?.code_verifier;
  const nonce = req.cookies?.nonce;
  const expectedState = req.cookies?.state;

  if (!codeVerifier || !expectedState) {
    res.redirect("/api/login");
    return;
  }

  const currentUrl = new URL(
    `${callbackUrl}?${new URL(req.url, `http://${req.headers.host}`).searchParams}`,
  );

  let tokens: oidc.TokenEndpointResponse & oidc.TokenEndpointResponseHelpers;
  try {
    tokens = await oidc.authorizationCodeGrant(config, currentUrl, {
      pkceCodeVerifier: codeVerifier,
      expectedNonce: nonce,
      expectedState,
      idTokenExpected: true,
    });
  } catch {
    res.redirect("/api/login");
    return;
  }

  const returnTo = getSafeReturnTo(req.cookies?.return_to);

  res.clearCookie("code_verifier", { path: "/" });
  res.clearCookie("nonce", { path: "/" });
  res.clearCookie("state", { path: "/" });
  res.clearCookie("return_to", { path: "/" });

  const claims = tokens.claims();
  if (!claims) {
    res.redirect("/api/login");
    return;
  }

  const dbUser = await upsertUser(
    claims as unknown as Record<string, unknown>,
  );

  const now = Math.floor(Date.now() / 1000);
  const displayName = [dbUser.firstName, dbUser.lastName]
    .filter(Boolean)
    .join(" ") || null;
  const sessionData: SessionData = {
    user: {
      id: dbUser.id,
      email: dbUser.email ?? "",
      displayName,
      profileImageUrl: dbUser.profileImageUrl ?? null,
      role: dbUser.role,
      status: dbUser.status,
    },
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: tokens.expiresIn() ? now + tokens.expiresIn()! : claims.exp,
  };

  const sid = await createSession(sessionData);
  setSessionCookie(res, sid);
  res.redirect(returnTo);
});

router.get("/logout", async (req: Request, res: Response) => {
  const config = await getOidcConfig();
  const origin = getOrigin(req);

  const sid = getSessionId(req);
  await clearSession(res, sid);

  const endSessionUrl = oidc.buildEndSessionUrl(config, {
    client_id: process.env.REPL_ID!,
    post_logout_redirect_uri: origin,
  });

  res.redirect(endSessionUrl.href);
});

export default router;
