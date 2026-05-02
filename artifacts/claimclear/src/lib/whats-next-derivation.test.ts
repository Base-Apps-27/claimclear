import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
  deriveVerdictMix,
  isActionableLeg,
  pickSuggestedNewInvoiceNumber,
  pickSuggestedPayorDenialReason,
  isAwaitingPayorAgain,
} from "./whats-next-derivation";
import type {
  ClaimResponse,
  ClaimVerdictResponse,
  InvoiceGroupResponse,
  PortalResponseItem,
} from "@workspace/api-client-react";

// Lightweight ClaimResponse factory — only the fields the derivation
// touches are populated. Everything else is a safe blank.
function leg(opts: {
  id: number;
  isDuplicate?: boolean;
  includedInDispute?: boolean;
  verdict?: { outcome: string; source: string; createdAt?: string } | null;
  draft?: { outcome: string; createdAt?: string } | null;
}): ClaimResponse {
  // `outcomeRole()` reads `duplicateOfClaimId` + `sopOutcome` to
  // classify the leg. We feed the predicate directly rather than
  // stubbing the helper.
  const r: Partial<ClaimResponse> = {
    id: opts.id,
    confNumber: `C${opts.id}`,
    status: "Awaiting" as ClaimResponse["status"],
    outcome: "" as ClaimResponse["outcome"],
    includedInDispute: opts.includedInDispute ?? true,
    sopOutcome: "portal_dispute" as ClaimResponse["sopOutcome"],
    duplicateOfClaimId: opts.isDuplicate ? 999 : null,
    latestVerdict: opts.verdict
      ? ({
          id: 1,
          claimId: opts.id,
          source: opts.verdict.source,
          outcome: opts.verdict.outcome,
          createdAt: opts.verdict.createdAt ?? new Date().toISOString(),
        } as ClaimVerdictResponse)
      : null,
    latestDraft: opts.draft
      ? ({
          id: 2,
          claimId: opts.id,
          source: "operator_draft",
          outcome: opts.draft.outcome,
          createdAt: opts.draft.createdAt ?? new Date().toISOString(),
        } as ClaimVerdictResponse)
      : null,
  };
  return r as ClaimResponse;
}

test("deriveVerdictMix — empty rides → no_verdicts_yet", () => {
  const d = deriveVerdictMix([]);
  assert.equal(d.mix, "no_verdicts_yet");
  assert.equal(d.total, 0);
  assert.equal(d.allLegsHaveVerdict, false);
});

test("deriveVerdictMix — every leg pending → no_verdicts_yet", () => {
  const d = deriveVerdictMix([leg({ id: 1 }), leg({ id: 2 })]);
  assert.equal(d.mix, "no_verdicts_yet");
  assert.equal(d.pendingCount, 2);
  assert.equal(d.allLegsHaveVerdict, false);
});

test("deriveVerdictMix — all approved (operator_confirmed) → all_approved", () => {
  const d = deriveVerdictMix([
    leg({ id: 1, verdict: { outcome: "Approved", source: "operator_confirmed" } }),
    leg({ id: 2, verdict: { outcome: "Partially Approved", source: "operator_confirmed" } }),
  ]);
  assert.equal(d.mix, "all_approved");
  assert.equal(d.approvedCount, 2);
  assert.equal(d.allLegsHaveVerdict, true);
});

test("deriveVerdictMix — all denied → all_denied", () => {
  const d = deriveVerdictMix([
    leg({ id: 1, verdict: { outcome: "Denied", source: "operator_confirmed" } }),
    leg({ id: 2, verdict: { outcome: "Denied", source: "operator_confirmed" } }),
  ]);
  assert.equal(d.mix, "all_denied");
  assert.equal(d.deniedCount, 2);
  assert.equal(d.allLegsHaveVerdict, true);
});

test("deriveVerdictMix — confirmed approved + confirmed denied → mixed", () => {
  const d = deriveVerdictMix([
    leg({ id: 1, verdict: { outcome: "Approved", source: "operator_confirmed" } }),
    leg({ id: 2, verdict: { outcome: "Denied", source: "operator_confirmed" } }),
  ]);
  assert.equal(d.mix, "mixed");
  assert.equal(d.approvedCount, 1);
  assert.equal(d.deniedCount, 1);
  assert.equal(d.allLegsHaveVerdict, true);
});

test("deriveVerdictMix — partial coverage with one confirmed → mixed (gate uses allLegsHaveVerdict)", () => {
  const d = deriveVerdictMix([
    leg({ id: 1, verdict: { outcome: "Approved", source: "operator_confirmed" } }),
    leg({ id: 2 }),
  ]);
  assert.equal(d.mix, "mixed");
  assert.equal(d.allLegsHaveVerdict, false);
  assert.equal(d.pendingCount, 1);
});

test("deriveVerdictMix — AI-only verdicts don't count as confirmed", () => {
  const d = deriveVerdictMix([
    leg({ id: 1, verdict: { outcome: "Approved", source: "ai_suggested" } }),
  ]);
  assert.equal(d.mix, "no_verdicts_yet");
  assert.equal(d.pendingCount, 1);
});

// ─── Task #343: drafts count toward the Step 4 unlock ────────────────

test("deriveVerdictMix — operator_draft counts as a selection (Approved)", () => {
  const d = deriveVerdictMix([
    leg({ id: 1, draft: { outcome: "Approved" } }),
    leg({ id: 2, draft: { outcome: "Approved" } }),
  ]);
  assert.equal(d.mix, "all_approved");
  assert.equal(d.approvedCount, 2);
  assert.equal(d.pendingCount, 0);
  assert.equal(d.allLegsHaveVerdict, true);
});

test("deriveVerdictMix — operator_draft counts as a selection (Denied)", () => {
  const d = deriveVerdictMix([
    leg({ id: 1, draft: { outcome: "Denied" } }),
    leg({ id: 2, draft: { outcome: "Denied" } }),
  ]);
  assert.equal(d.mix, "all_denied");
  assert.equal(d.deniedCount, 2);
  assert.equal(d.allLegsHaveVerdict, true);
});

test("deriveVerdictMix — mixed drafts → mixed", () => {
  const d = deriveVerdictMix([
    leg({ id: 1, draft: { outcome: "Approved" } }),
    leg({ id: 2, draft: { outcome: "Denied" } }),
  ]);
  assert.equal(d.mix, "mixed");
  assert.equal(d.approvedCount, 1);
  assert.equal(d.deniedCount, 1);
  assert.equal(d.allLegsHaveVerdict, true);
});

test("deriveVerdictMix — drafts and confirmed verdicts both unlock Step 4", () => {
  // Mixed-history group: one leg has only a draft, the other only a
  // confirmed verdict. Both count → allLegsHaveVerdict is true and
  // the mix reflects the combined outcomes.
  const d = deriveVerdictMix([
    leg({ id: 1, draft: { outcome: "Approved" } }),
    leg({ id: 2, verdict: { outcome: "Approved", source: "operator_confirmed" } }),
  ]);
  assert.equal(d.mix, "all_approved");
  assert.equal(d.approvedCount, 2);
  assert.equal(d.allLegsHaveVerdict, true);
});

test("deriveVerdictMix — newer draft wins over older confirmed verdict", () => {
  // Operator confirmed Approved, then re-drafted Denied later. The
  // newer draft is what counts toward the mix.
  const d = deriveVerdictMix([
    leg({
      id: 1,
      verdict: {
        outcome: "Approved",
        source: "operator_confirmed",
        createdAt: "2026-05-01T10:00:00Z",
      },
      draft: { outcome: "Denied", createdAt: "2026-05-02T10:00:00Z" },
    }),
  ]);
  assert.equal(d.mix, "all_denied");
  assert.equal(d.deniedCount, 1);
  assert.equal(d.approvedCount, 0);
});

test("deriveVerdictMix — older draft loses to newer confirmed verdict", () => {
  const d = deriveVerdictMix([
    leg({
      id: 1,
      draft: { outcome: "Approved", createdAt: "2026-05-01T10:00:00Z" },
      verdict: {
        outcome: "Denied",
        source: "operator_confirmed",
        createdAt: "2026-05-02T10:00:00Z",
      },
    }),
  ]);
  assert.equal(d.mix, "all_denied");
});

test("deriveVerdictMix — partial coverage (some drafts, some pending) → mixed/no-unlock", () => {
  const d = deriveVerdictMix([
    leg({ id: 1, draft: { outcome: "Approved" } }),
    leg({ id: 2 }),
  ]);
  assert.equal(d.mix, "mixed");
  assert.equal(d.allLegsHaveVerdict, false);
  assert.equal(d.pendingCount, 1);
});

test("isActionableLeg — duplicates + excluded legs are filtered out", () => {
  assert.equal(isActionableLeg(leg({ id: 1, isDuplicate: true })), false);
  assert.equal(isActionableLeg(leg({ id: 2, includedInDispute: false })), false);
  assert.equal(isActionableLeg(leg({ id: 3 })), true);
});

test("deriveVerdictMix — duplicates and excluded legs do not appear in counts", () => {
  const d = deriveVerdictMix([
    leg({ id: 1, verdict: { outcome: "Approved", source: "operator_confirmed" } }),
    leg({ id: 2, isDuplicate: true, verdict: { outcome: "Denied", source: "operator_confirmed" } }),
    leg({ id: 3, includedInDispute: false }),
  ]);
  assert.equal(d.total, 1);
  assert.equal(d.approvedCount, 1);
  assert.equal(d.deniedCount, 0);
  assert.equal(d.mix, "all_approved");
});

function response(receivedAt: string, metadata: Record<string, unknown> | null): PortalResponseItem {
  return {
    id: Math.floor(Math.random() * 1e9),
    claimId: 1,
    receivedAt,
    metadata: metadata as PortalResponseItem["metadata"],
  } as unknown as PortalResponseItem;
}

test("pickSuggestedNewInvoiceNumber — returns the freshest non-empty value", () => {
  const v = pickSuggestedNewInvoiceNumber([
    response("2026-04-01T00:00:00Z", { newInvoiceNumber: "OLD-1" }),
    response("2026-05-01T00:00:00Z", { newInvoiceNumber: "  NEW-7  " }),
  ]);
  assert.equal(v, "NEW-7");
});

test("pickSuggestedNewInvoiceNumber — null when missing or blank", () => {
  assert.equal(pickSuggestedNewInvoiceNumber(undefined), null);
  assert.equal(pickSuggestedNewInvoiceNumber([]), null);
  assert.equal(pickSuggestedNewInvoiceNumber([response("2026-05-01T00:00:00Z", null)]), null);
  assert.equal(
    pickSuggestedNewInvoiceNumber([response("2026-05-01T00:00:00Z", { newInvoiceNumber: "   " })]),
    null,
  );
});

test("pickSuggestedPayorDenialReason — returns the freshest code", () => {
  const v = pickSuggestedPayorDenialReason([
    response("2026-04-01T00:00:00Z", { suggestedPayorDenialReason: "payor_other" }),
    response("2026-05-01T00:00:00Z", { suggestedPayorDenialReason: "payor_rejected_gps" }),
  ]);
  assert.equal(v, "payor_rejected_gps");
});

test("isAwaitingPayorAgain — true only when stamp is set", () => {
  const g0 = { awaitingPayorAgainAt: null } as unknown as InvoiceGroupResponse;
  const g1 = { awaitingPayorAgainAt: "2026-05-01T00:00:00Z" } as unknown as InvoiceGroupResponse;
  assert.equal(isAwaitingPayorAgain(g0), false);
  assert.equal(isAwaitingPayorAgain(g1), true);
});
