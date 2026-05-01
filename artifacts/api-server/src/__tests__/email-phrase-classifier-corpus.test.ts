// Production-corpus regression test for the phrase-signature classifier.
//
// Loads every email body we have ever received in production (snapshotted in
// __fixtures__/email-classifier-corpus.json) and asserts the new classifier
// produces the labelled outcome for every single row. When this test fails,
// the failure message includes the email id, sender, subject, the matched
// signatures, the cleaned body, and the expected vs. actual outcome — so a
// reviewer can decide in one glance whether the regression is a bug in the
// classifier or a relabelling of the fixture.
//
// To intentionally change behaviour: relabel the affected fixture rows in
// the corpus JSON (use the audit script to find the right rows) and re-run.

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

test("corpus: every row produces the expected outcome", () => {
  const failures: string[] = [];
  for (const row of corpus) {
    const result = classifyByPhrase(row.body);
    if (result.outcome !== row.expectedOutcome) {
      failures.push(
        [
          `id=${row.id}`,
          `sender=${row.senderEmail ?? "(none)"}`,
          `subject=${(row.subject ?? "").slice(0, 80)}`,
          `expected=${row.expectedOutcome} (signature=${row.expectedSignature ?? "(none)"})`,
          `actual=${result.outcome} (selected=${result.selectedSignatureId ?? "(none)"}, all=${result.matchedSignatureIds.join(",")})`,
          `cleanedBody="${result.normalizedBody.slice(0, 280)}"`,
        ].join("\n  "),
      );
    }
  }
  if (failures.length > 0) {
    assert.fail(
      `phrase classifier regressed on ${failures.length}/${corpus.length} fixture rows:\n\n` +
        failures.join("\n\n"),
    );
  }
});

test("corpus: when a signature is expected, the classifier picks the SAME signature", () => {
  // Catches the "right outcome by accident" case — e.g. a denial signature
  // accidentally matching an approval body whose true outcome was approval.
  const failures: string[] = [];
  for (const row of corpus) {
    if (!row.expectedSignature) continue;
    const result = classifyByPhrase(row.body);
    if (result.selectedSignatureId !== row.expectedSignature) {
      failures.push(
        `id=${row.id} expected signature=${row.expectedSignature}, actual=${result.selectedSignatureId ?? "(none)"} (all matches: ${result.matchedSignatureIds.join(",") || "(none)"})`,
      );
    }
  }
  if (failures.length > 0) {
    assert.fail(
      `signature mismatch on ${failures.length}/${corpus.length} fixture rows:\n` +
        failures.join("\n"),
    );
  }
});

test("corpus: zero unknowns — every production email matches a signature", () => {
  // When this test starts failing it means a new payor template has shown
  // up. Add a SIGNATURES entry, relabel the fixture, and re-pin.
  const unknowns = corpus.filter(r => r.expectedOutcome === "unknown");
  assert.equal(
    unknowns.length,
    0,
    `${unknowns.length} corpus rows are still labelled "unknown" — add signatures and re-label`,
  );
});

test("precedence: a real decision wins when boilerplate ack also matches", () => {
  // This is the canonical correctness check that drove the rebuild.
  const synthetic = `Caution: This is an external email and has a suspicious subject or content. Please do not click any links or attachments.
    Ticket Under Review
    GPS Exemption Request Approved`;
  const result = classifyByPhrase(synthetic);
  assert.equal(result.outcome, "approval");
  assert.equal(result.selectedSignatureId, "mas_gps_exemption_approved");
  assert.ok(result.matchedSignatureIds.includes("mas_ticket_under_review"));
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
