// Daily ops brief + weekly executive digest routes.
//
// Both routes:
//   • Always return HTTP 200 with a structured outcome
//     ("ok" | "degraded" | "failed") so the cron handler in index.ts
//     can record a clean status row instead of a transport-level error.
//   • Stamp a per-run `briefRunId` into outbound_emails.metadata so the
//     System Health detail panel and `recheckPreviousRunBounces` can
//     join recipients back to a specific cron_runs row.
//   • Persist one outbound_emails row per attempted recipient (success
//     OR failure) via `recordDailyBriefAttempt` / `persistDailyBriefRow`.
//
// Read paths:
//   • Daily ops brief — /dashboard/summary (canonical 7d block) and
//     /dashboard/insights only when the body needs cross-cuts the
//     summary doesn't cover. The renderer never re-runs SQL.
//   • Weekly exec digest — /dashboard/insights?days=7 plus
//     /dashboard/summary for the headline scorecard.
//
// Bounce recheck:
//   • `recheckPreviousRunBounces(jobName?)` is parameterized so the
//     same downgrade rule covers both "daily_brief" and "weekly_digest"
//     cron_runs rows (Task #721). The default arg keeps the legacy
//     no-arg call sites in index.ts and the test suite working.

import { Router, type IRouter } from "express";
import { asyncHandler } from "../lib/asyncHandler";
import { logger } from "../lib/logger";
import { db } from "@workspace/db";
import {
  cronRunsTable,
  outboundEmailsTable,
  emailBouncesTable,
} from "@workspace/db";
import { eq, and, gte, lte, desc, sql } from "drizzle-orm";
import { isOutlookConnected } from "../lib/outlook";
import { getConnectorHealth } from "../lib/connector-health";
import {
  computeBriefOutcome,
  evaluateBounceDowngrade,
  BOUNCE_RECHECK_WINDOW_MS,
  type BriefRecipientResult,
} from "../lib/daily-brief-outcome";
import {
  recordDailyBriefAttempt,
  persistDailyBriefRow,
} from "../lib/email-send";
import {
  getYesterdayActivity,
  getNeedsYouToday,
} from "../lib/brief-personalization";
import {
  getDailyAdminRecipients,
  getDailyOperatorRecipients,
  getWeeklyExecRecipients,
  type DailyBriefRecipient,
} from "../lib/daily-brief/recipients";
import {
  safeFetchCanonicalSummary,
  safeFetchCanonicalInsights,
  safeFetchCanonicalReviewCount,
} from "../lib/daily-brief/data";
import { safeGatherPortalAttention } from "../lib/daily-brief/portal-attention";
import { briefShell } from "../lib/daily-brief/shell";
import {
  renderAdminDailyBody,
  renderOperatorDailyBody,
} from "../lib/daily-brief/daily-body";
import { renderWeeklyExecBody } from "../lib/daily-brief/weekly-body";

const router: IRouter = Router();

interface DegradationNote {
  source: string;
  message: string;
}

// Job name for cron_runs lookups. Both briefs persist to the same
// `outbound_emails.kind = 'daily_brief'` rows (the role-variant in
// metadata distinguishes them); but cron_runs has separate
// `daily_brief` / `weekly_digest` job names so the System Health
// rollup can show their success rates independently.
type BriefJobName = "daily_brief" | "weekly_digest";

// Retro-downgrade the prior cron_runs row for `jobName` from
// `completed` → `failed` if the bounce-spike thresholds are tripped.
//
// Vocabulary note (Cron Option B / migration 0039): cron_runs.status
// persists `running|completed|failed`; the downgrade pathway writes
// `failed`. The `evaluateBounceDowngrade` pure helper still speaks
// the legacy semantic `ok`/`degraded` so callers stay readable; we
// translate at the cron_runs row boundary.
//
// Task #721: `jobName` parameter added so the same recheck logic
// powers the weekly_digest_bounce_recheck cron without duplicating
// the SQL. Default preserves the legacy no-arg signature used by
// the daily-brief cron handler and the existing test suite.
export async function recheckPreviousRunBounces(
  jobName: BriefJobName = "daily_brief",
): Promise<{ runId: number; downgrade: "ok" | "degraded" } | null> {
  try {
    const [prevRun] = await db
      .select({
        id: cronRunsTable.id,
        startedAt: cronRunsTable.startedAt,
        status: cronRunsTable.status,
        message: cronRunsTable.message,
        metadata: cronRunsTable.metadata,
      })
      .from(cronRunsTable)
      .where(eq(cronRunsTable.jobName, jobName))
      .orderBy(desc(cronRunsTable.startedAt))
      .limit(1);
    if (!prevRun) return null;
    if (prevRun.status !== "completed") return null;

    const ageMs = Date.now() - prevRun.startedAt.getTime();
    if (ageMs > 7 * 24 * 60 * 60 * 1000) return null;
    if (ageMs < BOUNCE_RECHECK_WINDOW_MS) return null;

    const briefRunId = (prevRun.metadata as Record<string, unknown> | null)?.briefRunId as
      | string
      | undefined;

    // PRIMARY: lookup attempted recipients by briefRunId (jsonb @>).
    // FALLBACK: time window for legacy rows that predate the briefRunId
    // stamp.
    const recipientRows = briefRunId
      ? await db
          .select({
            recipients: outboundEmailsTable.recipients,
            subject: outboundEmailsTable.subject,
          })
          .from(outboundEmailsTable)
          .where(
            and(
              eq(outboundEmailsTable.kind, "daily_brief"),
              sql`${outboundEmailsTable.metadata} @> ${JSON.stringify({ briefRunId })}::jsonb`,
            ),
          )
      : await db
          .select({
            recipients: outboundEmailsTable.recipients,
            subject: outboundEmailsTable.subject,
          })
          .from(outboundEmailsTable)
          .where(
            and(
              eq(outboundEmailsTable.kind, "daily_brief"),
              gte(outboundEmailsTable.sentAt, prevRun.startedAt),
              lte(
                outboundEmailsTable.sentAt,
                new Date(prevRun.startedAt.getTime() + BOUNCE_RECHECK_WINDOW_MS),
              ),
            ),
          );

    const attemptedEmails = new Set<string>();
    let attemptedSubject: string | null = null;
    for (const r of recipientRows) {
      attemptedSubject = attemptedSubject ?? (r.subject ?? null);
      const list = (Array.isArray(r.recipients) ? r.recipients : []) as unknown[];
      for (const e of list) {
        if (typeof e === "string" && e.length > 0) attemptedEmails.add(e.toLowerCase());
      }
    }
    if (attemptedEmails.size === 0) return null;

    const bounceWindowEnd = new Date(prevRun.startedAt.getTime() + 60 * 60 * 1000);
    const bounceRows = await db
      .select({
        recipientEmail: emailBouncesTable.recipientEmail,
        subject: emailBouncesTable.subject,
      })
      .from(emailBouncesTable)
      .where(
        and(
          gte(emailBouncesTable.receivedAt, prevRun.startedAt),
          lte(emailBouncesTable.receivedAt, bounceWindowEnd),
        ),
      );

    let bounceCount = 0;
    for (const b of bounceRows) {
      const email = (b.recipientEmail ?? "").toLowerCase();
      if (!email) continue;
      const subjectMatches = attemptedSubject
        ? (b.subject ?? "").includes(attemptedSubject.split(" - ")[0] ?? "")
        : true;
      if (attemptedEmails.has(email) && subjectMatches) bounceCount += 1;
    }

    const downgrade = evaluateBounceDowngrade({
      recipientCount: attemptedEmails.size,
      bounceCount,
    });
    if (downgrade === "degraded") {
      const note = `Bounce spike: ${bounceCount} of ${attemptedEmails.size} recipients bounced within ${Math.round(BOUNCE_RECHECK_WINDOW_MS / 60000)}m of send`;
      await db
        .update(cronRunsTable)
        .set({
          status: "failed",
          message: prevRun.message ? `${prevRun.message} | ${note}` : note,
        })
        .where(eq(cronRunsTable.id, prevRun.id));
      logger.warn(
        { runId: prevRun.id, jobName, briefRunId, bounceCount, recipientCount: attemptedEmails.size },
        "[BRIEF] retroactively downgraded prior run for bounce spike",
      );
    }
    return { runId: prevRun.id, downgrade };
  } catch (err) {
    logger.error({ err, jobName }, "[BRIEF] bounce recheck failed (non-fatal)");
    return null;
  }
}

// Connectivity (`connected`) and health-row status (`healthy`) are
// reported separately on purpose:
//   • `connected` — actual Outlook connector reachability via
//     isOutlookConnected(). This is the ONLY signal used to gate
//     dispatch. A degraded health row must NOT suppress sends; it
//     just paints a warning banner.
//   • `healthy` / `error` — the latest connector_health row. Drives
//     the banner at the top of every brief and is included in the
//     route's degradation notes, but is intentionally decoupled from
//     send eligibility.
async function outlookHealth(): Promise<{
  connected: boolean;
  healthy: boolean;
  error: string | null;
}> {
  const connected = await isOutlookConnected();
  const row = await getConnectorHealth("outlook");
  if (row) {
    return {
      connected,
      healthy: row.status === "healthy",
      error: row.lastError ?? null,
    };
  }
  return {
    connected,
    healthy: connected,
    error: connected ? null : "Outlook connector unavailable",
  };
}

function dateLabel(now: Date): string {
  return now.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

// ─── POST /api/daily-brief ───────────────────────────────────────────
//
// Daily ops brief. One email per approved opted-in user; admins get
// the KPI body, operators get the worklist body. An optional
// `recipients` body field (or DAILY_BRIEF_RECIPIENTS env var) sends a
// single shared admin-style brief to an explicit list — used by ops
// for one-off resends.

router.post(
  "/",
  asyncHandler(async (req, res): Promise<void> => {
    const briefRunId = `brief-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const degradationNotes: DegradationNote[] = [];

    try {
      // Opportunistic recheck of the previous run's bounces. Updates the
      // prior cron_runs row out-of-band; never blocks the new send.
      await recheckPreviousRunBounces("daily_brief");

      const recipientsOverride =
        typeof req.body?.recipients === "string" ? req.body.recipients : undefined;

      const now = new Date();
      const todayStart = new Date(now);
      todayStart.setHours(0, 0, 0, 0);
      const yesterdayStart = new Date(todayStart);
      yesterdayStart.setDate(yesterdayStart.getDate() - 1);

      const [summary, yesterday, attention, reviewCount] = await Promise.all([
        safeFetchCanonicalSummary(degradationNotes),
        getYesterdayActivity(yesterdayStart, todayStart).catch((err) => {
          const msg = err instanceof Error ? err.message : String(err);
          degradationNotes.push({ source: "yesterday_activity", message: msg.slice(0, 240) });
          return { claimsCreated: 0, draftsSubmitted: 0, responsesReceived: 0, decisionsLogged: 0 };
        }),
        safeGatherPortalAttention(degradationNotes),
        safeFetchCanonicalReviewCount(degradationNotes),
      ]);

      const { connected: outlookAvailable, healthy: outlookHealthy, error: outlookError } =
        await outlookHealth();

      const subject = summary
        ? `Agape ClaimClear Daily Brief — ${summary.amounts.openInvoices} open, ${summary.urgentCount} due today`
        : `Agape ClaimClear Daily Brief — ${dateLabel(now)}`;

      // ─── Override / shared mode ─────────────────────────────────────
      // Only the request-body `recipients` override triggers shared mode.
      // The DAILY_BRIEF_RECIPIENTS / DAILY_BRIEF_ADMIN_RECIPIENTS env
      // vars now flow through getDailyAdminRecipients() in personalized
      // mode so admin and operator audiences stay split during normal
      // cron operation.
      if (recipientsOverride) {
        const rawRecipients = recipientsOverride;
        const recipientList: string[] = String(rawRecipients)
          .split(/[,;]/)
          .map((s) => s.trim())
          .filter((s) => s.length > 0);

        const html = briefShell({
          title: "Agape ClaimClear Daily Brief",
          dateLabel: dateLabel(now),
          variantLabel: "Daily ops brief",
          bodyHtml: summary
            ? renderAdminDailyBody(summary, yesterday, attention, reviewCount)
            : `<p style="color:#a4262c;">Dashboard summary unavailable — see degradation notes.</p>`,
          outlookHealthy,
          outlookError,
        });

        const overrideResults: BriefRecipientResult[] = [];
        let usedOutlook = false;

        if (outlookAvailable && recipientList.length > 0) {
          for (const email of recipientList) {
            const attempt = await recordDailyBriefAttempt({
              recipientEmail: email,
              subject,
              html,
              roleVariant: "admin",
              briefRunId,
            });
            overrideResults.push({ email, ok: attempt.ok, errorExcerpt: attempt.errorExcerpt });
            if (attempt.ok) usedOutlook = true;
          }
        }

        // SMTP fallback path — same persistence shape so System Health
        // sees override+SMTP rows identically to Outlook rows.
        if (!usedOutlook && process.env.SMTP_HOST && process.env.SMTP_USER && recipientList.length > 0) {
          let smtpOk = false;
          let smtpError: string | null = null;
          let smtpMessageId: string | null = null;
          try {
            const nodemailer = await import("nodemailer");
            const transporter = nodemailer.createTransport({
              host: process.env.SMTP_HOST,
              port: parseInt(process.env.SMTP_PORT || "587", 10),
              secure: process.env.SMTP_SECURE === "true",
              auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
            });
            const info = await transporter.sendMail({
              from: process.env.SMTP_FROM || process.env.SMTP_USER,
              to: recipientList.join(", "),
              subject,
              html,
            });
            smtpOk = true;
            smtpMessageId = typeof info?.messageId === "string" ? info.messageId : null;
          } catch (err) {
            smtpError = (err instanceof Error ? `${err.name}: ${err.message}` : String(err)).slice(0, 200);
            logger.error({ err }, "[DAILY BRIEF] SMTP fallback send failed");
          }

          for (const email of recipientList) {
            await persistDailyBriefRow({
              recipientEmail: email,
              subject,
              html,
              roleVariant: "admin",
              briefRunId,
              messageId: smtpOk ? smtpMessageId : null,
              conversationId: null,
              errorExcerpt: smtpOk ? null : smtpError,
            });
            const idx = overrideResults.findIndex((r) => r.email === email);
            const next = { email, ok: smtpOk, errorExcerpt: smtpOk ? null : smtpError };
            if (idx >= 0) overrideResults[idx] = next;
            else overrideResults.push(next);
          }
        }

        const overrideSummary = computeBriefOutcome({
          recipientCount: recipientList.length,
          results: overrideResults,
        });
        const method = overrideResults.some((r) => r.ok)
          ? usedOutlook
            ? "outlook"
            : "smtp"
          : "none";
        const stats = summary
          ? `${summary.amounts.openInvoices} open · ${summary.urgentCount} due today`
          : "summary unavailable";
        res.json({
          outcome: overrideSummary.outcome,
          sent: overrideSummary.sentCount > 0,
          method,
          message: `${overrideSummary.message}. ${stats}.`,
          sentCount: overrideSummary.sentCount,
          recipientCount: overrideSummary.recipientCount,
          failedCount: overrideSummary.failureCount,
          failures: overrideSummary.failures,
          briefRunId,
          degradationNotes,
        });
        return;
      }

      // ─── Personalized mode ─────────────────────────────────────────
      // Three explicit audiences (each env-overridable):
      //   admin → renderAdminDailyBody (KPI + attention + filing)
      //   operator → renderOperatorDailyBody (per-user worklist)
      let recipients: DailyBriefRecipient[] = [];
      try {
        const [admins, operators] = await Promise.all([
          getDailyAdminRecipients(),
          getDailyOperatorRecipients(),
        ]);
        recipients = [...admins, ...operators];
      } catch (err) {
        logger.error({ err }, "[DAILY BRIEF] recipient lookup failed");
        degradationNotes.push({
          source: "recipient_query",
          message: `${err instanceof Error ? err.message : String(err)}`.slice(0, 240),
        });
      }

      if (!outlookAvailable) {
        const sum = computeBriefOutcome({
          recipientCount: recipients.length,
          results: [],
          topLevelFailure: true,
        });
        res.json({
          outcome: sum.outcome,
          sent: false,
          method: "none",
          message: `Outlook unavailable; skipped ${recipients.length} personalized briefs.`,
          sentCount: 0,
          recipientCount: recipients.length,
          failures: recipients.map((r) => ({ email: r.email, error: "Outlook connector unavailable" })),
          briefRunId,
          degradationNotes,
        });
        return;
      }

      const results: BriefRecipientResult[] = [];
      for (const r of recipients) {
        const isAdmin = r.role === "admin";
        let html: string;
        if (isAdmin) {
          html = briefShell({
            title: "Agape ClaimClear Daily Brief",
            dateLabel: dateLabel(now),
            variantLabel: "Daily ops brief",
            bodyHtml: summary
              ? renderAdminDailyBody(summary, yesterday, attention, reviewCount)
              : `<p style="color:#a4262c;">Dashboard summary unavailable — see degradation notes.</p>`,
            outlookHealthy,
            outlookError,
          });
        } else {
          const needs = await getNeedsYouToday(r.email, now).catch((err) => {
            const msg = err instanceof Error ? err.message : String(err);
            degradationNotes.push({
              source: "operator_needs",
              message: `${r.email}: ${msg.slice(0, 200)}`,
            });
            return { recentlyTouched: [], unsubmittedDrafts: [], needsReview: [] };
          });
          html = briefShell({
            title: "Your ClaimClear Worklist",
            dateLabel: dateLabel(now),
            variantLabel: "Daily ops brief",
            bodyHtml: renderOperatorDailyBody(needs, r.email, summary, yesterday, attention, reviewCount),
            outlookHealthy,
            outlookError,
          });
        }

        const attempt = await recordDailyBriefAttempt({
          recipientEmail: r.email,
          subject,
          html,
          roleVariant: isAdmin ? "admin" : "operator",
          briefRunId,
        });
        results.push({ email: r.email, ok: attempt.ok, errorExcerpt: attempt.errorExcerpt });
        if (!attempt.ok) {
          logger.error(
            { email: r.email, error: attempt.errorExcerpt },
            "[DAILY BRIEF] per-user send failed",
          );
        }
      }

      const sum = computeBriefOutcome({
        recipientCount: recipients.length,
        results,
        topLevelFailure: false,
      });
      const stats = summary
        ? `${summary.amounts.openInvoices} open · ${summary.urgentCount} due today`
        : "summary unavailable";
      res.json({
        outcome: sum.outcome,
        sent: sum.sentCount > 0,
        method: sum.sentCount > 0 ? "outlook" : "none",
        message: `${sum.message}. ${stats}.`,
        sentCount: sum.sentCount,
        recipientCount: sum.recipientCount,
        failedCount: sum.failureCount,
        failures: sum.failures,
        briefRunId,
        degradationNotes,
      });
    } catch (err) {
      const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      logger.error({ err }, "[DAILY BRIEF] route threw at top level");
      res.json({
        outcome: "failed" as const,
        sent: false,
        method: "none",
        message: `Daily brief failed before send: ${msg.slice(0, 240)}`,
        sentCount: 0,
        recipientCount: 0,
        failures: [],
        briefRunId,
        degradationNotes,
      });
    }
  }),
);

// ─── POST /api/daily-brief/weekly ─────────────────────────────────────
//
// Weekly executive digest. Mondays 07:00 ET via the WEEKLY_DIGEST cron.
// Audience: admins with weekly_digest preference enabled. Reads from
// /dashboard/insights?days=7 + /dashboard/summary; persists rows with
// roleVariant="weekly_exec" so System Health and bounce recheck can
// distinguish them from daily brief rows.
//
// Same outcome shape + briefRunId stamp as the daily route, so the
// cron handler in index.ts and `recheckPreviousRunBounces("weekly_digest")`
// can treat both jobs uniformly.

router.post(
  "/weekly",
  asyncHandler(async (req, res): Promise<void> => {
    const briefRunId = `weekly-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const degradationNotes: DegradationNote[] = [];

    try {
      await recheckPreviousRunBounces("weekly_digest");

      const recipientsOverride =
        typeof req.body?.recipients === "string" ? req.body.recipients : undefined;
      const now = new Date();

      const [summary, insights] = await Promise.all([
        safeFetchCanonicalSummary(degradationNotes),
        safeFetchCanonicalInsights(7, degradationNotes),
      ]);

      const { connected: outlookAvailable, healthy: outlookHealthy, error: outlookError } =
        await outlookHealth();

      const recoveredStr = summary?.amounts.recoveredAmount ?? insights?.totalRecoveredAmount ?? "0";
      const recovered = parseFloat(recoveredStr || "0") || 0;
      const subject = `Agape ClaimClear Weekly Digest — $${Math.round(recovered).toLocaleString("en-US")} recovered last 7d`;

      const html = briefShell({
        title: "Agape ClaimClear Weekly Digest",
        dateLabel: dateLabel(now),
        variantLabel: "Weekly executive digest",
        bodyHtml: renderWeeklyExecBody(summary, insights),
        outlookHealthy,
        outlookError,
      });

      let recipients: { email: string }[] = [];
      if (recipientsOverride) {
        recipients = String(recipientsOverride)
          .split(/[,;]/)
          .map((s) => s.trim())
          .filter(Boolean)
          .map((email) => ({ email }));
      } else {
        try {
          recipients = await getWeeklyExecRecipients();
        } catch (err) {
          logger.error({ err }, "[WEEKLY DIGEST] recipient lookup failed");
          degradationNotes.push({
            source: "recipient_query",
            message: `${err instanceof Error ? err.message : String(err)}`.slice(0, 240),
          });
        }
      }

      if (!outlookAvailable) {
        const sum = computeBriefOutcome({
          recipientCount: recipients.length,
          results: [],
          topLevelFailure: true,
        });
        res.json({
          outcome: sum.outcome,
          sent: false,
          method: "none",
          message: `Outlook unavailable; skipped ${recipients.length} weekly digests.`,
          sentCount: 0,
          recipientCount: recipients.length,
          failures: recipients.map((r) => ({ email: r.email, error: "Outlook connector unavailable" })),
          briefRunId,
          degradationNotes,
        });
        return;
      }

      const results: BriefRecipientResult[] = [];
      for (const r of recipients) {
        const attempt = await recordDailyBriefAttempt({
          recipientEmail: r.email,
          subject,
          html,
          roleVariant: "weekly_exec",
          briefRunId,
        });
        results.push({ email: r.email, ok: attempt.ok, errorExcerpt: attempt.errorExcerpt });
        if (!attempt.ok) {
          logger.error({ email: r.email, error: attempt.errorExcerpt }, "[WEEKLY DIGEST] per-user send failed");
        }
      }

      const sum = computeBriefOutcome({
        recipientCount: recipients.length,
        results,
        topLevelFailure: false,
      });
      // computeBriefOutcome uses the literal "Daily brief" prefix in its
      // pre-built message strings. Rewrite it for the weekly route so the
      // operator-facing JSON message reads "Weekly digest: …" cleanly,
      // not "Weekly digest: Daily brief: …".
      const weeklyMessage = sum.message.replace(/Daily brief/g, "Weekly digest");
      res.json({
        outcome: sum.outcome,
        sent: sum.sentCount > 0,
        method: sum.sentCount > 0 ? "outlook" : "none",
        message: `${weeklyMessage}.`,
        sentCount: sum.sentCount,
        recipientCount: sum.recipientCount,
        failedCount: sum.failureCount,
        failures: sum.failures,
        briefRunId,
        degradationNotes,
      });
    } catch (err) {
      const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      logger.error({ err }, "[WEEKLY DIGEST] route threw at top level");
      res.json({
        outcome: "failed" as const,
        sent: false,
        method: "none",
        message: `Weekly digest failed before send: ${msg.slice(0, 240)}`,
        sentCount: 0,
        recipientCount: 0,
        failures: [],
        briefRunId,
        degradationNotes,
      });
    }
  }),
);

export default router;
