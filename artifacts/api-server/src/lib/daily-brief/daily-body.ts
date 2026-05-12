// Daily ops brief body renderers — admin and operator variants.
//
// Both variants share the same head sections so admins and operators
// see the same morning context (the operator just gets a personalised
// action list instead of the admin's filing/tomorrow tables):
//
//   1. KPI strip            (open / at-risk $ / due today / due tmrw / awaiting)
//   2. "Yesterday" row      (claims created / drafts / responses / decisions)
//   3. Attention block      (failed portal subs + auto-reset, last 24h)
//   4. Role-specific section:
//        • admin    → "Needs filing now" + filings due tomorrow detail
//        • operator → "Needs you today" worklist (review / drafts / touched)
//
// Every dollar field is rendered verbatim from the canonical aggregator.
// CRITICAL: the vendor-prepay (× 1.7) multiplier is already baked into
// the aggregator outputs; multiplying again at the renderer would
// double-inflate. Do not reintroduce.

import {
  kpiStrip,
  sectionHeader,
  simpleTable,
  money,
  pct,
  paragraph,
  escapeHtml,
  deltaArrow,
  type KpiTile,
} from "./partials";
import type { CanonicalSummary, CanonicalReviewCount } from "./data";
import type { PortalAttentionBundle } from "./portal-attention";
import type { YesterdayActivity, NeedsYouToday } from "../brief-personalization";

const APP_BASE_URL = (process.env.APP_BASE_URL ?? "").replace(/\/$/, "");

function absUrl(href: string | null | undefined): string {
  if (!href) return APP_BASE_URL || "#";
  if (/^https?:\/\//i.test(href)) return href;
  return `${APP_BASE_URL}${href}`;
}

// Dashboard parity: "Due today" reads the SERVER-provided
// `summary.urgentCount` (computed by routes/dashboard.ts against the
// server clock — see Task #720). "Due tomorrow" filters the canonical
// `expiringGroups` array on `effectiveDaysLeft === 1`, the same
// edge-aware predicate `matchesExpiringFilter("today-tomorrow")` uses
// in the dashboard. We deliberately do NOT recompute these from
// `daysLeft` — that would drift on deadline-edge cases.
function dueTodayCount(summary: CanonicalSummary): number {
  return summary.urgentCount ?? 0;
}

function dueTomorrowGroups(summary: CanonicalSummary) {
  return summary.expiringGroups.filter((g) => g.effectiveDaysLeft === 1);
}

// "Actionable" = deadline today or in the future. Already-expired claims
// are surfaced by the at-risk tile and would just bury what staff can
// still file today.
function actionableExpiring(summary: CanonicalSummary) {
  return summary.expiringGroups
    .filter((g) => g.daysLeft >= 0)
    .sort((a, b) => {
      if (a.isUrgent !== b.isUrgent) return a.isUrgent ? -1 : 1;
      return a.daysLeft - b.daysLeft;
    });
}

// ─── Shared head sections (admin + operator) ───────────────────────────

function renderKpiStrip(
  summary: CanonicalSummary | null,
  reviewCount: CanonicalReviewCount | null,
): string {
  if (!summary) {
    return paragraph("Dashboard summary unavailable — KPIs hidden this morning.");
  }
  const dueToday = dueTodayCount(summary);
  const dueTomorrow = dueTomorrowGroups(summary).length;
  // Canonical "Responses awaiting review" reads from the same endpoint
  // the dashboard hero tile uses (useGetResponsesAwaitingReviewCount).
  // Falls back to "—" when the count fetch failed so we don't silently
  // substitute an unrelated pipeline number.
  const reviewValue = reviewCount ? String(reviewCount.count) : "—";
  const tiles: KpiTile[] = [
    { label: "Open invoices", value: String(summary.amounts.openInvoices) },
    {
      label: "At-risk $",
      value: money(summary.amounts.atRiskExposure),
      hint: `${summary.amounts.atRiskGroups} groups`,
      emphasis: summary.amounts.atRiskGroups > 0 ? "warn" : "default",
    },
    {
      label: "Due today",
      value: String(dueToday),
      emphasis: dueToday > 0 ? "warn" : "default",
    },
    { label: "Due tomorrow", value: String(dueTomorrow) },
    {
      label: "Responses awaiting review",
      value: reviewValue,
      emphasis: reviewCount && reviewCount.count > 0 ? "warn" : "default",
    },
  ];
  return kpiStrip(tiles);
}

function renderYesterdayRow(yesterday: YesterdayActivity): string {
  return `
    ${sectionHeader("Yesterday", "Activity logged across the team")}
    <div style="font-size:13px;color:#444;line-height:1.7;">
      <strong>${yesterday.claimsCreated}</strong> claims created ·
      <strong>${yesterday.draftsSubmitted}</strong> drafts submitted ·
      <strong>${yesterday.responsesReceived}</strong> responses received ·
      <strong>${yesterday.decisionsLogged}</strong> decisions logged
    </div>
  `;
}

function renderAttentionBlock(attention: PortalAttentionBundle): string {
  if (attention.needsAttention.length === 0 && attention.manualRequeues.length === 0) {
    return "";
  }
  const attentionRows = attention.needsAttention.map((r) => {
    const reasonLabel = r.reason === "auto_reset" ? "Auto-reset (was stuck)" : "Failed";
    const nextRetry = r.nextRetryAt
      ? `Next retry: ${new Date(r.nextRetryAt).toLocaleString("en-US", { timeZone: "America/New_York" })}`
      : r.reason === "failed"
      ? "Retries exhausted"
      : "";
    const errSnippet = (r.errorMessage ?? "").slice(0, 140);
    const conf = r.confNumber ?? `#${r.id}`;
    return {
      cells: [
        `<a href="${escapeHtml(absUrl(`/queue/portal-submissions?focus=${r.id}`))}" style="color:#0b62d6;text-decoration:none;font-family:monospace;">${escapeHtml(conf)}</a>`,
        escapeHtml(reasonLabel),
        `${r.attempts}/${r.maxAttempts}`,
        `<span style="color:#92400e;">${escapeHtml(nextRetry)}</span>`,
        `<span style="color:#7c2d12;">${escapeHtml(errSnippet)}</span>`,
      ],
    };
  });
  const requeueIds = attention.manualRequeues.map((r) => `#${r.submissionId}`).join(", ");
  const requeueReason = attention.manualRequeues.find((r) => r.reason)?.reason?.slice(0, 200) ?? null;
  const requeueNote =
    attention.manualRequeues.length > 0
      ? `<p style="margin:0 0 12px;color:#1e3a8a;font-size:12px;background:#dbeafe;border:1px solid #bfdbfe;border-radius:6px;padding:8px 10px;">
          <strong>Auto re-queued in the last 24h:</strong> ${attention.manualRequeues.length} submission${attention.manualRequeues.length === 1 ? "" : "s"} (${escapeHtml(requeueIds)})${requeueReason ? ` — ${escapeHtml(requeueReason)}` : ""}.
        </p>`
      : "";
  return `<div style="margin:24px 0;padding:16px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;">
    <h2 style="font-size:14px;color:#92400e;margin:0 0 6px;text-transform:uppercase;letter-spacing:.05em;">
      Needs your attention (${attention.needsAttention.length})
    </h2>
    <p style="margin:0 0 10px;color:#78350f;font-size:12px;">
      Failed portal submissions and recently auto-reset stuck submissions from the last 24 hours.
    </p>
    ${requeueNote}
    ${attention.needsAttention.length > 0 ? simpleTable(["Conf #", "Reason", "Attempts", "Next retry", "Last error"], attentionRows) : ""}
  </div>`;
}

function renderRecoveryBlock(summary: CanonicalSummary): string {
  const recovered = parseFloat(summary.amounts.recoveredAmount ?? "0") || 0;
  const priorRecovered = parseFloat(summary.amounts.priorRecoveredAmount ?? "0") || 0;
  const trend = deltaArrow(recovered, priorRecovered);
  return `
    <div style="border:1px solid #e5e7eb;border-radius:8px;padding:14px 16px;margin:12px 0;background:#fafafa;">
      <div style="font-size:11px;color:#666;text-transform:uppercase;letter-spacing:.05em;">Last 7 days · recovery</div>
      <div style="font-size:22px;font-weight:600;color:#1a1a1a;margin-top:4px;">
        ${escapeHtml(money(summary.amounts.recoveredAmount))}
        <span style="font-size:13px;color:${trend.color};font-weight:500;margin-left:8px;">${trend.arrow} ${escapeHtml(trend.label)}</span>
      </div>
      <div style="font-size:12px;color:#666;margin-top:4px;">
        Prior 7d: ${escapeHtml(money(summary.amounts.priorRecoveredAmount))} ·
        Recovery rate: ${escapeHtml(pct(summary.amounts.recoveryRate))} ·
        Net change: ${escapeHtml(money(summary.amounts.netChangeRecovered))}
      </div>
    </div>
  `;
}

// ─── Admin variant ─────────────────────────────────────────────────────

export function renderAdminDailyBody(
  summary: CanonicalSummary,
  yesterday: YesterdayActivity,
  attention: PortalAttentionBundle,
  reviewCount: CanonicalReviewCount | null = null,
): string {
  const actionable = actionableExpiring(summary);
  const urgentCount = actionable.filter((g) => g.isUrgent).length;
  const urgentListHref = absUrl("/queue?expiring=urgent");
  const soonListHref = absUrl("/queue?expiring=soon");
  const filingRows = actionable.slice(0, 15).map((g) => {
    const color = g.isUrgent ? "#dc2626" : "#f59e0b";
    const label = g.isUrgent ? "Now" : `${g.daysLeft}d`;
    return {
      cells: [
        `<a href="${escapeHtml(absUrl(`/queue?group=${g.id}`))}" style="color:#0b62d6;text-decoration:none;font-family:monospace;">${escapeHtml(g.invoiceNumber ?? `Group #${g.id}`)}</a>`,
        escapeHtml(g.earliestDate ?? "—"),
        escapeHtml(money(g.totalAmount)),
        `<span style="color:${color};font-weight:600;">${escapeHtml(label)}</span>`,
      ],
    };
  });
  const filingSubtitle =
    actionable.length === 0
      ? "Nothing approaching its filing deadline."
      : urgentCount > 0
      ? `${urgentCount} must file today, ${actionable.length - urgentCount} more in next 7 days`
      : `${actionable.length} approaching deadline`;
  const filingHeader = `
    <div style="margin:24px 0 8px;display:flex;align-items:baseline;justify-content:space-between;gap:12px;flex-wrap:wrap;">
      <div>
        <h2 style="font-size:14px;color:#1a1a1a;margin:0;text-transform:uppercase;letter-spacing:.05em;">Needs filing now</h2>
        <div style="font-size:12px;color:${urgentCount > 0 ? "#dc2626" : "#666"};margin-top:2px;">${escapeHtml(filingSubtitle)}</div>
      </div>
      <a href="${escapeHtml(urgentListHref)}" style="font-size:12px;color:#0b62d6;text-decoration:none;font-weight:600;">Open urgent worklist →</a>
    </div>
  `;
  const filingSection =
    actionable.length === 0
      ? `${filingHeader}<p style="font-size:13px;color:#137a3f;margin:8px 0;">Nothing to file today.</p>`
      : `${filingHeader}${simpleTable(["Invoice", "Earliest service", "Total", "Time left"], filingRows)}
         <p style="margin:6px 0 0;font-size:11px;color:#94a3b8;">
           <a href="${escapeHtml(soonListHref)}" style="color:#94a3b8;text-decoration:underline;">See full 7-day window →</a>
         </p>`;

  const tomorrowGroups = dueTomorrowGroups(summary);
  const tomorrowRows = tomorrowGroups.slice(0, 10).map((g) => ({
    cells: [
      `<a href="${escapeHtml(absUrl(`/queue?group=${g.id}`))}" style="color:#0b62d6;text-decoration:none;">${escapeHtml(g.invoiceNumber ?? `Group #${g.id}`)}</a>`,
      escapeHtml(money(g.totalAmount)),
      escapeHtml(g.earliestDate ?? "—"),
    ],
  }));
  const tomorrowSection = `
    ${sectionHeader("Filings due tomorrow", `${tomorrowGroups.length} groups`)}
    ${simpleTable(["Invoice", "Total", "Earliest service"], tomorrowRows)}
  `;

  return `
    ${renderKpiStrip(summary, reviewCount)}
    ${renderRecoveryBlock(summary)}
    ${renderYesterdayRow(yesterday)}
    ${renderAttentionBlock(attention)}
    ${filingSection}
    ${tomorrowSection}
  `;
}

// ─── Operator variant ──────────────────────────────────────────────────
//
// Same shared head as the admin (KPI strip / yesterday / attention) so
// operators see the same morning context their admins do; followed by
// the per-user worklist. No money block (recovered $ / recovery rate)
// — that's admin-content.

export function renderOperatorDailyBody(
  needs: NeedsYouToday,
  ownerEmail: string,
  summary: CanonicalSummary | null,
  yesterday: YesterdayActivity,
  attention: PortalAttentionBundle,
  reviewCount: CanonicalReviewCount | null = null,
): string {
  const intro = paragraph(
    `Hi ${ownerEmail.split("@")[0]} — here's what needs your attention today.`,
  );

  const reviewRows = needs.needsReview.slice(0, 10).map((n) => ({
    cells: [
      `<a href="${escapeHtml(absUrl(n.href))}" style="color:#0b62d6;text-decoration:none;">${escapeHtml(n.confNumber)}</a>`,
      escapeHtml(n.status),
      escapeHtml(n.reason),
    ],
  }));
  const draftRows = needs.unsubmittedDrafts.slice(0, 10).map((n) => ({
    cells: [
      `<a href="${escapeHtml(absUrl(n.href))}" style="color:#0b62d6;text-decoration:none;">${escapeHtml(n.confNumber)}</a>`,
      escapeHtml(n.status),
      escapeHtml(n.reason),
    ],
  }));
  const touchedRows = needs.recentlyTouched.slice(0, 10).map((n) => ({
    cells: [
      `<a href="${escapeHtml(absUrl(n.href))}" style="color:#0b62d6;text-decoration:none;">${escapeHtml(n.confNumber)}</a>`,
      escapeHtml(n.status),
      escapeHtml(n.reason),
    ],
  }));

  return `
    ${intro}
    ${renderKpiStrip(summary, reviewCount)}
    ${renderYesterdayRow(yesterday)}
    ${renderAttentionBlock(attention)}
    ${sectionHeader("Responses awaiting your review", `${needs.needsReview.length} item(s)`)}
    ${simpleTable(["Claim", "Status", "Why it's here"], reviewRows)}
    ${sectionHeader("Drafts you started but didn't submit", `${needs.unsubmittedDrafts.length} item(s)`)}
    ${simpleTable(["Invoice", "Status", "Why it's here"], draftRows)}
    ${sectionHeader("Claims you've touched in the last 14 days", `${needs.recentlyTouched.length} item(s)`)}
    ${simpleTable(["Claim", "Status", "Why it's here"], touchedRows)}
  `;
}
