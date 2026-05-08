// Per-claim state-divergence audit. Reads every row in `invoice_groups`
// and runs each of the checks below; emits one finding per row that
// fails any check. Designed to be run before any high-volume processing
// day so the operator team isn't surprised by 409s mid-flow.
//
// CHECKS RUN
// ──────────
//
//   reattest_cta_would_409
//     The Re-attest CTA is surfaced for any group whose dispute outlook
//     resolves to `reattest_only` (zero disputable legs, ≥1 survivor
//     leg). The CTA's server gate (POST /reattest/queue,
//     /reattest/complete) requires:
//       (macro = "response-pending" AND status = "Needs Review")
//       OR macro = "mas-action-required"
//     Any group satisfying outlook=reattest_only but failing the gate
//     would surface a 409 to the operator. This is the May-8 incident
//     class the canonical lifecycle map exists to prevent.
//
//   stranded_unclassified_on_closed
//     A leg with includedInDispute=true AND errorTypeId IS NULL on a
//     group with phase='closed'. Should have been swept by
//     `autoExcludeUnclassifiedOnTerminalClose`; if any survive, they
//     pollute the Classification Inbox forever. Mirror of the prod
//     incident from 2026-05-04 that drove the safety-net helper.
//
//   reattest_recorded_but_not_closed
//     reattest_completed_at IS NOT NULL AND phase != 'closed'. The
//     awaiting-payout macro-phase is supposed to be transient (single
//     transaction). A row stuck >24h here means the close-out write
//     never landed.
//
//   mas_eligible_without_attestation_cascade
//     status='MAS Eligible' AND phase='awaiting_reattestation' but no
//     leg has attestation_state ∈ {pending, queued, completed}. The
//     `engageMasEligibleAttestationCascade` side-effect must have
//     fired on the MAS Eligible transition; if it didn't, the
//     operator's MAS checklist will be empty.
//
//   status_phase_macro_drift
//     The legacy status-derived macro phase (`getMacroPhase`) and the
//     canonical phase-derived macro phase (`getGroupMacroPhase`) point
//     at incompatible buckets. Either column is wrong; both should be
//     fixed in lockstep.
//
// USAGE
// ─────
//
//   pnpm --filter @workspace/api-server exec tsx \
//     src/scripts/audit-state-divergence.ts            # human-readable
//
//   pnpm --filter @workspace/api-server exec tsx \
//     src/scripts/audit-state-divergence.ts --json     # one JSON object
//                                                       per finding
//
// READ-ONLY. The script never writes — it issues SELECT-only queries
// and prints findings. Safe to run against PROD_DATABASE_URL.

import { sql } from "drizzle-orm";
import { db, pool } from "@workspace/db";
import { getGroupMacroPhase, getMacroPhase, type MacroPhase } from "../lib/macro-phase";

interface GroupRow extends Record<string, unknown> {
  id: number;
  invoice_number: string;
  status: string;
  outcome: string;
  phase: string;
  reattest_required: boolean;
  reattest_completed_at: string | null;
  closure_reason: string | null;
}

interface LegRow extends Record<string, unknown> {
  id: number;
  invoice_group_id: number;
  status: string;
  outcome: string;
  included_in_dispute: boolean | null;
  error_type_id: string | null;
  duplicate_of_claim_id: number | null;
  sop_outcome: string | null;
  attestation_state: string | null;
  disposition: string | null;
}

interface Finding {
  check: string;
  groupId: number;
  invoiceNumber: string;
  detail: string;
  context: Record<string, unknown>;
}

// ─── Re-attest gate (server-mirror) ──────────────────────────────────
// Reproduces the contract in invoice-groups.ts L3810-3852 and
// /reattest/complete L3546+ exactly. Single source of truth: any change
// to the route gate must be matched here AND in
// artifacts/claimclear/src/lib/whats-next-derivation.ts
// (canQueueOrCompleteReattest).
function reattestGateAccepts(group: GroupRow): boolean {
  const macro = getGroupMacroPhase({
    phase: group.phase,
    status: group.status,
    reattestRequired: group.reattest_required,
    reattestCompletedAt: group.reattest_completed_at,
  });
  if (macro === "mas-action-required") return true;
  if (macro === "response-pending" && group.status === "Needs Review") return true;
  return false;
}

// ─── Outlook (server-mirror of deriveInvoiceDisputeOutlook) ──────────
// Light port of artifacts/claimclear/src/lib/whats-next-derivation.ts
// for the `reattest_only` branch only. We only need the boolean
// "would the Re-attest CTA mount?" — the survivor / dropped lists
// aren't relevant here.
//
// `outcomeRole` (in @workspace/leg-state) folds (sopOutcome,
// disposition) into a single role; we mirror its `non_issue` /
// `cannot_dispute` cases inline because the script can't import the
// React-side helper without dragging in client deps.
function isNonIssue(leg: LegRow): boolean {
  if (leg.disposition === "disposed_nonissue" || leg.disposition === "final_nonissue") {
    return true;
  }
  return leg.sop_outcome === "non_issue";
}
function isCannotDispute(leg: LegRow): boolean {
  if (leg.disposition === "disposed_withdraw" || leg.disposition === "final_withdrawn") {
    return true;
  }
  return leg.sop_outcome === "cannot_dispute";
}
function legHasApprovedVerdict(leg: LegRow): boolean {
  // Best-effort approximation — the full verdict ladder lives in
  // claim_verdict; for the audit we use the cached `outcome` column on
  // the leg row itself, which the verdict writer keeps in sync. Good
  // enough for the "would the survivor branch fire?" question.
  return leg.outcome === "Approved" || leg.outcome === "Partially Approved";
}

function isReattestOnlyOutlook(legs: LegRow[]): boolean {
  let hasDisputable = false;
  let hasSurvivor = false;
  for (const leg of legs) {
    const isDuplicate = leg.duplicate_of_claim_id != null;
    const nonIssue = isNonIssue(leg);
    const cannotDispute = isCannotDispute(leg);
    const approved = legHasApprovedVerdict(leg);
    const denied = leg.outcome === "Denied";

    if (nonIssue || approved) hasSurvivor = true;
    if (
      leg.included_in_dispute === true &&
      !isDuplicate &&
      !cannotDispute &&
      !nonIssue &&
      !denied
    ) {
      hasDisputable = true;
    }
  }
  return !hasDisputable && hasSurvivor;
}

// ─── Findings emitter ────────────────────────────────────────────────
function emit(findings: Finding[], jsonMode: boolean): void {
  if (jsonMode) {
    for (const f of findings) console.log(JSON.stringify(f));
    return;
  }

  const byCheck = new Map<string, Finding[]>();
  for (const f of findings) {
    if (!byCheck.has(f.check)) byCheck.set(f.check, []);
    byCheck.get(f.check)!.push(f);
  }

  if (findings.length === 0) {
    console.log("\n✓ No state-divergence findings. The canonical lifecycle map matches every live row.\n");
    return;
  }

  console.log(`\nFound ${findings.length} finding(s) across ${byCheck.size} check(s):\n`);
  for (const [check, items] of byCheck) {
    console.log(`── ${check} (${items.length}) ──`);
    for (const f of items) {
      console.log(`  group #${f.groupId} (invoice ${f.invoiceNumber})`);
      console.log(`    ${f.detail}`);
      const ctx = Object.entries(f.context)
        .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
        .join(", ");
      if (ctx) console.log(`    context: ${ctx}`);
    }
    console.log();
  }
}

async function main(): Promise<void> {
  const jsonMode = process.argv.includes("--json");

  if (!jsonMode) {
    console.log("[audit-state-divergence] reading invoice_groups + claims …");
  }

  const groupsRes = await db.execute<GroupRow>(sql`
    SELECT id,
           invoice_number,
           status::text  AS status,
           outcome::text AS outcome,
           phase::text   AS phase,
           reattest_required,
           reattest_completed_at::text AS reattest_completed_at,
           closure_reason
      FROM invoice_groups
     WHERE COALESCE(is_tour_sample, false) = false
     ORDER BY id;
  `);
  const groups = (groupsRes.rows ?? []) as GroupRow[];

  const legsRes = await db.execute<LegRow>(sql`
    SELECT id,
           invoice_group_id,
           status::text  AS status,
           outcome::text AS outcome,
           included_in_dispute,
           error_type_id,
           duplicate_of_claim_id,
           sop_outcome::text AS sop_outcome,
           attestation_state::text AS attestation_state,
           disposition::text AS disposition
      FROM claims
     WHERE invoice_group_id IS NOT NULL
     ORDER BY invoice_group_id, id;
  `);
  const legs = (legsRes.rows ?? []) as LegRow[];

  const legsByGroup = new Map<number, LegRow[]>();
  for (const l of legs) {
    if (!legsByGroup.has(l.invoice_group_id)) legsByGroup.set(l.invoice_group_id, []);
    legsByGroup.get(l.invoice_group_id)!.push(l);
  }

  if (!jsonMode) {
    console.log(
      `[audit-state-divergence] ${groups.length} group(s) / ${legs.length} leg(s) loaded.\n`,
    );
  }

  const findings: Finding[] = [];

  for (const g of groups) {
    const groupLegs = legsByGroup.get(g.id) ?? [];
    const macro: MacroPhase = getGroupMacroPhase({
      phase: g.phase,
      status: g.status,
      reattestRequired: g.reattest_required,
      reattestCompletedAt: g.reattest_completed_at,
    });

    // ── Check 1: reattest_cta_would_409 ────────────────────────────
    if (isReattestOnlyOutlook(groupLegs) && !reattestGateAccepts(g)) {
      findings.push({
        check: "reattest_cta_would_409",
        groupId: g.id,
        invoiceNumber: g.invoice_number,
        detail:
          "Outlook = reattest_only but server gate would 409 — operator sees Re-attest CTA that fails on click.",
        context: { phase: g.phase, status: g.status, macro, reattestCompletedAt: g.reattest_completed_at },
      });
    }

    // ── Check 2: stranded_unclassified_on_closed ───────────────────
    if (g.phase === "closed") {
      const stranded = groupLegs.filter(
        (l) =>
          l.included_in_dispute === true &&
          (l.error_type_id == null || l.error_type_id === "") &&
          l.duplicate_of_claim_id == null,
      );
      if (stranded.length > 0) {
        findings.push({
          check: "stranded_unclassified_on_closed",
          groupId: g.id,
          invoiceNumber: g.invoice_number,
          detail: `${stranded.length} leg(s) still marked includedInDispute=true with no errorTypeId on a closed group — pollutes the Classification Inbox.`,
          context: {
            strandedLegIds: stranded.map((l) => l.id),
            groupStatus: g.status,
            closureReason: g.closure_reason,
          },
        });
      }
    }

    // ── Check 3: reattest_recorded_but_not_closed ──────────────────
    if (g.reattest_completed_at != null && g.phase !== "closed") {
      const ageMs = Date.now() - new Date(g.reattest_completed_at).getTime();
      const ageHours = ageMs / (1000 * 60 * 60);
      if (ageHours > 24) {
        findings.push({
          check: "reattest_recorded_but_not_closed",
          groupId: g.id,
          invoiceNumber: g.invoice_number,
          detail: `Re-attest recorded ${ageHours.toFixed(1)}h ago but phase is still '${g.phase}'. The close-out write didn't land.`,
          context: {
            reattestCompletedAt: g.reattest_completed_at,
            phase: g.phase,
            status: g.status,
          },
        });
      }
    }

    // ── Check 4: mas_eligible_without_attestation_cascade ──────────
    if (g.status === "MAS Eligible" && g.phase === "awaiting_reattestation") {
      const engaged = groupLegs.some(
        (l) =>
          l.attestation_state != null &&
          l.attestation_state !== "not_required",
      );
      const disputedLegs = groupLegs.filter(
        (l) => l.error_type_id != null && l.status !== "On Hold",
      );
      if (!engaged && disputedLegs.length > 0) {
        findings.push({
          check: "mas_eligible_without_attestation_cascade",
          groupId: g.id,
          invoiceNumber: g.invoice_number,
          detail: `Group is MAS Eligible with ${disputedLegs.length} disputed leg(s) but no leg has attestation_state ≠ not_required — engageMasEligibleAttestationCascade did not fire.`,
          context: {
            disputedLegIds: disputedLegs.map((l) => l.id),
          },
        });
      }
    }

    // ── Check 5: status_phase_macro_drift ──────────────────────────
    // Compare the legacy status-derived macro vs the canonical
    // phase-derived macro. Compatible pairs: identical OR one of them
    // is `awaiting-payout` (which the legacy reader can't see). Hold
    // is sourced from status in both readers, so they agree there.
    const legacyMacro = getMacroPhase(g.status);
    const compatible =
      macro === legacyMacro ||
      macro === "awaiting-payout" ||
      // The phase column reads `closed` for any terminal status; the
      // legacy reader maps Resolved/Denied → closed too. Fine.
      (macro === "closed" && legacyMacro === "closed");
    if (!compatible) {
      findings.push({
        check: "status_phase_macro_drift",
        groupId: g.id,
        invoiceNumber: g.invoice_number,
        detail: `phase='${g.phase}' resolves to macro='${macro}' but status='${g.status}' resolves to macro='${legacyMacro}'. One column is wrong.`,
        context: { phase: g.phase, status: g.status, canonicalMacro: macro, legacyMacro },
      });
    }
  }

  emit(findings, jsonMode);

  if (!jsonMode) {
    console.log(`[audit-state-divergence] done.`);
  }
}

main()
  .then(() => pool.end())
  .catch((err) => {
    console.error("[audit-state-divergence] failed:", err);
    pool.end().finally(() => process.exit(1));
  });
