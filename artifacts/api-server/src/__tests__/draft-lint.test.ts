import { test } from "node:test";
import { strict as assert } from "node:assert";

import { lintDraft, type LintSubmission, type LintClaim } from "../lib/draft-lint";

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
