import { test } from "node:test";
import { strict as assert } from "node:assert";

import { lintDraft, type LintSubmission, type LintClaim, type LintEvidence } from "../lib/draft-lint";

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

// --- evidence keyword matcher ---------------------------------------------
//
// The Quality Check warning "Description references X, but no matching
// evidence is attached" must NOT fire when the SOP runner has already
// attached files for the dispute. In production every SOP-attached row
// carries an opaque `evidence_type_name = "ev_<Date.now()>"` (the editor's
// synthetic key with an empty default label), so the historical implementation
// — which compared the keyword against `evidence_type_name` only — produced a
// warning on EVERY dispute that mentioned a tracked keyword. The new matcher
// also considers the file basename and notes, and falls back to "any
// attachment present" suppression when none of the rows produces a textual
// match.
const gpsConfClaim: LintClaim = { confNumber: "15004552", claimAmount: null };
const gpsConfDescription =
  "<p>Conf #15004552 — disputing the Incomplete GPS flag; breadcrumb data attached.</p>";

test("GPS keyword: warns when description mentions GPS and zero evidence is attached", () => {
  const sub = makeSubmission(gpsConfDescription, "15004552");
  const results = lintDraft(sub, gpsConfClaim, []);
  const r = results.find((r) => r.ruleKey === "unattached_evidence:GPS_or_breadcrumb_evidence");
  assert.ok(r, "expected GPS unattached_evidence warning when nothing is attached");
  assert.equal(r!.severity, "warn");
});

test("GPS keyword: matches against file basename when type name is opaque (`ev_<digits>`)", () => {
  const sub = makeSubmission(gpsConfDescription, "15004552");
  const evidence: LintEvidence[] = [
    { evidenceTypeName: "ev_1776176562945", imageUrl: "/objects/uploads/gps_breadcrumb_2026-05-12.png", notes: null },
  ];
  const results = lintDraft(sub, gpsConfClaim, evidence);
  assert.equal(
    results.find((r) => r.ruleKey === "unattached_evidence:GPS_or_breadcrumb_evidence"),
    undefined,
    "filename containing 'gps_breadcrumb' should satisfy the GPS keyword rule",
  );
});

test("GPS keyword: matches against operator notes when type name is opaque", () => {
  const sub = makeSubmission(gpsConfDescription, "15004552");
  const evidence: LintEvidence[] = [
    { evidenceTypeName: "ev_1776176562945", imageUrl: "/objects/uploads/abc123", notes: "GPS report showing on-route detour" },
  ];
  const results = lintDraft(sub, gpsConfClaim, evidence);
  assert.equal(
    results.find((r) => r.ruleKey === "unattached_evidence:GPS_or_breadcrumb_evidence"),
    undefined,
    "notes containing 'GPS' should satisfy the GPS keyword rule",
  );
});

test("GPS keyword: suppresses warning when at least one evidence row IS attached, even if no field matches the keyword", () => {
  const sub = makeSubmission(gpsConfDescription, "15004552");
  // This is the exact production shape that produced the false positive on
  // invoice 1864796540 / conf 15004552: 3 SOP-attached rows whose type name
  // is the editor's synthetic `ev_<Date.now()>` key, image_url is an opaque
  // /objects/upload-<id> path, and notes is null.
  const evidence: LintEvidence[] = [
    { evidenceTypeName: "ev_1776176562945", imageUrl: "/objects/uploads/abc", notes: null },
    { evidenceTypeName: "ev_1776176572894", imageUrl: "/objects/uploads/def", notes: null },
    { evidenceTypeName: "ev_1776176581435", imageUrl: "/objects/uploads/ghi", notes: null },
  ];
  const results = lintDraft(sub, gpsConfClaim, evidence);
  assert.equal(
    results.find((r) => r.ruleKey === "unattached_evidence:GPS_or_breadcrumb_evidence"),
    undefined,
    "with attachments present, the bot will upload them; the keyword warning would just be noise",
  );
});

test("GPS keyword: still matches against a meaningful evidenceTypeName (back-compat)", () => {
  const sub = makeSubmission(gpsConfDescription, "15004552");
  const evidence: LintEvidence[] = [
    { evidenceTypeName: "GPS deviation report", imageUrl: "/objects/uploads/abc123", notes: null },
  ];
  const results = lintDraft(sub, gpsConfClaim, evidence);
  assert.equal(
    results.find((r) => r.ruleKey === "unattached_evidence:GPS_or_breadcrumb_evidence"),
    undefined,
    "a non-opaque type name like 'GPS deviation report' should keep matching as before",
  );
});

test("evidence-keyword: non-/objects/ URLs do not count as attached (parity with collectGroupEvidenceUrls)", () => {
  // The bot's collectGroupEvidenceUrls drops anything that doesn't start with
  // `/objects/` to prevent uncontrolled outbound requests; if a row only has
  // an off-`/objects/` URL, the bot uploads nothing for it. The lint must
  // mirror that eligibility rule — otherwise the suppression escape hatch
  // would silently mute a real "GPS mentioned, nothing will actually be
  // uploaded" warning.
  const sub = makeSubmission(gpsConfDescription, "15004552");
  const evidence: LintEvidence[] = [
    { evidenceTypeName: "ev_1776176562945", imageUrl: "https://example.com/external/gps.png", notes: null },
  ];
  const results = lintDraft(sub, gpsConfClaim, evidence);
  const r = results.find((r) => r.ruleKey === "unattached_evidence:GPS_or_breadcrumb_evidence");
  assert.ok(r, "an external URL is not bot-uploadable, so the keyword warning must still fire");
});

test("evidence-keyword opaque-name + zero attachments: warning still fires (no false negative)", () => {
  // Defensive: a row with NO imageUrl and an opaque type name shouldn't be
  // counted as an "attached" file — otherwise we'd silently skip the warning
  // on a submission that genuinely has nothing to send.
  const sub = makeSubmission(gpsConfDescription, "15004552");
  const evidence: LintEvidence[] = [
    { evidenceTypeName: "ev_1776176562945", imageUrl: null, notes: null },
  ];
  const results = lintDraft(sub, gpsConfClaim, evidence);
  const r = results.find((r) => r.ruleKey === "unattached_evidence:GPS_or_breadcrumb_evidence");
  assert.ok(r, "opaque-named row WITHOUT a file must not suppress the warning");
});
