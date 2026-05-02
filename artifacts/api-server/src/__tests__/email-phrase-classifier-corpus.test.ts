// Production-corpus regression test for the acknowledgment-only phrase
// pre-filter (Task #314).
//
// CONTRACT
// --------
// The phrase classifier is no longer the source of truth for decisions —
// it can ONLY return `"acknowledgment"` (when a known boilerplate template
// matches) or `"unknown"` (so the caller escalates to the LLM). This test
// pins both halves of that contract against every email body we have ever
// received in production:
//
//   - Acknowledgment fixtures (`expectedOutcome === "acknowledgment"`)
//     must match the documented signature exactly. If a template silently
//     drifts, this catches it.
//   - Every other fixture (`approval` / `denial` / `info_request` / etc.)
//     must produce `"unknown"` so the LLM is invoked downstream. If a
//     decision phrase ever sneaks back into SIGNATURES, this catches it.
//
// The `expectedOutcome` field still holds the operator-truth label for
// each row (so the file doubles as a hand-labelled dataset for the LLM).
//
// To intentionally change behaviour: relabel the affected fixture rows in
// the corpus JSON and re-run.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { classifyByPhrase } from "../lib/email-phrase-classifier";

interface CorpusRow {
  id: number;
  senderEmail: string | null;
  subject: string | null;
  body: string;
  expectedOutcome:
    | "approval"
    | "denial"
    | "partial_approval"
    | "info_request"
    | "acknowledgment"
    | "unknown";
  expectedSignature: string | null;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturePath = resolve(__dirname, "__fixtures__/email-classifier-corpus.json");
const corpus = JSON.parse(readFileSync(fixturePath, "utf-8")) as CorpusRow[];

test("corpus: fixture file is non-empty (sanity)", () => {
  assert.ok(corpus.length > 0, "fixture must not be empty");
  // Lock in approximate scale so this test does not silently degrade if the
  // fixture file is half-truncated by a bad rebase.
  assert.ok(
    corpus.length >= 150,
    `expected at least 150 fixture rows, got ${corpus.length}`,
  );
});

test("corpus: every acknowledgment row matches the documented signature", () => {
  // Ack rows are the only thing the phrase classifier is allowed to assert
  // on. Drift here means a payor template changed shape, an ack signature
  // was accidentally removed, or a row was misfiled.
  const failures: string[] = [];
  for (const row of corpus) {
    if (row.expectedOutcome !== "acknowledgment") continue;
    const result = classifyByPhrase(row.body);
    if (result.outcome !== "acknowledgment") {
      failures.push(
        [
          `id=${row.id}`,
          `sender=${row.senderEmail ?? "(none)"}`,
          `subject=${(row.subject ?? "").slice(0, 80)}`,
          `expected=acknowledgment (signature=${row.expectedSignature ?? "(none)"})`,
          `actual=${result.outcome} (selected=${result.selectedSignatureId ?? "(none)"}, all=${result.matchedSignatureIds.join(",")})`,
          `cleanedBody="${result.normalizedBody.slice(0, 280)}"`,
        ].join("\n  "),
      );
      continue;
    }
    if (row.expectedSignature && result.selectedSignatureId !== row.expectedSignature) {
      failures.push(
        `id=${row.id} ack matched but wrong signature — expected ${row.expectedSignature}, got ${result.selectedSignatureId ?? "(none)"} (all matches: ${result.matchedSignatureIds.join(",") || "(none)"})`,
      );
    }
  }
  if (failures.length > 0) {
    assert.fail(
      `phrase classifier regressed on ${failures.length} acknowledgment fixture rows:\n\n` +
        failures.join("\n\n"),
    );
  }
});

test("corpus: every non-acknowledgment row abstains so the LLM is invoked", () => {
  // The whole point of demoting the phrase classifier (Task #314) is that
  // decisions come from the LLM. If a decision phrase ever creeps back
  // into SIGNATURES, this test catches it: every approval/denial/info_request/
  // etc. row in the corpus must come back as "unknown" from the phrase pass.
  const failures: string[] = [];
  for (const row of corpus) {
    if (row.expectedOutcome === "acknowledgment") continue;
    const result = classifyByPhrase(row.body);
    if (result.outcome !== "unknown") {
      failures.push(
        [
          `id=${row.id}`,
          `sender=${row.senderEmail ?? "(none)"}`,
          `subject=${(row.subject ?? "").slice(0, 80)}`,
          `truth=${row.expectedOutcome} (operator label)`,
          `phrase classifier returned=${result.outcome} via signature=${result.selectedSignatureId ?? "(none)"} — should have abstained`,
          `cleanedBody="${result.normalizedBody.slice(0, 280)}"`,
        ].join("\n  "),
      );
    }
  }
  if (failures.length > 0) {
    assert.fail(
      `phrase classifier produced a non-ack verdict on ${failures.length} fixture rows — only the LLM is allowed to decide non-ack outcomes:\n\n` +
        failures.join("\n\n"),
    );
  }
});

test("ack-only contract: a body with both ack boilerplate AND decision text returns acknowledgment", () => {
  // After Task #314, the phrase classifier is only allowed to assert
  // acknowledgments. Decision phrases like "GPS Exemption Request
  // Approved" must NOT trigger anything here — they are the LLM's job.
  // The ack pre-filter still runs and reports the matched ack signature.
  const synthetic = `Caution: This is an external email and has a suspicious subject or content. Please do not click any links or attachments.
    Ticket Under Review
    GPS Exemption Request Approved`;
  const result = classifyByPhrase(synthetic);
  assert.equal(result.outcome, "acknowledgment");
  assert.equal(result.selectedSignatureId, "mas_ticket_under_review");
});

test("ack-only contract: a pure decision body abstains so the LLM is invoked", () => {
  // No ack signature → unknown, even though decision keywords are present.
  const synthetic = "GPS Exemption Request Approved\nThe invoice will be made attestable within two business days.";
  const result = classifyByPhrase(synthetic);
  assert.equal(result.outcome, "unknown");
  assert.equal(result.selectedSignatureId, null);
});

test("abstain: completely unknown body returns unknown with no signatures matched", () => {
  const result = classifyByPhrase(
    "Hello, please find attached an unrelated invoice. Thanks.",
  );
  assert.equal(result.outcome, "unknown");
  assert.equal(result.selectedSignatureId, null);
  assert.deepEqual(result.matchedSignatureIds, []);
});

test("abstain: empty body returns unknown without throwing", () => {
  const result = classifyByPhrase("");
  assert.equal(result.outcome, "unknown");
  assert.equal(result.normalizedBody, "");
});

test("subject line is NOT used for classification (only body)", () => {
  // Subject lines mirror our outbound and routinely contain "approved" /
  // "denied" because we put the dispute type there. Pin that the classifier
  // ignores subject entirely.
  const bodyOnlyAck = "Ticket Under Review";
  const result = classifyByPhrase(bodyOnlyAck);
  assert.equal(result.outcome, "acknowledgment");
});
