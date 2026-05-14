import { test } from "node:test";
import { strict as assert } from "node:assert";

import {
  lintDraft,
  requiredEvidenceNodeIdsForWalk,
  type LintSubmission,
  type LintClaim,
  type LintEvidence,
  type LintLeg,
} from "../lib/draft-lint";

const baseClaim: LintClaim = { confNumber: null, claimAmount: null };

function makeSubmission(descriptionHtml: string, confNumber: string | null = null): LintSubmission {
  return { descriptionHtml, confNumber, attachmentUrls: null };
}

// --- Task #708: per-leg confirmation-number coverage --------------------
//
// When the caller threads leg context, the legacy `missing_conf_number`
// rule is replaced by `missing_conf_number_for_leg:<legId>`, which
// requires each contestable leg's conf to appear somewhere in the
// description. (The earlier "give it its own paragraph" sub-rule was
// removed 2026-05-14 — the portal does not need dedicated paragraphs
// to attribute prose, and the rule was blocking valid write-ups.)
// Tests that pass NO leg context exercise the legacy fallback and keep
// using the original rule key.

const confLeg = (id: number, confNumber: string, overrides: Partial<LintLeg> = {}): LintLeg => ({
  id,
  confNumber,
  errorTypeId: "7",
  errorTypeName: "Incomplete GPS",
  disposition: "disposed_portal",
  sopOutcome: "portal_dispute",
  includedInDispute: true,
  requiredEvidenceNodeIds: [],
  ...overrides,
});

test("per-leg back-compat: single leg whose conf appears in its own paragraph passes", () => {
  const sub = makeSubmission("<p>Conf #14879280 — please review.</p>", "14879280");
  const results = lintDraft(sub, baseClaim, [], { legs: [confLeg(1, "14879280")] });
  assert.equal(
    results.find((r) => r.ruleKey.startsWith("missing_conf_number_for_leg:")),
    undefined,
  );
  assert.equal(results.find((r) => r.ruleKey === "missing_conf_number"), undefined,
    "legacy rule must not double-fire when the per-leg form is active");
});

test("per-leg: single leg whose conf is absent fails with a key/message naming the leg", () => {
  const sub = makeSubmission("<p>No reference here.</p>", "14879280");
  const results = lintDraft(sub, baseClaim, [], { legs: [confLeg(1, "14879280")] });
  const r = results.find((r) => r.ruleKey === "missing_conf_number_for_leg:1");
  assert.ok(r, "expected missing_conf_number_for_leg:1 result");
  assert.equal(r!.severity, "fail");
  assert.match(r!.message, /14879280/);
});

test("per-leg: multi-leg with each conf in its own paragraph passes", () => {
  const sub = makeSubmission(
    "<p>Conf #14879280 — disputing.</p><p>Conf #14879277 — disputing.</p><p>Conf #14879299 — disputing.</p>",
    "14879280; 14879277; 14879299",
  );
  const results = lintDraft(sub, baseClaim, [], {
    legs: [
      confLeg(1, "14879280"),
      confLeg(2, "14879277"),
      confLeg(3, "14879299"),
    ],
  });
  assert.equal(
    results.find((r) => r.ruleKey.startsWith("missing_conf_number_for_leg:")),
    undefined,
    "every leg has a uniquely-attributing paragraph; nothing should fire",
  );
});

test("per-leg: multi-leg with two confs in the same paragraph and one missing fails for the missing leg", () => {
  // Legs 1 and 2 are squashed together in one paragraph; leg 3 is absent
  // entirely. The missing leg must be reported by its dedicated key.
  const sub = makeSubmission(
    "<p>Conf #14879280 and Conf #14879277 — both addressed.</p>",
    "14879280; 14879277; 14879299",
  );
  const results = lintDraft(sub, baseClaim, [], {
    legs: [
      confLeg(1, "14879280"),
      confLeg(2, "14879277"),
      confLeg(3, "14879299"),
    ],
  });
  const missing = results.find((r) => r.ruleKey === "missing_conf_number_for_leg:3");
  assert.ok(missing, "expected missing_conf_number_for_leg:3 for the absent leg");
  assert.equal(missing!.severity, "fail");
  assert.match(missing!.message, /14879299/);
  assert.doesNotMatch(missing!.message, /not mentioned[^.]*14879280/);
});

test("per-leg: two confs sharing a single paragraph passes (the 'own paragraph' branch was removed 2026-05-14)", () => {
  // Pin the post-2026-05-14 behavior: the portal does not require a
  // dedicated paragraph per leg to attribute prose, so a write-up that
  // names two confs in the same paragraph must NOT be blocked. The
  // earlier rule fired here and surfaced the "Submission blocked: give
  // it its own paragraph" dialog on legitimate write-ups.
  const sub = makeSubmission(
    "<p>Conf #14879280 and Conf #14879277 are both addressed below.</p>",
    "14879280; 14879277",
  );
  const results = lintDraft(sub, baseClaim, [], {
    legs: [confLeg(1, "14879280"), confLeg(2, "14879277")],
  });
  assert.equal(
    results.find((r) => r.ruleKey.startsWith("missing_conf_number_for_leg:")),
    undefined,
    "shared-paragraph attribution must not fire the per-leg rule",
  );
});

test("per-leg: substring-of-longer-digit-run guard — leg fails when only a superstring appears", () => {
  const sub = makeSubmission("<p>Reference 148792801234 is unrelated.</p>", "14879280");
  const results = lintDraft(sub, baseClaim, [], { legs: [confLeg(1, "14879280")] });
  const r = results.find((r) => r.ruleKey === "missing_conf_number_for_leg:1");
  assert.ok(r, "expected per-leg fail when only a longer digit run is present");
  assert.match(r!.message, /14879280/);
});

test("per-leg: legs with includedInDispute=false are exempt from the conf-coverage check", () => {
  const sub = makeSubmission("<p>Conf #14879280 — disputing.</p>", "14879280; 14879277");
  const results = lintDraft(sub, baseClaim, [], {
    legs: [
      confLeg(1, "14879280"),
      confLeg(2, "14879277", { includedInDispute: false }),
    ],
  });
  assert.equal(
    results.find((r) => r.ruleKey.startsWith("missing_conf_number_for_leg:")),
    undefined,
    "the excluded leg must not fire the per-leg rule",
  );
});

// --- Legacy fallback (no leg context) -----------------------------------
//
// Older callers and the keyword-only tests pass no leg context; for them
// the legacy `missing_conf_number` rule still runs unchanged.

test("legacy fallback: no configured confirmation number falls back to text scan and passes when one is present", () => {
  const sub = makeSubmission("<p>Reference number 14879280 included.</p>", null);
  const results = lintDraft(sub, baseClaim, []);
  assert.equal(results.find((r) => r.ruleKey === "missing_conf_number"), undefined);
});

test("legacy fallback: no configured confirmation number and none in description fails with the fallback message", () => {
  const sub = makeSubmission("<p>Just some narrative text.</p>", null);
  const results = lintDraft(sub, baseClaim, []);
  const r = results.find((r) => r.ruleKey === "missing_conf_number");
  assert.ok(r, "expected missing_conf_number result");
  assert.equal(r!.severity, "fail");
  assert.match(r!.message, /No confirmation number/i);
});

test("legacy fallback: claim-level conf number is used when submission conf number is empty", () => {
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

test("requiredEvidenceNodeIdsForWalk returns only visited nodes whose requirements are required:true", () => {
  // Walk visits n1 — n1 has required evidence — should be returned.
  assert.deepEqual(requiredEvidenceNodeIdsForWalk(errorTypeTree, ["n1"]), ["n1"]);
  // Walk visits only n2 — n2's evidence is required:false — empty set.
  assert.deepEqual(requiredEvidenceNodeIdsForWalk(errorTypeTree, ["n2"]), []);
  // Walk visits both — only n1 carries required evidence.
  assert.deepEqual(requiredEvidenceNodeIdsForWalk(errorTypeTree, ["n1", "n2"]), ["n1"]);
  // Defensive shapes — null tree, no nodes, etc.
  assert.deepEqual(requiredEvidenceNodeIdsForWalk(null, ["n1"]), []);
  assert.deepEqual(requiredEvidenceNodeIdsForWalk({ nodes: [] }, ["n1"]), []);
  // Legacy: no recorded walk → empty set so the rule is a no-op for the leg.
  assert.deepEqual(requiredEvidenceNodeIdsForWalk(errorTypeTree, null), []);
  assert.deepEqual(requiredEvidenceNodeIdsForWalk(errorTypeTree, undefined), []);
  assert.deepEqual(requiredEvidenceNodeIdsForWalk(errorTypeTree, []), []);
});

// --- Task #735: walked-path scoping for the structural required-evidence
// rule. The decision tree below has two terminals (B and C), each with
// their own required evidence. The operator only ever walks one terminal
// per leg, so unvisited terminals must not impose upload requirements.

const branchingErrorTypeTree = {
  rootId: "A",
  nodes: [
    // Pure question node — no required evidence.
    { id: "A", question: "Did the GPS report?", options: [], evidenceRequirements: [] },
    // Visited terminal — requires a screenshot.
    {
      id: "B",
      question: "Terminal: dispute with screenshot",
      options: [],
      evidenceRequirements: [
        { key: "screenshot", label: "GPS screenshot", required: true },
      ],
    },
    // Sibling terminal the walk never touches — also has required evidence.
    {
      id: "C",
      question: "Terminal: dispute with manifest",
      options: [],
      evidenceRequirements: [
        { key: "manifest", label: "Manifest", required: true },
      ],
    },
  ],
};

function legWithWalk(visited: string[], required: string[], overrides: Partial<LintLeg> = {}): LintLeg {
  return {
    id: 202,
    confNumber: "15020423",
    errorTypeId: "9",
    errorTypeName: "GPS Deviation Status",
    disposition: "disposed_portal",
    sopOutcome: "portal_dispute",
    sopNodeId: visited[visited.length - 1] ?? null,
    sopAnswerNodeIds: visited.slice(0, -1),
    includedInDispute: true,
    requiredEvidenceNodeIds: required,
    ...overrides,
  };
}

test("Task #735: walk visits A then B; B requires evidence and it's attached → no finding", () => {
  const required = requiredEvidenceNodeIdsForWalk(branchingErrorTypeTree, ["A", "B"]);
  assert.deepEqual(required, ["B"]);
  const sub = makeSubmission("<p>Conf #15020423 — disputing.</p>", "15020423");
  const evidence: LintEvidence[] = [
    { evidenceTypeName: "GPS screenshot", imageUrl: "/objects/uploads/gps.png", notes: null, treeNodeId: "B", claimId: 202 },
  ];
  const results = lintDraft(sub, baseClaim, evidence, { legs: [legWithWalk(["A", "B"], required)] });
  assert.equal(
    results.find((r) => r.ruleKey.startsWith("structural_missing_evidence_node:")),
    undefined,
  );
});

test("Task #735: walk visits A then B; B requires evidence but it's missing → fail names ONLY B", () => {
  const required = requiredEvidenceNodeIdsForWalk(branchingErrorTypeTree, ["A", "B"]);
  const sub = makeSubmission("<p>Conf #15020423 — disputing.</p>", "15020423");
  const results = lintDraft(sub, baseClaim, [], { legs: [legWithWalk(["A", "B"], required)] });
  const r = results.find((r) => r.ruleKey.startsWith("structural_missing_evidence_node:"));
  assert.ok(r, "expected structural_missing_evidence_node fail");
  assert.equal(r!.severity, "fail");
  assert.match(r!.message, /\bB\b/);
  assert.doesNotMatch(r!.message, /\bC\b/, "sibling-terminal node id must not appear");
});

test("Task #735: walk only touches a node with no required evidence → no finding", () => {
  const required = requiredEvidenceNodeIdsForWalk(branchingErrorTypeTree, ["A"]);
  assert.deepEqual(required, []);
  const sub = makeSubmission("<p>Conf #15020423 — disputing.</p>", "15020423");
  const results = lintDraft(sub, baseClaim, [], { legs: [legWithWalk(["A"], required)] });
  assert.equal(
    results.find((r) => r.ruleKey.startsWith("structural_missing_evidence_node:")),
    undefined,
  );
});

test("Task #735: tree has terminal C with required evidence the walk never touched → no finding for C", () => {
  // Even with zero attachments, sibling terminal C must not trip the gate
  // because the operator never visited it.
  const required = requiredEvidenceNodeIdsForWalk(branchingErrorTypeTree, ["A", "B"]);
  const sub = makeSubmission("<p>Conf #15020423 — disputing.</p>", "15020423");
  const evidence: LintEvidence[] = [
    { evidenceTypeName: "GPS screenshot", imageUrl: "/objects/uploads/gps.png", notes: null, treeNodeId: "B", claimId: 202 },
  ];
  const results = lintDraft(sub, baseClaim, evidence, { legs: [legWithWalk(["A", "B"], required)] });
  const findings = results.filter((r) => r.ruleKey.startsWith("structural_missing_evidence_node:"));
  assert.deepEqual(findings, [], "sibling terminal C must not produce a finding");
});

test("Task #735: leg with no recorded walk (legacy) → no finding (intentional no-op)", () => {
  // No sopAnswers, no sopNodeId — the helper returns []. We document this
  // as an intentional safety choice in the helper's comment.
  const required = requiredEvidenceNodeIdsForWalk(branchingErrorTypeTree, null);
  assert.deepEqual(required, []);
  const sub = makeSubmission("<p>Conf #15020423 — disputing.</p>", "15020423");
  const leg: LintLeg = {
    id: 303,
    confNumber: "15020423",
    errorTypeId: "9",
    errorTypeName: "GPS Deviation Status",
    disposition: "disposed_portal",
    sopOutcome: "portal_dispute",
    sopNodeId: null,
    sopAnswerNodeIds: [],
    includedInDispute: true,
    requiredEvidenceNodeIds: required,
  };
  const results = lintDraft(sub, baseClaim, [], { legs: [leg] });
  assert.equal(
    results.find((r) => r.ruleKey.startsWith("structural_missing_evidence_node:")),
    undefined,
  );
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

// --- Task #709: prose ↔ attachment reconciliation -----------------------
//
// Two new rules fire on the four corners of (prose-mentions-attachment) ×
// (bot-will-upload-something):
//   prose+attached   → silent
//   prose+empty      → warn  (`prose_claims_attachment_but_none_uploadable`)
//   silent+attached  → info  (`unreferenced_attachment`)
//   silent+empty     → silent
// Plus an opaque-only guard so the second rule never lists `ev_<digits>`
// rows that have nothing else to display.

const PROSE_ATTACHMENT_PHRASES = [
  "see attached",
  "attached screenshot",
  "attached photo",
  "attached photograph",
  "attached picture",
  "attached image",
  "attached document",
  "attached file",
  "attached copy",
  "please find attached",
  "enclosed is",
  "enclosed are",
  "enclosed please find",
  "enclosed herewith",
];

test("Task #709 phrase set: every documented phrase triggers the prose-attachment rule when uploads are empty", () => {
  for (const phrase of PROSE_ATTACHMENT_PHRASES) {
    const sub = makeSubmission(`<p>Conf #14879280 — ${phrase} the manifest.</p>`, "14879280");
    const results = lintDraft(sub, baseClaim, []);
    const r = results.find((r) => r.ruleKey === "prose_claims_attachment_but_none_uploadable");
    assert.ok(r, `phrase "${phrase}" should trigger the rule`);
    assert.equal(r!.severity, "warn");
    assert.match(r!.message, new RegExp(phrase.replace(/\s+/g, "\\s+"), "i"));
  }
});

test("Task #709 corner: prose+attached → no reconciliation rule fires", () => {
  const sub = makeSubmission("<p>Conf #14879280 — see attached manifest.pdf.</p>", "14879280");
  const evidence: LintEvidence[] = [
    { evidenceTypeName: "Manifest", imageUrl: "/objects/uploads/manifest.pdf", notes: null, treeNodeId: null, claimId: null },
  ];
  const results = lintDraft(sub, baseClaim, evidence);
  assert.equal(results.find((r) => r.ruleKey === "prose_claims_attachment_but_none_uploadable"), undefined);
  assert.equal(results.find((r) => r.ruleKey === "unreferenced_attachment"), undefined);
});

test("Task #709 corner: prose+empty → warn fires", () => {
  const sub = makeSubmission("<p>Conf #14879280 — see attached screenshot.</p>", "14879280");
  const results = lintDraft(sub, baseClaim, []);
  const r = results.find((r) => r.ruleKey === "prose_claims_attachment_but_none_uploadable");
  assert.ok(r);
  assert.equal(r!.severity, "warn");
  assert.match(r!.message, /see attached/i);
});

test("Task #709: non-/objects/ URLs do not count as uploadable (warn still fires)", () => {
  const sub = makeSubmission("<p>Conf #14879280 — see attached screenshot.</p>", "14879280");
  const evidence: LintEvidence[] = [
    { evidenceTypeName: "Photo", imageUrl: "https://example.com/external.png", notes: null, treeNodeId: null, claimId: null },
  ];
  const results = lintDraft(sub, baseClaim, evidence);
  const r = results.find((r) => r.ruleKey === "prose_claims_attachment_but_none_uploadable");
  assert.ok(r, "off-/objects/ URLs are not uploadable, so the rule must still fire");
});

test("Task #709 corner: silent+attached → info fires listing each unreferenced file by human label", () => {
  const sub = makeSubmission("<p>Conf #14879280 — disputing the charge.</p>", "14879280");
  const evidence: LintEvidence[] = [
    { evidenceTypeName: "Trip Sheet", imageUrl: "/objects/uploads/trip-sheet.pdf", notes: null, treeNodeId: null, claimId: null },
    { evidenceTypeName: "Manifest", imageUrl: "/objects/uploads/manifest.pdf", notes: null, treeNodeId: null, claimId: null },
  ];
  const results = lintDraft(sub, baseClaim, evidence);
  const r = results.find((r) => r.ruleKey === "unreferenced_attachment");
  assert.ok(r, "expected unreferenced_attachment");
  assert.equal(r!.severity, "info");
  assert.match(r!.message, /Trip Sheet/);
  assert.match(r!.message, /Manifest/);
});

test("Task #709: prose mentioning a file by human label suppresses unreferenced_attachment for that row", () => {
  const sub = makeSubmission("<p>Conf #14879280 — Trip Sheet attached for review.</p>", "14879280");
  const evidence: LintEvidence[] = [
    { evidenceTypeName: "Trip Sheet", imageUrl: "/objects/uploads/abc", notes: null, treeNodeId: null, claimId: null },
  ];
  const results = lintDraft(sub, baseClaim, evidence);
  assert.equal(results.find((r) => r.ruleKey === "unreferenced_attachment"), undefined);
});

test("Task #709: prose mentioning the basename suppresses unreferenced_attachment", () => {
  const sub = makeSubmission("<p>Conf #14879280 — see manifest.pdf for details.</p>", "14879280");
  const evidence: LintEvidence[] = [
    { evidenceTypeName: "ev_1776176562945", imageUrl: "/objects/uploads/manifest.pdf", notes: null, treeNodeId: null, claimId: null },
  ];
  const results = lintDraft(sub, baseClaim, evidence);
  assert.equal(results.find((r) => r.ruleKey === "unreferenced_attachment"), undefined);
});

test("Task #709 corner: silent+empty → no reconciliation rule fires", () => {
  const sub = makeSubmission("<p>Conf #14879280 — disputing the charge.</p>", "14879280");
  const results = lintDraft(sub, baseClaim, []);
  assert.equal(results.find((r) => r.ruleKey === "prose_claims_attachment_but_none_uploadable"), undefined);
  assert.equal(results.find((r) => r.ruleKey === "unreferenced_attachment"), undefined);
});

test("Task #709 opaque-only guard: rows with only an `ev_<digits>` identifier and an opaque basename do not fire unreferenced_attachment", () => {
  const sub = makeSubmission("<p>Conf #14879280 — disputing the charge.</p>", "14879280");
  const evidence: LintEvidence[] = [
    { evidenceTypeName: "ev_1776176562945", imageUrl: "/objects/uploads/ev_1776176562945", notes: null, treeNodeId: null, claimId: null },
    { evidenceTypeName: "ev_1776176572894", imageUrl: "/objects/uploads/ev_1776176572894.bin", notes: null, treeNodeId: null, claimId: null },
  ];
  const results = lintDraft(sub, baseClaim, evidence);
  assert.equal(
    results.find((r) => r.ruleKey === "unreferenced_attachment"),
    undefined,
    "every uploaded row is opaque-only so nothing should be listed",
  );
});

test("Task #709: phrase-bearing prose with an unrelated uploadable file fires only the unreferenced_attachment info, not the warn", () => {
  const sub = makeSubmission("<p>Conf #14879280 — please find attached the manifest.</p>", "14879280");
  const evidence: LintEvidence[] = [
    { evidenceTypeName: "Photo", imageUrl: "/objects/uploads/photo.png", notes: null, treeNodeId: null, claimId: null },
  ];
  const results = lintDraft(sub, baseClaim, evidence);
  assert.equal(
    results.find((r) => r.ruleKey === "prose_claims_attachment_but_none_uploadable"),
    undefined,
    "uploads is non-empty, so the warn must not fire even though the phrase matches",
  );
  const info = results.find((r) => r.ruleKey === "unreferenced_attachment");
  assert.ok(info, "the uploaded photo isn't named in the prose");
  assert.match(info!.message, /Photo/);
});

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
