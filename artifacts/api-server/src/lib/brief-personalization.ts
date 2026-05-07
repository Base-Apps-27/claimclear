import { db } from "@workspace/db";
import {
  auditLogsTable,
  claimsTable,
  portalSubmissionsTable,
  usersTable,
  notificationPreferencesTable,
} from "@workspace/db";
import { and, eq, or, gte, lt, inArray, sql, desc, isNotNull } from "drizzle-orm";

// Every claim_status value that means "the leg is still open" — used to
// build the daily brief's per-leg counts. "Processed" is open (worktree
// done but invoice not yet packaged). "Generating Email" was a
// pre-existing omission corrected here so the brief no longer drops
// in-flight legs that happen to be in that intermediate state.
export const OPEN_STATUSES = [
  "New",
  "Needs Evidence",
  "Processed",
  "Portal Queued",
  "Generating Email",
  "Ready to Review",
  "Awaiting Response",
  "On Hold",
] as const;

export interface YesterdayActivity {
  claimsCreated: number;
  draftsSubmitted: number;
  responsesReceived: number;
  decisionsLogged: number;
}

// Action keys counted by `getYesterdayActivity`. Exported so tests can lock the
// whitelist in place — the daily brief silently broke once when the app stopped
// writing some of these keys, so renames here should be intentional and tested.
export const YESTERDAY_CLAIMS_CREATED_ACTIONS = ["claim_created", "claims_imported"] as const;
export const YESTERDAY_DRAFTS_SUBMITTED_ACTIONS = ["portal_submission_confirmed"] as const;
export const YESTERDAY_RESPONSES_RECEIVED_ACTIONS = ["response_received"] as const;
export const YESTERDAY_DECISIONS_LOGGED_ACTIONS = [
  "outcome_changed",
  "group_outcome_changed",
  "group_status_and_outcome_changed",
] as const;

const YESTERDAY_ACTION_WHITELIST = [
  ...YESTERDAY_CLAIMS_CREATED_ACTIONS,
  ...YESTERDAY_DRAFTS_SUBMITTED_ACTIONS,
  ...YESTERDAY_RESPONSES_RECEIVED_ACTIONS,
  ...YESTERDAY_DECISIONS_LOGGED_ACTIONS,
] as const;

export async function getYesterdayActivity(yesterdayStart: Date, todayStart: Date): Promise<YesterdayActivity> {
  const rows = await db
    .select({ action: auditLogsTable.action, count: sql<number>`count(*)::int` })
    .from(auditLogsTable)
    .where(
      and(
        gte(auditLogsTable.timestamp, yesterdayStart),
        lt(auditLogsTable.timestamp, todayStart),
        inArray(auditLogsTable.action, [...YESTERDAY_ACTION_WHITELIST]),
      ),
    )
    .groupBy(auditLogsTable.action);

  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.action] = r.count;

  // Bulk imports don't write a per-claim `claim_created` audit row; they write a
  // single `claims_imported` event whose metadata holds the row count. Sum that
  // in so big imports aren't invisible in "claims created".
  const importedRows = await db
    .select({
      total: sql<number>`coalesce(sum(((${auditLogsTable.metadata})->>'created')::int), 0)::int`,
    })
    .from(auditLogsTable)
    .where(
      and(
        gte(auditLogsTable.timestamp, yesterdayStart),
        lt(auditLogsTable.timestamp, todayStart),
        eq(auditLogsTable.action, "claims_imported"),
      ),
    );
  const importedCreated = importedRows[0]?.total ?? 0;

  const claimsCreated = (counts["claim_created"] ?? 0) + importedCreated;
  const draftsSubmitted = YESTERDAY_DRAFTS_SUBMITTED_ACTIONS.reduce(
    (sum, k) => sum + (counts[k] ?? 0),
    0,
  );
  const responsesReceived = YESTERDAY_RESPONSES_RECEIVED_ACTIONS.reduce(
    (sum, k) => sum + (counts[k] ?? 0),
    0,
  );
  const decisionsLogged = YESTERDAY_DECISIONS_LOGGED_ACTIONS.reduce(
    (sum, k) => sum + (counts[k] ?? 0),
    0,
  );

  return { claimsCreated, draftsSubmitted, responsesReceived, decisionsLogged };
}

export interface NeedsYouItem {
  id: number;
  confNumber: string;
  status: string;
  reason: string;
  href: string;
}

export interface NeedsYouToday {
  recentlyTouched: NeedsYouItem[];
  unsubmittedDrafts: NeedsYouItem[];
  needsReview: NeedsYouItem[];
}

const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;

export async function getNeedsYouToday(userEmail: string, now: Date): Promise<NeedsYouToday> {
  const since = new Date(now.getTime() - FOURTEEN_DAYS_MS);
  // Wave C residual (§3.B): kept on legacy `claims.status` because there is
  // no clean `disposition` equivalent for this 8-status set. The set excludes
  // `MAS Eligible` (which lives in `awaiting_reattestation` phase with
  // dispositions `attest_*` — all NOT in the `final_*` closed set), so
  // `disposition NOT IN (final_*)` would over-include those legs and start
  // surfacing in-attestation work in the operator's "recently touched open"
  // section. Same residual class as `routes/daily-brief.ts` open-claim
  // filter; switch in Wave D once a per-claim closed/open mirror lands.
  const openFilter = or(...OPEN_STATUSES.map((s) => eq(claimsTable.status, s)));

  // Recently touched claims (open) — distinct claim ids the user touched in last 14 days
  const touchedRows = await db
    .selectDistinct({ claimId: auditLogsTable.claimId })
    .from(auditLogsTable)
    .where(
      and(
        eq(auditLogsTable.userEmail, userEmail),
        gte(auditLogsTable.timestamp, since),
        isNotNull(auditLogsTable.claimId),
      ),
    );
  const touchedClaimIds = touchedRows
    .map((r) => r.claimId)
    .filter((id): id is number => id != null);

  let recentlyTouched: NeedsYouItem[] = [];
  if (touchedClaimIds.length > 0) {
    const rows = await db
      .select({
        id: claimsTable.id,
        confNumber: claimsTable.confNumber,
        status: claimsTable.status,
        updatedAt: claimsTable.updatedAt,
      })
      .from(claimsTable)
      .where(and(inArray(claimsTable.id, touchedClaimIds), openFilter))
      .orderBy(desc(claimsTable.updatedAt))
      .limit(10);
    recentlyTouched = rows.map((r) => ({
      id: r.id,
      confNumber: r.confNumber,
      status: r.status,
      reason: "You touched this in the last 14 days",
      href: `/claims/${r.id}`,
    }));
  }

  // Unsubmitted drafts the user edited/regenerated — find submissions in 'draft' that this user
  // edited/regenerated/created via audit_logs
  const draftAuditRows = await db
    .selectDistinct({ claimId: auditLogsTable.claimId })
    .from(auditLogsTable)
    .where(
      and(
        eq(auditLogsTable.userEmail, userEmail),
        gte(auditLogsTable.timestamp, since),
        inArray(auditLogsTable.action, [
          "portal_draft_created",
          "portal_draft_edited",
          "portal_draft_regenerated",
        ]),
        isNotNull(auditLogsTable.claimId),
      ),
    );
  const draftClaimIds = draftAuditRows
    .map((r) => r.claimId)
    .filter((id): id is number => id != null);

  let unsubmittedDrafts: NeedsYouItem[] = [];
  if (draftClaimIds.length > 0) {
    // Audit-log rows give us per-claim attribution, but submissions are now
    // group-scoped. Translate the touched claim ids to their invoice groups
    // and look up active drafts on those groups.
    const groupRows = await db
      .select({ invoiceGroupId: claimsTable.invoiceGroupId })
      .from(claimsTable)
      .where(inArray(claimsTable.id, draftClaimIds));
    const groupIds = Array.from(
      new Set(
        groupRows
          .map((g) => g.invoiceGroupId)
          .filter((id): id is number => id != null),
      ),
    );
    if (groupIds.length > 0) {
      const rows = await db
        .select({
          id: portalSubmissionsTable.id,
          invoiceGroupId: portalSubmissionsTable.invoiceGroupId,
          confNumber: portalSubmissionsTable.confNumber,
          updatedAt: portalSubmissionsTable.updatedAt,
        })
        .from(portalSubmissionsTable)
        .where(
          and(
            inArray(portalSubmissionsTable.invoiceGroupId, groupIds),
            eq(portalSubmissionsTable.status, "draft"),
          ),
        )
        .orderBy(desc(portalSubmissionsTable.updatedAt))
        .limit(10);
      unsubmittedDrafts = rows.map((r) => ({
        id: r.invoiceGroupId,
        confNumber: r.confNumber ?? `Invoice group #${r.invoiceGroupId}`,
        status: "draft",
        reason: "Draft you edited but never submitted",
        href: `/invoice-groups/${r.invoiceGroupId}`,
      }));
    }
  }

  // Needs Review claims (shared worklist). Wave C: prefer canonical
  // `claims.disposition === 'awaiting_review'` and fall back to legacy
  // `status === 'Needs Review'` for rows still on the `unclassified`
  // disposition default. Per `lib/invoice-state/derive-disposition.ts`,
  // `awaiting_review` is only emitted by `responseDisposition()` (parent
  // phase = `response_received`, no verdict yet) — the same condition the
  // legacy "Needs Review" status mirrors — so the two predicates are
  // semantically equivalent. The legacy fallback covers the migration window
  // where some response_received legs have not yet been re-derived.
  const reviewRows = await db
    .select({
      id: claimsTable.id,
      confNumber: claimsTable.confNumber,
      status: claimsTable.status,
    })
    .from(claimsTable)
    .where(
      or(
        eq(claimsTable.disposition, "awaiting_review"),
        and(
          eq(claimsTable.disposition, "unclassified"),
          eq(claimsTable.status, "Needs Review"),
        ),
      ),
    )
    .orderBy(desc(claimsTable.updatedAt))
    .limit(10);
  const needsReview: NeedsYouItem[] = reviewRows.map((r) => ({
    id: r.id,
    confNumber: r.confNumber,
    status: r.status,
    reason: "Response needs review",
    href: `/claims/${r.id}`,
  }));

  return { recentlyTouched, unsubmittedDrafts, needsReview };
}

export interface WeeklyDigest {
  thisWeek: { won: number; lost: number; withdrawn: number };
  priorWeek: { won: number; lost: number; withdrawn: number };
  avgDaysToResolution: number | null;
  topErrorTypes: { errorTypeName: string; recoveredAmount: number }[];
}

const RESOLVED_OUTCOMES_WON = ["Approved", "Partially Approved"] as const;
const RESOLVED_OUTCOMES_LOST = ["Denied"] as const;
const RESOLVED_OUTCOMES_WITHDRAWN = ["Withdrawn"] as const;
type ResolvedOutcome =
  | (typeof RESOLVED_OUTCOMES_WON)[number]
  | (typeof RESOLVED_OUTCOMES_LOST)[number]
  | (typeof RESOLVED_OUTCOMES_WITHDRAWN)[number];
const ALL_RESOLVED_OUTCOMES: ResolvedOutcome[] = [
  ...RESOLVED_OUTCOMES_WON,
  ...RESOLVED_OUTCOMES_LOST,
  ...RESOLVED_OUTCOMES_WITHDRAWN,
];

export async function getWeeklyDigest(now: Date): Promise<WeeklyDigest> {
  const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

  const countOutcomes = async (start: Date, end: Date) => {
    const rows = await db
      .select({ outcome: claimsTable.outcome, count: sql<number>`count(*)::int` })
      .from(claimsTable)
      .where(
        and(
          gte(claimsTable.updatedAt, start),
          lt(claimsTable.updatedAt, end),
          inArray(claimsTable.outcome, ALL_RESOLVED_OUTCOMES),
        ),
      )
      .groupBy(claimsTable.outcome);
    let won = 0;
    let lost = 0;
    let withdrawn = 0;
    for (const r of rows) {
      if ((RESOLVED_OUTCOMES_WON as readonly string[]).includes(r.outcome)) won += r.count;
      else if ((RESOLVED_OUTCOMES_LOST as readonly string[]).includes(r.outcome)) lost += r.count;
      else if ((RESOLVED_OUTCOMES_WITHDRAWN as readonly string[]).includes(r.outcome)) withdrawn += r.count;
    }
    return { won, lost, withdrawn };
  };

  const thisWeek = await countOutcomes(oneWeekAgo, now);
  const priorWeek = await countOutcomes(twoWeeksAgo, oneWeekAgo);

  const avgRows = await db
    .select({
      avgDays: sql<number | null>`avg(extract(epoch from (${claimsTable.updatedAt} - ${claimsTable.createdAt})) / 86400)::float`,
    })
    .from(claimsTable)
    .where(
      and(
        gte(claimsTable.updatedAt, oneWeekAgo),
        lt(claimsTable.updatedAt, now),
        inArray(claimsTable.outcome, ALL_RESOLVED_OUTCOMES),
      ),
    );
  const avgDaysToResolution = avgRows[0]?.avgDays != null ? Math.round(avgRows[0].avgDays * 10) / 10 : null;

  const topRows = await db
    .select({
      errorTypeName: claimsTable.errorTypeName,
      recovered: sql<number>`coalesce(sum(${claimsTable.approvedAmount}), 0)::float`,
    })
    .from(claimsTable)
    .where(
      and(
        gte(claimsTable.updatedAt, oneWeekAgo),
        lt(claimsTable.updatedAt, now),
        inArray(claimsTable.outcome, [...RESOLVED_OUTCOMES_WON]),
        isNotNull(claimsTable.errorTypeName),
      ),
    )
    .groupBy(claimsTable.errorTypeName)
    .orderBy(sql`coalesce(sum(${claimsTable.approvedAmount}), 0) desc`)
    .limit(5);

  const topErrorTypes = topRows
    .filter((r) => r.errorTypeName)
    .map((r) => ({ errorTypeName: r.errorTypeName as string, recoveredAmount: Number(r.recovered) || 0 }));

  return { thisWeek, priorWeek, avgDaysToResolution, topErrorTypes };
}

export interface BriefRecipient {
  userId: string;
  email: string;
  role: string;
  weeklyDigestEnabled: boolean;
}

export async function getBriefRecipients(): Promise<BriefRecipient[]> {
  const rows = await db
    .select({
      userId: usersTable.id,
      email: usersTable.email,
      role: usersTable.role,
      dailyBrief: notificationPreferencesTable.dailyBrief,
      weeklyDigest: notificationPreferencesTable.weeklyDigest,
    })
    .from(usersTable)
    .leftJoin(
      notificationPreferencesTable,
      eq(notificationPreferencesTable.userId, usersTable.id),
    )
    .where(
      and(
        eq(usersTable.status, "approved"),
        isNotNull(usersTable.email),
      ),
    );

  return rows
    .filter((r) => r.email && (r.dailyBrief ?? true) === true)
    .map((r) => ({
      userId: r.userId,
      email: r.email as string,
      role: r.role,
      weeklyDigestEnabled: (r.weeklyDigest ?? true) === true,
    }));
}

export function isMondayInNewYork(now: Date): boolean {
  // Get the weekday in America/New_York. Intl returns Mon/Tue/etc.
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
  });
  return fmt.format(now) === "Mon";
}
