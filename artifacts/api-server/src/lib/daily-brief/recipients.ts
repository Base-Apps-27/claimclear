// Audience resolution for the daily ops brief and the weekly exec digest.
//
// Three explicit audiences live here so that the route layer never reaches
// into `users` / `notification_preferences` directly. Each audience supports
// an env-var override for one-off resends and ops smoke-tests; when the env
// is set, the database lookup is skipped entirely so the operator gets a
// predictable list:
//
//   • DAILY_BRIEF_ADMIN_RECIPIENTS     overrides getDailyAdminRecipients
//   • DAILY_BRIEF_OPERATOR_RECIPIENTS  overrides getDailyOperatorRecipients
//   • WEEKLY_DIGEST_RECIPIENTS         overrides getWeeklyExecRecipients
//
// The legacy combined `DAILY_BRIEF_RECIPIENTS` env var is kept as an
// admin-list alias so existing ops runbooks keep working — it routes
// through the admin override.
//
// DB lookups are LEFT JOIN against notification_preferences with the
// "preference missing → default true" semantic the prior implementation
// used, so users created before the preferences row backfill keep
// receiving briefs by default.

import { db } from "@workspace/db";
import { usersTable, notificationPreferencesTable } from "@workspace/db";
import { and, eq, isNotNull } from "drizzle-orm";

export interface DailyBriefRecipient {
  userId: string;
  email: string;
  role: string;
}

export interface WeeklyExecRecipient {
  userId: string;
  email: string;
}

function parseEnvList(raw: string | undefined): string[] {
  if (!raw) return [];
  return String(raw)
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function envToAdminRows(emails: string[]): DailyBriefRecipient[] {
  return emails.map((email) => ({ userId: `env:${email}`, email, role: "admin" }));
}

function envToOperatorRows(emails: string[]): DailyBriefRecipient[] {
  return emails.map((email) => ({ userId: `env:${email}`, email, role: "operator" }));
}

function envToWeeklyRows(emails: string[]): WeeklyExecRecipient[] {
  return emails.map((email) => ({ userId: `env:${email}`, email }));
}

// Admin daily-brief recipients. Env override:
//   DAILY_BRIEF_ADMIN_RECIPIENTS (preferred)
//   DAILY_BRIEF_RECIPIENTS       (legacy alias — admin-only)
export async function getDailyAdminRecipients(): Promise<DailyBriefRecipient[]> {
  const envList = parseEnvList(
    process.env.DAILY_BRIEF_ADMIN_RECIPIENTS ?? process.env.DAILY_BRIEF_RECIPIENTS,
  );
  if (envList.length > 0) return envToAdminRows(envList);

  const rows = await db
    .select({
      userId: usersTable.id,
      email: usersTable.email,
      role: usersTable.role,
      dailyBrief: notificationPreferencesTable.dailyBrief,
    })
    .from(usersTable)
    .leftJoin(
      notificationPreferencesTable,
      eq(notificationPreferencesTable.userId, usersTable.id),
    )
    .where(and(eq(usersTable.status, "approved"), isNotNull(usersTable.email)));

  return rows
    .filter((r) => r.email && r.role === "admin" && (r.dailyBrief ?? true) === true)
    .map((r) => ({ userId: r.userId, email: r.email as string, role: r.role }));
}

// Operator daily-brief recipients. Env override:
//   DAILY_BRIEF_OPERATOR_RECIPIENTS
export async function getDailyOperatorRecipients(): Promise<DailyBriefRecipient[]> {
  const envList = parseEnvList(process.env.DAILY_BRIEF_OPERATOR_RECIPIENTS);
  if (envList.length > 0) return envToOperatorRows(envList);

  const rows = await db
    .select({
      userId: usersTable.id,
      email: usersTable.email,
      role: usersTable.role,
      dailyBrief: notificationPreferencesTable.dailyBrief,
    })
    .from(usersTable)
    .leftJoin(
      notificationPreferencesTable,
      eq(notificationPreferencesTable.userId, usersTable.id),
    )
    .where(and(eq(usersTable.status, "approved"), isNotNull(usersTable.email)));

  return rows
    .filter((r) => r.email && r.role !== "admin" && (r.dailyBrief ?? true) === true)
    .map((r) => ({ userId: r.userId, email: r.email as string, role: r.role }));
}

// Weekly executive digest recipients (admins only). Env override:
//   WEEKLY_DIGEST_RECIPIENTS
export async function getWeeklyExecRecipients(): Promise<WeeklyExecRecipient[]> {
  const envList = parseEnvList(process.env.WEEKLY_DIGEST_RECIPIENTS);
  if (envList.length > 0) return envToWeeklyRows(envList);

  const rows = await db
    .select({
      userId: usersTable.id,
      email: usersTable.email,
      role: usersTable.role,
      weeklyDigest: notificationPreferencesTable.weeklyDigest,
    })
    .from(usersTable)
    .leftJoin(
      notificationPreferencesTable,
      eq(notificationPreferencesTable.userId, usersTable.id),
    )
    .where(and(eq(usersTable.status, "approved"), isNotNull(usersTable.email)));

  return rows
    .filter((r) => r.email && r.role === "admin" && (r.weeklyDigest ?? true) === true)
    .map((r) => ({ userId: r.userId, email: r.email as string }));
}

// Backwards-compat shim: the daily-brief route used to call a single
// `getDailyBriefRecipients()`. The route now resolves admin and operator
// lists separately, but exporting the union keeps any external caller
// (e.g. ad-hoc scripts) working.
export async function getDailyBriefRecipients(): Promise<DailyBriefRecipient[]> {
  const [admins, operators] = await Promise.all([
    getDailyAdminRecipients(),
    getDailyOperatorRecipients(),
  ]);
  return [...admins, ...operators];
}
