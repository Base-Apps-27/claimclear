import * as client from "openid-client";
import crypto from "crypto";
import { type Request, type Response } from "express";
import { db, sessionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { AuthUser } from "@workspace/api-zod";

export const ISSUER_URL = process.env.ISSUER_URL ?? "https://replit.com/oidc";
export const SESSION_COOKIE = "sid";

export const SESSION_ABSOLUTE_TTL = 8 * 60 * 60 * 1000;
export const SESSION_IDLE_TIMEOUT = 30 * 60 * 1000;

export interface SessionData {
  user: AuthUser;
  access_token: string;
  refresh_token?: string;
  expires_at?: number;
  createdAt: number;
  lastActivity: number;
}

let oidcConfig: client.Configuration | null = null;
let oidcConfigPromise: Promise<client.Configuration> | null = null;

export async function getOidcConfig(): Promise<client.Configuration> {
  if (oidcConfig) return oidcConfig;
  if (oidcConfigPromise) return oidcConfigPromise;
  oidcConfigPromise = client.discovery(
    new URL(ISSUER_URL),
    process.env.REPL_ID!,
  ).then(config => {
    oidcConfig = config;
    oidcConfigPromise = null;
    return config;
  }).catch(err => {
    oidcConfigPromise = null;
    throw err;
  });
  return oidcConfigPromise;
}

export async function createSession(data: SessionData): Promise<string> {
  const sid = crypto.randomBytes(32).toString("hex");
  const now = Date.now();
  data.createdAt = now;
  data.lastActivity = now;
  await db.insert(sessionsTable).values({
    sid,
    sess: data as unknown as Record<string, unknown>,
    expire: new Date(now + SESSION_ABSOLUTE_TTL),
  });
  return sid;
}

export type SessionExpiry = "expired_absolute" | "expired_idle" | null;

export interface SessionResult {
  data: SessionData | null;
  expiry: SessionExpiry;
}

export async function getSession(sid: string): Promise<SessionResult> {
  const [row] = await db
    .select()
    .from(sessionsTable)
    .where(eq(sessionsTable.sid, sid));

  if (!row || row.expire < new Date()) {
    if (row) await deleteSession(sid);
    return { data: null, expiry: "expired_absolute" };
  }

  const session = row.sess as unknown as SessionData;
  const now = Date.now();

  if (session.createdAt && now - session.createdAt > SESSION_ABSOLUTE_TTL) {
    await deleteSession(sid);
    return { data: null, expiry: "expired_absolute" };
  }

  if (session.lastActivity && now - session.lastActivity > SESSION_IDLE_TIMEOUT) {
    await deleteSession(sid);
    return { data: null, expiry: "expired_idle" };
  }

  return { data: session, expiry: null };
}

export async function touchSession(sid: string, session: SessionData): Promise<void> {
  session.lastActivity = Date.now();
  await db
    .update(sessionsTable)
    .set({
      sess: session as unknown as Record<string, unknown>,
    })
    .where(eq(sessionsTable.sid, sid));
}

export async function updateSession(
  sid: string,
  data: SessionData,
): Promise<void> {
  data.lastActivity = Date.now();
  await db
    .update(sessionsTable)
    .set({
      sess: data as unknown as Record<string, unknown>,
    })
    .where(eq(sessionsTable.sid, sid));
}

export async function deleteSession(sid: string): Promise<void> {
  await db.delete(sessionsTable).where(eq(sessionsTable.sid, sid));
}

export async function clearSession(
  res: Response,
  sid?: string,
): Promise<void> {
  if (sid) await deleteSession(sid);
  res.clearCookie(SESSION_COOKIE, { path: "/" });
}

export function getSessionId(req: Request): string | undefined {
  const authHeader = req.headers["authorization"];
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }
  return req.cookies?.[SESSION_COOKIE];
}
