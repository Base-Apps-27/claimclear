import { test } from "node:test";
import { strict as assert } from "node:assert";

import {
  lintDraft,
  requiredEvidenceNodeIdsFromTree,
  type LintSubmission,
  type LintClaim,
  type LintEvidence,
  type LintLeg,
} from "../lib/draft-lint";

const baseClaim: LintClaim = { confNumber: null, claimAmount: null };

function makeSubmission(descriptionHtml: string, confNumber: string | null = null): LintSubmission {
  return { descriptionHtml, confNumber, attachmentUrls: null };
}

test("single confirmation number present passes the conf-number check", () => {
  const sub = makeSubmission("<p>Conf #14879280 — please review.</p>", "14879280");
  const results = lintDraft(sub, baseClaim, []);
  assert.equal(results.find((r) => r.ruleKey === "missing_conf_number"), undefined);
});

test("single confirmation number missing produces a fail listing that number", () => {
  const sub = makeSubmission("<p>No reference here.</p>", "14879280");
  const results = lintDraft(sub, baseClaim, []);
  const r = results.find((r) => r.ruleKey === "missing_conf_number");
  assert.ok(r, "expected missing_conf_number result");
  assert.equal(r!.severity, "fail");
  assert.match(r!.message, /14879280/);
});

test("multiple confirmation numbers all present (comma + 'and' phrasing) passes", () => {
  const sub = makeSubmission(
    "<p>Conf #14879280 and Conf #14879277 are addressed below.</p>",
    "14879280, 14879277",
  );
  const results = lintDraft(sub, baseClaim, []);
  assert.equal(results.find((r) => r.ruleKey === "missing_conf_number"), undefined);
});

test("multiple confirmation numbers separated by newline + 'Conf #' prefix passes", () => {
  const sub = makeSubmission(
    "<p>Conf #14879280</p><p>Conf #14879277</p><p>Conf #14879299</p>",
    "14879280; 14879277 and 14879299",
  );
  const results = lintDraft(sub, baseClaim, []);
  assert.equal(results.find((r) => r.ruleKey === "missing_conf_number"), undefined);
});

test("multiple confirmation numbers with one missing lists only the missing one", () => {
  const sub = makeSubmission(
    "<p>Conf #14879280 — only one of them is here.</p>",
    "14879280, 14879277",
  );
  const results = lintDraft(sub, baseClaim, []);
  const r = results.find((r) => r.ruleKey === "missing_conf_number");
  assert.ok(r, "expected missing_conf_number result");
  assert.equal(r!.severity, "fail");
  assert.match(r!.message, /14879277/);
  assert.doesNotMatch(r!.message, /14879280/);
});

test("multiple confirmation numbers with several missing lists all of them", () => {
  const sub = makeSubmission(
    "<p>Only 14879280 appears in this write-up.</p>",
    "14879280, 14879277, 14879299",
  );
  const results = lintDraft(sub, baseClaim, []);
  const r = results.find((r) => r.ruleKey === "missing_conf_number");
  assert.ok(r, "expected missing_conf_number result");
  assert.match(r!.message, /14879277/);
  assert.match(r!.message, /14879299/);
  assert.doesNotMatch(r!.message, /\b14879280\b/);
});

test("no configured confirmation number falls back to text scan and passes when one is present", () => {
  const sub = makeSubmission("<p>Reference number 14879280 included.</p>", null);
  const results = lintDraft(sub, baseClaim, []);
  assert.equal(results.find((r) => r.ruleKey === "missing_conf_number"), undefined);
});

test("no configured confirmation number and none in description fails with the fallback message", () => {
  const sub = makeSubmission("<p>Just some narrative text.</p>", null);
  const results = lintDraft(sub, baseClaim, []);
  const r = results.find((r) => r.ruleKey === "missing_conf_number");
  assert.ok(r, "expected missing_conf_number result");
  assert.equal(r!.severity, "fail");
  assert.match(r!.message, /No confirmation number/i);
});

test("confirmation number is not matched as a substring of a longer digit run", () => {
  const sub = makeSubmission("<p>Reference 148792801234 is unrelated.</p>", "14879280");
  const results = lintDraft(sub, baseClaim, []);
  const r = results.find((r) => r.ruleKey === "missing_conf_number");
  assert.ok(r, "expected missing_conf_number result when only a longer number is present");
  assert.match(r!.message, /14879280/);
});

test("claim-level conf number is used when submission conf number is empty", () => {
  const sub = makeSubmission("<p>Conf #14879280 noted.</p>", null);
  const claim: LintClaim = { confNumber: "14879280", claimAmount: null };
  const results = lintDraft(sub, claim, []);
  assert.equal(results.find((r) => r.ruleKey === "missing_conf_number"), undefined);
});

// --- demoted keyword family (Task #707) ----------------------------------
//
// The keyword matcher used to fire as `warn` and gate the submission. Now
// that the structural rules carry the real ground truth, the matcher is
// demoted to `info` and the GPS / screenshot keywords are retired entirely
// (the structural `requires_evidence_node` rule covers their intent).

test("retired keywords (gps, screenshot) do not produce any lint result", () => {
  const sub = makeSubmission(
    "<p>Conf #14879280 — disputing the Incomplete GPS flag; screenshot attached.</p>",
    "14879280",
  );
  const results = lintDraft(sub, baseClaim, []);
  assert.equal(
    results.find((r) => r.ruleKey.startsWith("unattached_evidence:GPS")),
    undefined,
    "GPS keyword family was retired in Task #707",
  );
  assert.equal(
    results.find((r) => r.ruleKey.startsWith("unattached_evidence:screenshot")),
    undefined,
    "screenshot keyword family was retired in Task #707",
  );
});

test("surviving keyword (manifest) is now advisory `info` severity", () => {
  const sub = makeSubmission("<p>Conf #14879280 — see attached manifest.</p>", "14879280");
  const results = lintDraft(sub, baseClaim, []);
  const r = results.find((r) => r.ruleKey === "unattached_evidence:manifest");
  assert.ok(r, "manifest keyword should still fire as advisory");
  assert.equal(r!.severity, "info", "demoted from warn to info in Task #707");
});

// --- structural rule: requires evidence node -----------------------------

const errorTypeTree = {
  rootId: "n1",
  nodes: [
    {
      id: "n1",
      question: "Did the bot capture the GPS breadcrumb?",
      options: [],
      evidenceRequirements: [
        { key: "gps_breadcrumb", label: "GPS breadcrumb screenshot", required: true },
      ],
    },
    {
      id: "n2",
      question: "Optional follow-up",
      options: [],
      evidenceRequirements: [
        { key: "extra_note", label: "Optional note", required: false },
      ],
    },
  ],
};

test("requiredEvidenceNodeIdsFromTree returns only nodes whose requirements are required:true", () => {
  assert.deepEqual(requiredEvidenceNodeIdsFromTree(errorTypeTree), ["n1"]);
  assert.deepEqual(requiredEvidenceNodeIdsFromTree(null), []);
  assert.deepEqual(requiredEvidenceNodeIdsFromTree({ nodes: [] }), []);
});

const disputingLeg = (overrides: Partial<LintLeg> = {}): LintLeg => ({
  id: 101,
  confNumber: "15004552",
  errorTypeId: "7",
  errorTypeName: "Incomplete GPS",
  disposition: "disposed_portal",
  sopOutcome: "portal_dispute",
  includedInDispute: true,
  requiredEvidenceNodeIds: ["n1"],
  ...overrides,
});

test("structural rule: errorType requires evidence node BUT no claim_evidence carries that tree_node_id → fail", () => {
  const sub = makeSubmission(
    "<p>Conf #15004552 — disputing.</p>",
    "15004552",
  );
  const evidence: LintEvidence[] = [
    { evidenceTypeName: "ev_1", imageUrl: "/objects/uploads/abc", notes: null, treeNodeId: null, claimId: 101 },
  ];
  const results = lintDraft(sub, baseClaim, evidence, { legs: [disputingLeg()] });
  const r = results.find((r) => r.ruleKey.startsWith("structural_missing_evidence_node:"));
  assert.ok(r, "expected structural_missing_evidence_node fail");
  assert.equal(r!.severity, "fail");
  assert.match(r!.message, /n1/);
  assert.match(r!.message, /Incomplete GPS/);
});

test("structural rule: requirement satisfied when an evidence row carries the matching tree_node_id", () => {
  const sub = makeSubmission(
    "<p>Conf #15004552 — disputing.</p>",
    "15004552",
  );
  const evidence: LintEvidence[] = [
    { evidenceTypeName: "ev_1", imageUrl: "/objects/uploads/gps.png", notes: null, treeNodeId: "n1", claimId: 101 },
  ];
  const results = lintDraft(sub, baseClaim, evidence, { legs: [disputingLeg()] });
  assert.equal(
    results.find((r) => r.ruleKey.startsWith("structural_missing_evidence_node:")),
    undefined,
    "row with matching treeNodeId should satisfy the structural rule",
  );
});

test("structural rule: group-scoped evidence (claimId null) counts for every leg", () => {
  const sub = makeSubmission(
    "<p>Conf #15004552 — disputing.</p>",
    "15004552",
  );
  const evidence: LintEvidence[] = [
    { evidenceTypeName: "ev_1", imageUrl: "/objects/uploads/gps.png", notes: null, treeNodeId: "n1", claimId: null },
  ];
  const results = lintDraft(sub, baseClaim, evidence, { legs: [disputingLeg()] });
  assert.equal(
    results.find((r) => r.ruleKey.startsWith("structural_missing_evidence_node:")),
    undefined,
  );
});

test("structural rule: leg with includedInDispute=false is exempt from required-evidence check", () => {
  const sub = makeSubmission("<p>Conf #15004552 noted.</p>", "15004552");
  const results = lintDraft(sub, baseClaim, [], {
    legs: [disputingLeg({ includedInDispute: false })],
  });
  assert.equal(
    results.find((r) => r.ruleKey.startsWith("structural_missing_evidence_node:")),
    undefined,
  );
});

// --- structural rule: disposition without terminal -----------------------

test("structural rule: disposition disposed_portal without terminal sopOutcome → fail", () => {
  const sub = makeSubmission("<p>Conf #15004552 noted.</p>", "15004552");
  const leg = disputingLeg({ sopOutcome: "hold", requiredEvidenceNodeIds: [] });
  const results = lintDraft(sub, baseClaim, [], { legs: [leg] });
  const r = results.find((r) => r.ruleKey.startsWith("structural_disposition_without_terminal:"));
  assert.ok(r, "expected structural_disposition_without_terminal fail");
  assert.equal(r!.severity, "fail");
  assert.match(r!.message, /15004552/);
});

test("structural rule: disposition disposed_portal WITH portal_dispute outcome passes", () => {
  const sub = makeSubmission("<p>Conf #15004552 noted.</p>", "15004552");
  const leg = disputingLeg({ sopOutcome: "portal_dispute", requiredEvidenceNodeIds: [] });
  const results = lintDraft(sub, baseClaim, [], { legs: [leg] });
  assert.equal(
    results.find((r) => r.ruleKey.startsWith("structural_disposition_without_terminal:")),
    undefined,
  );
});

test("structural rule: pre-submit dispositions (classifying) do not fire the terminal rule", () => {
  const sub = makeSubmission("<p>Conf #15004552 noted.</p>", "15004552");
  const leg = disputingLeg({ disposition: "classifying", sopOutcome: null, requiredEvidenceNodeIds: [] });
  const results = lintDraft(sub, baseClaim, [], { legs: [leg] });
  assert.equal(
    results.find((r) => r.ruleKey.startsWith("structural_disposition_without_terminal:")),
    undefined,
    "the rule is scoped to legs that have already crossed into a disputing disposition",
  );
});

// --- structural rule: disputed leg bare of evidence AND prose ------------

test("structural rule: disputed leg with zero attachments AND no conf mention → fail", () => {
  const sub = makeSubmission("<p>Generic narrative without any numbers.</p>", "15004552");
  const leg = disputingLeg({ requiredEvidenceNodeIds: [] });
  const results = lintDraft(sub, baseClaim, [], { legs: [leg] });
  const r = results.find((r) => r.ruleKey.startsWith("structural_disputed_leg_bare:"));
  assert.ok(r, "expected structural_disputed_leg_bare fail");
  assert.equal(r!.severity, "fail");
  assert.match(r!.message, /15004552/);
});

test("structural rule: disputed leg with attachments suppresses the bare-leg rule", () => {
  const sub = makeSubmission("<p>Generic narrative without any numbers.</p>", "15004552");
  const leg = disputingLeg({ requiredEvidenceNodeIds: [] });
  const evidence: LintEvidence[] = [
    { evidenceTypeName: "ev_1", imageUrl: "/objects/uploads/abc", notes: null, treeNodeId: null, claimId: 101 },
  ];
  const results = lintDraft(sub, baseClaim, evidence, { legs: [leg] });
  assert.equal(
    results.find((r) => r.ruleKey.startsWith("structural_disputed_leg_bare:")),
    undefined,
  );
});

test("structural rule: disputed leg mentioned by conf number in prose suppresses the bare-leg rule", () => {
  const sub = makeSubmission(
    "<p>Conf #15004552 was completed as scheduled — see notes.</p>",
    "15004552",
  );
  const leg = disputingLeg({ requiredEvidenceNodeIds: [] });
  const results = lintDraft(sub, baseClaim, [], { legs: [leg] });
  assert.equal(
    results.find((r) => r.ruleKey.startsWith("structural_disputed_leg_bare:")),
    undefined,
  );
});

// --- production-shape regression: invoice 1864796540 / conf 15004552 ----
//
// The original false positive came from the keyword family firing a `warn`
// on the GPS keyword when the SOP runner had attached opaque-named rows.
// Re-asserting that NEITHER the (now-retired) keyword family NOR the new
// structural rules turn this shape into a fail or a warn.

test("regression: production shape (invoice 1864796540 / conf 15004552) still passes silently", () => {
  const sub = makeSubmission(
    "<p>Conf #15004552 — disputing the Incomplete GPS flag; breadcrumb data attached.</p>",
    "15004552",
  );
  const evidence: LintEvidence[] = [
    { evidenceTypeName: "ev_1776176562945", imageUrl: "/objects/uploads/abc", notes: null, treeNodeId: "n1", claimId: 101 },
    { evidenceTypeName: "ev_1776176572894", imageUrl: "/objects/uploads/def", notes: null, treeNodeId: "n1", claimId: 101 },
    { evidenceTypeName: "ev_1776176581435", imageUrl: "/objects/uploads/ghi", notes: null, treeNodeId: "n1", claimId: 101 },
  ];
  const results = lintDraft(sub, baseClaim, evidence, { legs: [disputingLeg()] });
  const blocking = results.filter((r) => r.severity === "fail" || r.severity === "warn");
  assert.deepEqual(blocking, [], "production shape must not produce any fail/warn results");
});
