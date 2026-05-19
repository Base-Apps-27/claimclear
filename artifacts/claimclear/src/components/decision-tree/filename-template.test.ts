import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveFilenameTemplate } from "./types";

test("resolveFilenameTemplate: fills known variables", () => {
  const out = resolveFilenameTemplate("Inv_{invoice_number}_EOB_{dos}", {
    invoice_number: "12345",
    dos: "2026-01-15",
  });
  assert.equal(out, "Inv_12345_EOB_2026-01-15");
});

test("resolveFilenameTemplate: drops unresolved variables AND the adjacent separator", () => {
  const out = resolveFilenameTemplate("Inv_{invoice_number}_EOB_{dos}", {
    dos: "2026-01-15",
  });
  // {invoice_number} missing → drops the placeholder plus the trailing `_`.
  assert.equal(out, "Inv_EOB_2026-01-15");
});

test("resolveFilenameTemplate: drops trailing unresolved variable cleanly", () => {
  const out = resolveFilenameTemplate("{claim_id}_{doc_type}", {
    claim_id: "CLM-7",
  });
  assert.equal(out, "CLM-7");
});

test("resolveFilenameTemplate: empty / null template returns empty string", () => {
  assert.equal(resolveFilenameTemplate("", {}), "");
  assert.equal(resolveFilenameTemplate(null, {}), "");
  assert.equal(resolveFilenameTemplate(undefined, {}), "");
});

test("resolveFilenameTemplate: sanitizes filesystem-illegal characters", () => {
  const out = resolveFilenameTemplate("{payor}_{claim_id}", {
    payor: "Acme/Health: Plan*",
    claim_id: "CLM-9",
  });
  assert.equal(out, "Acme Health Plan_CLM-9");
});

test("resolveFilenameTemplate: adjacent missing variables collapse", () => {
  const out = resolveFilenameTemplate("A_{x}_{y}_B", {});
  assert.equal(out, "A_B");
});

test("resolveFilenameTemplate: unknown variable name is treated as missing", () => {
  const out = resolveFilenameTemplate("X_{not_a_real_var}_Y", {});
  assert.equal(out, "X_Y");
});

test("resolveFilenameTemplate: leading missing variable trims the leading separator", () => {
  const out = resolveFilenameTemplate("{missing}_End", {});
  assert.equal(out, "End");
});

test("resolveFilenameTemplate: literal text without variables passes through", () => {
  assert.equal(resolveFilenameTemplate("EOB_Document", {}), "EOB_Document");
});
