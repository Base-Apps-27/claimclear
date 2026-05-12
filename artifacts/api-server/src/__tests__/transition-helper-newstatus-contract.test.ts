// Task #550 — Contract test: every literal `newStatus: "..."` callsite of
// `transitionGroupStatus` / `transitionClaimStatus` (and the `*AndOutcome`
// variants, plus the local `transitionContext` helper in
// `routes/portal-submissions.ts`) is registered here with the writer's
// **intended macro phase**. The test then runs the canonical reader path
// (`derivePhaseFromLegacy` + the `getGroupMacroPhase` mapping) against
// the legacy tuple the writer would land and asserts the macro matches
// the declared intent.
//
// Why. Task #547 caught the response-matcher writing a status that
// derived to a phase whose macro disagreed with the verdict endpoint's
// gate (`response-pending`), silently 409-ing every operator click for
// the matched cohort. Many other writers across `lib/` and `routes/`
// pass literal status strings the same way; any of them can drift the
// same way. This test enumerates every such callsite once so a future
// edit that introduces a status / phase / macro mismatch fails CI with
// the offending file:line, instead of shipping silently and surfacing
// as a production 409 storm.
//
// How drift is caught:
//   * Source-scan multiset of `(file, status)` literal newStatus sites
//     inside transition-helper calls must equal the REGISTRY multiset.
//     A new unenumerated callsite OR a deleted-but-still-registered one
//     fails Test 1 with a list of mismatches.
//   * For each REGISTRY entry, `derivePhaseFromLegacy(ctx)` mapped
//     through the same `PHASE_TO_MACRO` / on-hold / awaiting-payout
//     overrides as `getGroupMacroPhase` must equal the declared intent.
//     If they disagree, Test 2 fails with the file:line and the actual
//     phase + macro the writer would land — the same "Task #547-class"
//     failure mode.
//
// What this test does NOT cover (intentional):
//   * Dynamic `newStatus: <variable>` callsites (e.g. `routes/invoice-groups.ts`'s
//     PATCH /status route forwards an operator-typed string to the helper).
//     Those rely on the helper's transition map + per-status enum gate.
//   * `transitionGroupOutcome` / `transitionClaimOutcome` calls (no
//     `newStatus`).
//   * Callsites that already use a named constant like
//     `MATCHER_CLASSIFIED_TARGET_STATUS` — those are locked in their own
//     focused test (`response-matcher-target-status.test.ts`).
//   * Statuses from non-transition writers (e.g. `broadcastBatchEvent`
//     SSE payload builders, `portalSubmissionsTable` updates). Those
//     don't go through the deriver.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  derivePhaseFromLegacy,
  type LegacyClaimStatus,
  type LegacyOutcome,
} from "@workspace/invoice-state";
import type { InvoicePhase } from "@workspace/vocab";
import type { MacroPhase } from "../lib/macro-phase";

const SRC_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Files scanned for literal-newStatus transition calls. Adding a new
// writer file means adding it here AND adding the new callsites to
// REGISTRY below.
const TRANSITION_FILES = [
  "lib/response-matcher.ts",
  "lib/batch-processor.ts",
  "lib/expired-sweep.ts",
  "routes/invoice-groups.ts",
  "routes/claims.ts",
  "routes/portal-submissions.ts",
  "routes/response-tracker.ts",
];

// Helpers whose calls we treat as transition sites for newStatus
// scanning. `transitionContext` is the local helper in
// `routes/portal-submissions.ts` that forwards directly to
// `transitionGroupStatus` (see its body); from a contract POV it is
// indistinguishable from the upstream helper.
const TRANSITION_HELPER_NAMES = [
  "transitionGroupStatus",
  "transitionClaimStatus",
  "transitionGroupStatusAndOutcome",
  "transitionClaimStatusAndOutcome",
  "transitionContext",
];

interface FoundSite {
  file: string;
  line: number; // 1-indexed line of the `newStatus:` literal
  status: string;
}

function scanTransitionCallSites(file: string): FoundSite[] {
  const src = readFileSync(resolve(SRC_ROOT, file), "utf8");
  const lines = src.split("\n");
  const out: FoundSite[] = [];
  // Match `await transitionXxx(`, including patterns like
  //   `const result = await transitionXxx(` and
  //   `const transition = await transitionXxx(`.
  // The leading `await` excludes the `transitionContext` function
  // *definition* in portal-submissions.ts (which would otherwise also
  // contain a `newStatus:` literal in its argument type).
  const helperAlt = TRANSITION_HELPER_NAMES.join("|");
  const callRe = new RegExp(`\\bawait\\s+(?:[\\w.$]+\\s*=\\s*)?(?:${helperAlt})\\s*\\(`);
  const newStatusRe = /\bnewStatus:\s*"([^"]+)"/;

  for (let i = 0; i < lines.length; i++) {
    if (!callRe.test(lines[i])) continue;
    // Walk forward, counting parens to find the call's closing paren.
    // Capture the first `newStatus: "literal"` we see along the way.
    let parens = 0;
    let started = false;
    for (let j = i; j < Math.min(i + 80, lines.length); j++) {
      const line = lines[j];
      for (const ch of line) {
        if (ch === "(") {
          parens += 1;
          started = true;
        } else if (ch === ")") {
          parens -= 1;
        }
      }
      const m = line.match(newStatusRe);
      if (m) {
        out.push({ file, line: j + 1, status: m[1] });
        break; // assume one newStatus per call
      }
      if (started && parens <= 0) break;
    }
  }
  return out;
}

// Per-callsite registry. `line` is informational (used in failure
// messages); `(file, status, occurrences)` is what's matched against
// the source scan. `outcome` / `closureReason` / `submittedVia` /
// `reattestRequired` shape the legacy tuple the deriver runs against,
// matching what the writer also stamps on the same UPDATE (or, for
// `submittedVia` on portal sites, what the post-write denormalized
// cache refresh aggregates onto the group).
interface RegistryEntry {
  file: string;
  status: LegacyClaimStatus;
  intent: MacroPhase;
  // Approximate source line for failure messages — kept in sync by the
  // multiset check below if a maintainer moves the call.
  line: number;
  // Why this writer intends this macro — surfaced in failure output to
  // give the next maintainer enough context to choose between fixing
  // the writer vs. updating the registry.
  why: string;
  outcome?: LegacyOutcome;
  closureReason?: string | null;
  reattestRequired?: boolean;
  reattestCompletedAt?: Date | null;
  submittedVia?: "portal" | "email" | null;
}

const REGISTRY: RegistryEntry[] = [
  // --- lib/batch-processor.ts -----------------------------------------
  {
    file: "lib/batch-processor.ts",
    line: 982,
    status: "Awaiting Response",
    intent: "in-flight",
    why: "Direct-email dispute sent — group is awaiting payor reply; in-flight macro shows it on the dispute-sent dashboards.",
    submittedVia: "email",
  },
  {
    file: "lib/batch-processor.ts",
    line: 1167,
    status: "Awaiting Response",
    intent: "in-flight",
    why: "External-bot portal submission succeeded — group is awaiting payor reply; in-flight macro shows it on the dispute-sent dashboards.",
    submittedVia: "portal",
  },

  // --- lib/expired-sweep.ts -------------------------------------------
  {
    file: "lib/expired-sweep.ts",
    line: 143,
    status: "Expired",
    intent: "closed",
    why: "Sweep aged the group past its filing deadline — closed macro removes it from operator queues.",
  },

  // --- routes/invoice-groups.ts ---------------------------------------
  {
    file: "routes/invoice-groups.ts",
    line: 1390,
    status: "Needs Evidence",
    intent: "pre-submit",
    why: "Auto-advance after first error-type classification — group enters the evidence-gathering pre-submit lane.",
  },
  {
    file: "routes/invoice-groups.ts",
    line: 1548,
    status: "Resolved",
    intent: "closed",
    why: "Triage non-issue path — group closes immediately with outcome=Non-Issue (closureReason=non_issue).",
    outcome: "Non-Issue",
    closureReason: "non_issue",
  },
  {
    file: "routes/invoice-groups.ts",
    line: 1572,
    status: "New",
    intent: "pre-submit",
    why: "Triage issue-found path — group lands in pre-submit so the operator can attach evidence.",
  },
  {
    file: "routes/invoice-groups.ts",
    line: 1621,
    status: "MAS Eligible",
    intent: "mas-action-required",
    why: "Post-upload bridge → MAS Eligible — group enters the MAS Action Required lane (per-leg attestation queue).",
    reattestRequired: true,
  },
  {
    file: "routes/invoice-groups.ts",
    line: 1662,
    status: "On Hold",
    intent: "on-hold",
    why: "Operator hold — getGroupMacroPhase reads the legacy status flag for on-hold (Wave D pending re-modeling).",
  },
  {
    file: "routes/invoice-groups.ts",
    line: 3659,
    status: "Resolved",
    intent: "closed",
    why: "MAS re-attest completed (online or offline) — group closes with outcome=Approved (closureReason=reattested).",
    outcome: "Approved",
    closureReason: "reattested",
    reattestCompletedAt: new Date("2026-05-08T12:00:00Z"),
  },
  {
    // routes/invoice-groups.ts:4953 — bulk_close_nothing_to_do path
    // added after the original REGISTRY snapshot. Closes groups whose
    // legs are all `cannot_dispute` survivors (no actionable leg
    // remains) with outcome=Withdrawn + closureReason=cannot_dispute.
    file: "routes/invoice-groups.ts",
    line: 4953,
    status: "Resolved",
    intent: "closed",
    why: "Bulk-close `nothing-to-do` — every leg is cannot_dispute, group closes with outcome=Withdrawn (closureReason=cannot_dispute).",
    outcome: "Withdrawn",
    closureReason: "cannot_dispute",
  },

  // --- routes/claims.ts -----------------------------------------------
  {
    file: "routes/claims.ts",
    line: 674,
    status: "Needs Evidence",
    intent: "pre-submit",
    why: "Per-leg auto-advance after first error-type classification — leg enters the evidence-gathering pre-submit lane.",
  },
  {
    file: "routes/claims.ts",
    line: 1284,
    status: "Resolved",
    intent: "closed",
    why: "Per-leg triage non-issue — leg closes with outcome=Non-Issue.",
    outcome: "Non-Issue",
    closureReason: "non_issue",
  },
  {
    file: "routes/claims.ts",
    line: 1305,
    status: "New",
    intent: "pre-submit",
    why: "Per-leg triage issue-found — leg lands in pre-submit so the operator can attach evidence.",
  },
  {
    file: "routes/claims.ts",
    line: 1356,
    status: "Resolved",
    intent: "closed",
    why: "Post-response action `resolve_reattest` — leg closes with outcome=Approved (operator confirms re-attest done out of band).",
    outcome: "Approved",
    closureReason: "reattested",
  },
  {
    file: "routes/claims.ts",
    line: 1367,
    status: "Resolved",
    intent: "closed",
    why: "Post-response action `resolve_new_invoice` — leg closes with outcome=Approved (operator confirms new-invoice issued out of band).",
    outcome: "Approved",
    closureReason: "reattested",
  },
  {
    file: "routes/claims.ts",
    line: 1378,
    status: "Denied",
    intent: "closed",
    why: "Post-response action `mark_denied_by_payor` — leg closes with outcome=Denied (closureReason=denied_by_payor).",
    outcome: "Denied",
    closureReason: "denied_by_payor",
  },
  {
    file: "routes/claims.ts",
    line: 1390,
    status: "Needs Evidence",
    intent: "pre-submit",
    why: "Post-response action `re_dispute` — leg returns to evidence-gathering pre-submit lane for a re-submission.",
  },
  {
    // routes/claims.ts:1626 — per-leg auto-advance after the first
    // error-type-classification pass on a per-claim transition (added
    // after the original REGISTRY snapshot). Sibling of the per-leg
    // 740 site, but driven through the per-claim outer loop in the
    // `/api/error-types/:id/auto-advance-claims` path rather than the
    // group-cascade branch.
    file: "routes/claims.ts",
    line: 1626,
    status: "Needs Evidence",
    intent: "pre-submit",
    why: "Per-leg auto-advance after error type classified (outer per-claim loop) — leg lands in the evidence-gathering pre-submit lane.",
  },
  {
    file: "routes/claims.ts",
    line: 1799,
    status: "Needs Evidence",
    intent: "pre-submit",
    why: "Group-level cascade: when the final leg in a group is classified, group auto-advances to Needs Evidence.",
  },
  {
    file: "routes/claims.ts",
    line: 2716,
    status: "Needs Evidence",
    intent: "pre-submit",
    why: "Group-level cascade: when the final unclassified leg is excluded, group auto-advances to Needs Evidence.",
  },

  // --- routes/portal-submissions.ts -----------------------------------
  // The three Portal-Queued transitionContext callers also stamp
  // `claims.submitted_via='portal'` on every disputed child via
  // `childFields: { submittedVia: "portal" }`. After the post-write
  // denormalized cache refresh, `group.submittedVia='portal'`, which
  // promotes the deriver from `ready_to_submit` → `submitted` → macro
  // `in-flight`. Without that aggregate the deriver would land
  // `ready_to_submit` → macro `pre-submit` (the writer's intent only
  // holds because of the cache aggregate — Wave D-PR5).
  {
    file: "routes/portal-submissions.ts",
    line: 1378,
    status: "Portal Queued",
    intent: "in-flight",
    why: "Portal submission confirmed — child legs stamped with submittedVia='portal'; group derives to phase=submitted (in-flight).",
    submittedVia: "portal",
  },
  {
    file: "routes/portal-submissions.ts",
    line: 1609,
    status: "Portal Queued",
    intent: "in-flight",
    why: "Portal submission created — child legs stamped with submittedVia='portal'; group derives to phase=submitted (in-flight).",
    submittedVia: "portal",
  },
  {
    file: "routes/portal-submissions.ts",
    line: 1652,
    status: "Portal Queued",
    intent: "in-flight",
    why: "Portal submission retried from failed/dry_run — child legs stamped with submittedVia='portal'; group derives to phase=submitted (in-flight).",
    submittedVia: "portal",
  },
  {
    file: "routes/portal-submissions.ts",
    line: 1692,
    status: "Needs Evidence",
    intent: "pre-submit",
    why: "Portal submission cancelled with no other active submissions — group reverts to evidence-gathering pre-submit lane.",
  },

  // --- routes/response-tracker.ts -------------------------------------
  // The two `newStatus: TAGGED_TARGET_STATUS` writes (the operator
  // /responses/:id/process taggers, lines 147 and 176) use a constant
  // resolved to MATCHER_CLASSIFIED_TARGET_STATUS at module load time —
  // they are NOT literal newStatus sites and are locked in
  // `response-matcher-target-status.test.ts`. Only the two reassign-
  // revert sites below pass a literal here.
  {
    file: "routes/response-tracker.ts",
    line: 470,
    status: "Awaiting Response",
    intent: "in-flight",
    why: "Reassign revert (per-leg) — undoes the tag-driven response-pending transition; restores the in-flight `Awaiting Response` baseline.",
  },
  {
    file: "routes/response-tracker.ts",
    line: 487,
    status: "Awaiting Response",
    intent: "in-flight",
    why: "Reassign revert (per-group) — undoes the tag-driven response-pending transition; restores the in-flight `Awaiting Response` baseline.",
  },
];

// Mirror of `lib/macro-phase.ts`'s PHASE_TO_MACRO, replicated locally so
// the test fails loudly if either side drifts (e.g. a new InvoicePhase is
// added without updating PHASE_TO_MACRO).
const PHASE_TO_MACRO: Record<InvoicePhase, Exclude<MacroPhase, "on-hold" | "awaiting-payout">> = {
  triage: "pre-submit",
  ready_to_submit: "pre-submit",
  submitted: "in-flight",
  response_received: "response-pending",
  reviewed: "response-pending",
  awaiting_reattestation: "mas-action-required",
  closed: "closed",
};

// Replicates `getGroupMacroPhase`'s read order against the legacy
// tuple a writer would land. Kept inline so a regression in
// `getGroupMacroPhase` doesn't silently re-mask drift here.
function macroForLegacyTuple(entry: RegistryEntry): {
  macro: MacroPhase;
  phase: InvoicePhase;
} {
  if (entry.status === "On Hold") {
    return { macro: "on-hold", phase: "triage" };
  }
  const derived = derivePhaseFromLegacy({
    status: entry.status,
    outcome: entry.outcome ?? "Pending",
    reattestRequired: entry.reattestRequired ?? false,
    reattestCompletedAt: entry.reattestCompletedAt ?? null,
    closureReason: entry.closureReason ?? null,
    holdReason: null,
    submittedVia: entry.submittedVia ?? null,
  });
  if (entry.reattestCompletedAt != null && derived.phase !== "closed") {
    return { macro: "awaiting-payout", phase: derived.phase };
  }
  return { macro: PHASE_TO_MACRO[derived.phase], phase: derived.phase };
}

test("REGISTRY matches the literal `newStatus:` callsites in source (Test 1)", () => {
  const found: FoundSite[] = [];
  for (const f of TRANSITION_FILES) {
    found.push(...scanTransitionCallSites(f));
  }

  const keyOf = (file: string, status: string) => `${file}::${status}`;
  const foundCounts = new Map<string, number>();
  for (const s of found) {
    const k = keyOf(s.file, s.status);
    foundCounts.set(k, (foundCounts.get(k) ?? 0) + 1);
  }
  const expectedCounts = new Map<string, number>();
  for (const r of REGISTRY) {
    const k = keyOf(r.file, r.status);
    expectedCounts.set(k, (expectedCounts.get(k) ?? 0) + 1);
  }

  const allKeys = new Set<string>([...foundCounts.keys(), ...expectedCounts.keys()]);
  const drift: string[] = [];
  for (const k of allKeys) {
    const f = foundCounts.get(k) ?? 0;
    const e = expectedCounts.get(k) ?? 0;
    if (f === e) continue;
    const sourceLines = found
      .filter((s) => keyOf(s.file, s.status) === k)
      .map((s) => `${s.file}:${s.line}`)
      .join(", ") || "<no source occurrences>";
    drift.push(`  ${k}\n    REGISTRY count = ${e}, source count = ${f}\n    source: ${sourceLines}`);
  }

  if (drift.length > 0) {
    assert.fail(
      "transition-helper-newstatus-contract: REGISTRY drift.\n" +
        "Add a registry entry for each new literal `newStatus:` callsite, " +
        "or remove registry entries for deleted callsites:\n" +
        drift.join("\n") +
        "\n\nFull source scan:\n" +
        found.map((s) => `  ${s.file}:${s.line}  newStatus: "${s.status}"`).join("\n"),
    );
  }
});

for (const entry of REGISTRY) {
  test(
    `${entry.file}:${entry.line}  newStatus: "${entry.status}" → macro="${entry.intent}"`,
    () => {
      const { macro, phase } = macroForLegacyTuple(entry);
      if (macro !== entry.intent) {
        assert.fail(
          `${entry.file}:${entry.line} writes newStatus: "${entry.status}" intending ` +
            `macro="${entry.intent}", but derivePhaseFromLegacy + getGroupMacroPhase ` +
            `agree on phase="${phase}" → macro="${macro}". This is a Task #547-class ` +
            `drift: phase-gated endpoints (verdict, queueing, dashboard rollups) will ` +
            `treat the row as "${macro}" and reject operator clicks expecting ` +
            `"${entry.intent}".\n` +
            `Writer's stated intent: ${entry.why}\n` +
            `Fix: either change the writer to a status that derives to "${entry.intent}", ` +
            `or update the REGISTRY entry's intent + the depending phase-gated readers.`,
        );
      }
    },
  );
}
