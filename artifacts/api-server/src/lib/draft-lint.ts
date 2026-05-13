export type LintSeverity = "info" | "warn" | "fail";

export interface LintResult {
  ruleKey: string;
  severity: LintSeverity;
  message: string;
}

export interface LintSubmission {
  descriptionHtml?: string | null;
  confNumber?: string | null;
  attachmentUrls?: string[] | null;
}

export interface LintClaim {
  confNumber?: string | null;
  claimAmount?: string | null;
}

export interface LintEvidence {
  evidenceTypeName?: string | null;
  /** Storage URL or file path; the basename is used as a fallback signal when
   *  `evidenceTypeName` is opaque (see OPAQUE_EVIDENCE_NAME_RE). */
  imageUrl?: string | null;
  /** Optional human-typed note attached to the evidence row. */
  notes?: string | null;
  /** Decision-tree node id this row was attached to, when the SOP runner
   *  stamped one. The structural rules use this as the ground truth for
   *  "did the operator collect the evidence the SOP asked for?" */
  treeNodeId?: string | null;
  /** When set, this evidence row is scoped to a single leg (it lives in
   *  `claim_evidence.claim_id`). When null, the row is group-scoped (lives
   *  on `invoice_groups.evidence_files` or `claim_evidence.invoice_group_id`)
   *  and counts as an attachment for every leg in the group. */
  claimId?: number | null;
}

/**
 * Per-leg ground truth for the structural rules. The keyword-only matcher
 * above can only see the prose; these fields let the lint reason about the
 * structured submission state (per-leg `errorType` / `disposition`, the
 * SOP outcome / final-node id, and the registry of evidence node ids the
 * errorType requires).
 */
export interface LintLeg {
  id: number;
  confNumber: string;
  errorTypeName?: string | null;
  errorTypeId?: string | null;
  /** Pinned values from `claim_disposition` enum. */
  disposition?: string | null;
  /** Pinned values: portal_dispute | dispute | hold | cannot_dispute | non_issue | null. */
  sopOutcome?: string | null;
  /** Bookmark in the SOP decision tree at the moment the SOP was committed.
   *  Used (along with `sopAnswerNodeIds`) by the portal-submission route to
   *  compute `requiredEvidenceNodeIds` from the path the operator actually
   *  walked rather than the entire decision tree. */
  sopNodeId?: string | null;
  /** Decision-tree node ids the operator answered on the way to the
   *  terminal — drawn from `claims.sop_answers[].nodeId`. Combined with
   *  `sopNodeId` this is the leg's walked path. Optional so the existing
   *  keyword/structural unit tests that synthesize legs by hand keep
   *  compiling; in those tests the caller pre-computes
   *  `requiredEvidenceNodeIds` directly. */
  sopAnswerNodeIds?: string[];
  /** Whether this leg participates in the dispute (`included_in_dispute`).
   *  False legs are excluded from every structural rule below. */
  includedInDispute?: boolean;
  /** Set of decision-tree node ids whose `evidenceRequirements[].required`
   *  is true AND that the operator actually visited on this leg's walk.
   *  Empty when the errorType has no required-evidence nodes on the walked
   *  path, or when the leg has no recorded walk (legacy claims) — in either
   *  case the rule becomes a no-op for this leg. See
   *  `requiredEvidenceNodeIdsForWalk` for how the route derives this. */
  requiredEvidenceNodeIds?: string[];
}

export interface LintContext {
  /** All legs in the parent invoice group at the moment of the lint run.
   *  Required for the structural rules; optional so the existing keyword
   *  tests that pass nothing keep compiling. */
  legs?: LintLeg[];
}

/** SOP terminal outcomes that mean "this leg is going into the dispute". */
const TERMINAL_DISPUTE_OUTCOMES = new Set(["portal_dispute", "dispute"]);

/**
 * Dispositions that imply the leg is participating in (or has already been
 * filed as) a dispute submission. We intentionally include both the
 * pre-submit "ready" markers and the post-submit "disposed_*" markers so
 * the structural check stays sharp on a re-lint of an in-flight row.
 */
const DISPUTING_DISPOSITIONS = new Set([
  "disposed_portal",
  "disposed_email",
]);

/**
 * The decision-tree editor mints evidence requirements with a synthetic key of
 * `ev_<Date.now()>` and an empty default label; the SOP runner persists that
 * key as `claim_evidence.evidence_type_name`. As a result, the vast majority
 * of production evidence rows carry an opaque `ev_<digits>` "type name" that
 * carries no semantic signal. We treat such names as no-signal and fall back
 * to the file basename / notes for keyword matching, and — when even those
 * are silent — trust the operator's act of attaching evidence rather than
 * flagging the dispute (matches what the bot actually uploads).
 */
const OPAQUE_EVIDENCE_NAME_RE = /^ev_\d+$/i;

function evidenceBasename(url: string | null | undefined): string {
  if (!url) return "";
  const trimmed = url.split(/[?#]/)[0] ?? "";
  const last = trimmed.split("/").pop() ?? "";
  return last.trim();
}

function evidenceMatchTexts(e: LintEvidence): string[] {
  const out: string[] = [];
  const name = (e.evidenceTypeName || "").trim();
  if (name && !OPAQUE_EVIDENCE_NAME_RE.test(name)) out.push(name);
  // Filename matching is gated on the same `/objects/` rule used for the
  // suppression check, so a non-uploadable URL can't satisfy the keyword.
  if (evidenceHasAttachment(e)) {
    const base = evidenceBasename(e.imageUrl);
    if (base && !OPAQUE_EVIDENCE_NAME_RE.test(base.replace(/\.[^.]+$/, ""))) out.push(base);
  }
  const notes = (e.notes || "").trim();
  if (notes) out.push(notes);
  return out;
}

/**
 * An evidence row counts as "attached" only if its imageUrl is one the bot
 * will actually upload. The bot's `collectGroupEvidenceUrls` drops anything
 * that doesn't start with `/objects/` (uncontrolled outbound URL guard), so
 * the lint must use the SAME eligibility rule — otherwise a row with an
 * external/garbage URL would silently suppress the keyword warning even
 * though the bot ends up sending zero attachments. Filename matching uses
 * the same gate so off-`/objects/` URLs can't satisfy the keyword either.
 */
function evidenceHasAttachment(e: LintEvidence): boolean {
  return typeof e.imageUrl === "string" && e.imageUrl.startsWith("/objects/");
}

/**
 * Task #709: the bot's effective upload set after the `/objects/` filter.
 * This is the single source of truth for "what will the portal actually
 * see attached?" — both reconciliation rules below and the existing
 * keyword family route through this helper so the lint can never drift
 * from `collectGroupEvidenceUrls`.
 */
function effectiveUploads(evidence: LintEvidence[]): LintEvidence[] {
  return evidence.filter(evidenceHasAttachment);
}

/**
 * Task #709: the conservative phrase set the prose-side reconciliation
 * rule scans for. We deliberately keep this short and lexical — anything
 * that promises a reviewer they'll see an attachment. Unit tests pin the
 * exact set so additions are reviewable in one place.
 */
const PROSE_ATTACHMENT_PHRASE_RE = /\b(?:see\s+attached|attached\s+(?:screenshot|photo|photograph|picture|image|document|file|copy)|please\s+find\s+attached|enclosed\s+(?:is|are|please\s+find|herewith))\b/i;

/**
 * Task #709: the human-readable label we'll quote in the
 * `unreferenced_attachment` finding. Prefers the operator-typed
 * `evidence_type_name` (when not the opaque `ev_<digits>` SOP-runner
 * stamp) and falls back to the file basename when that, too, is not
 * opaque. Returns null when the only identifier on the row is opaque —
 * the rule skips those rows so we never list a meaningless `ev_123`.
 */
function evidenceDisplayLabel(e: LintEvidence): string | null {
  const name = (e.evidenceTypeName || "").trim();
  if (name && !OPAQUE_EVIDENCE_NAME_RE.test(name)) return name;
  const base = evidenceBasename(e.imageUrl);
  if (base && !OPAQUE_EVIDENCE_NAME_RE.test(base.replace(/\.[^.]+$/, ""))) return base;
  return null;
}

const HTML_BLOCK_RE = /<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi;
const HTML_TAG_RE = /<[^>]+>/g;
const HTML_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
};

export function htmlToText(html: string | null | undefined): string {
  if (!html) return "";
  const stripped = html.replace(HTML_BLOCK_RE, " ").replace(HTML_TAG_RE, " ");
  const decoded = stripped.replace(/&[a-z#0-9]+;/gi, (m) => HTML_ENTITIES[m.toLowerCase()] ?? m);
  return decoded.replace(/\s+/g, " ").trim();
}

/**
 * Task #708 paragraph-aware tokenizer. Splits an HTML draft into the
 * paragraph-sized blocks operators actually wrote — block-level tags
 * (`<p>`, `<div>`, `<li>`, `<br>`, headings, table cells, etc.) become
 * paragraph boundaries; inline tags are stripped without breaking the
 * paragraph. Blank lines (a string of `<br>`s, or two consecutive
 * newlines in a `<pre>`-shaped draft) are also boundaries. The order
 * of the returned array matches the order of the source so a future
 * diagnostic can quote the offending paragraph by index.
 */
const HTML_BLOCK_BOUNDARY_RE = /<\s*\/?\s*(p|div|br|li|ul|ol|h[1-6]|blockquote|tr|td|th|table|hr|section|article|header|footer|pre|figure)\b[^>]*>/gi;

export function htmlToParagraphs(html: string | null | undefined): string[] {
  if (!html) return [];
  const withBreaks = html
    .replace(HTML_BLOCK_RE, " ")
    .replace(HTML_BLOCK_BOUNDARY_RE, "\n");
  const stripped = withBreaks.replace(HTML_TAG_RE, " ");
  const decoded = stripped.replace(/&[a-z#0-9]+;/gi, (m) => HTML_ENTITIES[m.toLowerCase()] ?? m);
  return decoded
    .split(/\n+/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length > 0);
}

const CONF_RE = /\b\d{6,}\b/;
const DOLLAR_RE = /\$\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{1,2})?|[0-9]+(?:\.[0-9]{1,2})?)/g;

function splitConfNumbers(raw: string): string[] {
  const matches = raw.match(/\d+/g);
  if (!matches) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of matches) {
    if (!seen.has(m)) {
      seen.add(m);
      out.push(m);
    }
  }
  return out;
}

function descriptionContainsNumber(text: string, num: string): boolean {
  const re = new RegExp(`(?<!\\d)${num}(?!\\d)`);
  return re.test(text);
}

interface EvidenceKeywordRule {
  keyword: RegExp;
  matches: (name: string) => boolean;
  label: string;
}

/**
 * Task #707: the keyword family used to fire as `warn` and gate
 * submissions. Now that the structural rules below carry the real ground
 * truth (per-leg `errorType` × `claim_evidence.tree_node_id`), the keyword
 * matcher is demoted to advisory `info` severity — it stays in the lint
 * payload so operators can still see "you wrote about GPS but nothing
 * matches", but the gate no longer refuses on a keyword miss. Two
 * keyword entries (`gps`, `screenshot`) are retired entirely because the
 * `requires_evidence_node` rule covers the same intent more precisely:
 * an `Incomplete GPS` errorType demands the GPS evidence node, period.
 */
const EVIDENCE_KEYWORDS: EvidenceKeywordRule[] = [
  {
    keyword: /\b(manifest)\b/i,
    matches: (n) => /manifest/i.test(n),
    label: "manifest",
  },
  {
    keyword: /\b(signature|signed\s+(form|trip\s*sheet))\b/i,
    matches: (n) => /signature|signed/i.test(n),
    label: "signature",
  },
  {
    keyword: /\b(trip\s*sheet|log\s*book|logbook|driver\s*log)\b/i,
    matches: (n) => /trip\s*sheet|log\s*book|logbook|driver\s*log/i.test(n),
    label: "trip sheet or log",
  },
  {
    keyword: /\b(photo|photograph|picture)\b/i,
    matches: (n) => /photo|photograph|picture|image/i.test(n),
    label: "photo",
  },
  {
    keyword: /\b(odometer|mileage)\b/i,
    matches: (n) => /odometer|mileage/i.test(n),
    label: "odometer reading",
  },
];

function parseAmount(raw: string): number | null {
  const cleaned = raw.replace(/,/g, "");
  const v = parseFloat(cleaned);
  return isNaN(v) ? null : v;
}

// ─── Structural rules (Task #707) ────────────────────────────────────────
//
// These run only when the caller threads `LintContext.legs` through. Each
// rule is a pure function over (text, evidence, legs) so the unit tests can
// drive them deterministically. The keyword family above stays as an
// advisory `info` net for prose written about evidence we can't structurally
// model — but the gates upstream only act on `warn` / `fail`.

function legAttachments(leg: LintLeg, evidence: LintEvidence[]): LintEvidence[] {
  // Group-scoped rows (claimId == null) belong to every leg; per-leg rows
  // belong only to their specific leg. Anything else gets dropped — a row
  // tagged with a sibling leg's id is not an attachment for THIS leg.
  return evidence.filter(
    (e) => e.claimId == null || e.claimId === leg.id,
  );
}

function ruleRequiresEvidenceNode(
  legs: LintLeg[],
  evidence: LintEvidence[],
): LintResult[] {
  const out: LintResult[] = [];
  for (const leg of legs) {
    if (leg.includedInDispute === false) continue;
    const required = leg.requiredEvidenceNodeIds ?? [];
    if (required.length === 0) continue;
    const attached = legAttachments(leg, evidence);
    const haveNodeIds = new Set(
      attached
        .map((e) => (e.treeNodeId || "").trim())
        .filter((s) => s.length > 0),
    );
    const missing = required.filter((n) => !haveNodeIds.has(n));
    if (missing.length === 0) continue;
    const errorTypeLabel = leg.errorTypeName?.trim() || "this errorType";
    out.push({
      ruleKey: `structural_missing_evidence_node:${leg.id}`,
      severity: "fail",
      message: `Conf #${leg.confNumber} (${errorTypeLabel}) requires evidence from SOP node${missing.length === 1 ? "" : "s"} ${missing.join(", ")}, but no \`claim_evidence\` row carries that \`tree_node_id\`.`,
    });
  }
  return out;
}

/**
 * Task #708 per-leg confirmation-number coverage. The legacy
 * `missing_conf_number` rule asserted only that *some* configured conf
 * number appears anywhere in the description; on a multi-leg dispute
 * that lets through narratives that mention three of four legs and
 * silently omit the fourth. This rule fires once per contestable leg
 * (one finding per leg keyed `missing_conf_number_for_leg:<legId>`)
 * when:
 *   (a) the leg's conf number is absent from every paragraph, OR
 *   (b) the leg's conf number appears only in paragraphs that ALSO
 *       name another contestable leg's conf — i.e. there is no
 *       paragraph that uniquely attributes prose to this leg.
 * The substring guard (`(?<!\d)NUM(?!\d)`) is reused via
 * descriptionContainsNumber so 14879280 doesn't satisfy 1487928.
 */
function ruleMissingConfNumberPerLeg(
  legs: LintLeg[],
  paragraphs: string[],
): LintResult[] {
  const out: LintResult[] = [];
  const contestable = legs.filter(
    (l) => l.includedInDispute !== false && (l.confNumber || "").trim().length > 0,
  );
  for (const leg of contestable) {
    const conf = leg.confNumber.trim();
    const otherConfs = contestable
      .filter((other) => other.id !== leg.id)
      .map((other) => other.confNumber.trim())
      .filter((c) => c.length > 0 && c !== conf);
    const containing = paragraphs.filter((p) => descriptionContainsNumber(p, conf));
    const errorTypeLabel = leg.errorTypeName?.trim();
    const legLabel = errorTypeLabel ? `leg ${conf} (${errorTypeLabel})` : `leg ${conf}`;
    if (containing.length === 0) {
      out.push({
        ruleKey: `missing_conf_number_for_leg:${leg.id}`,
        severity: "fail",
        message: `Confirmation number ${conf} for ${legLabel} is not mentioned in the description.`,
      });
      continue;
    }
    const hasOwnParagraph = containing.some(
      (p) => !otherConfs.some((other) => descriptionContainsNumber(p, other)),
    );
    if (!hasOwnParagraph) {
      out.push({
        ruleKey: `missing_conf_number_for_leg:${leg.id}`,
        severity: "fail",
        message: `Confirmation number ${conf} for ${legLabel} only appears in paragraphs that also name another leg's confirmation number — give it its own paragraph so the portal can attribute the prose.`,
      });
    }
  }
  return out;
}

function ruleDispositionWithoutTerminal(legs: LintLeg[]): LintResult[] {
  const out: LintResult[] = [];
  for (const leg of legs) {
    if (leg.includedInDispute === false) continue;
    // We only fire on legs whose disposition column says "this leg has
    // been (or is being) filed as a dispute" — pre-submit `classifying`
    // rows aren't a structural error, they're just not done yet.
    const disp = (leg.disposition || "").trim();
    if (!DISPUTING_DISPOSITIONS.has(disp)) continue;
    const outcome = (leg.sopOutcome || "").trim();
    if (TERMINAL_DISPUTE_OUTCOMES.has(outcome)) continue;
    out.push({
      ruleKey: `structural_disposition_without_terminal:${leg.id}`,
      severity: "fail",
      message: `Conf #${leg.confNumber} disposition is \`${disp}\` but the SOP did not reach a terminal dispute node (sopOutcome=${outcome || "null"}).`,
    });
  }
  return out;
}

function ruleDisputedLegBareOfEvidenceAndProse(
  legs: LintLeg[],
  evidence: LintEvidence[],
  text: string,
): LintResult[] {
  const out: LintResult[] = [];
  for (const leg of legs) {
    if (leg.includedInDispute === false) continue;
    // Scoped to legs the SOP marked ready for dispute — the same gate the
    // bot uses to decide whether to file the leg at all.
    const outcome = (leg.sopOutcome || "").trim();
    if (!TERMINAL_DISPUTE_OUTCOMES.has(outcome)) continue;
    const attached = legAttachments(leg, evidence).some(evidenceHasAttachment);
    if (attached) continue;
    if (descriptionContainsNumber(text, leg.confNumber)) continue;
    out.push({
      ruleKey: `structural_disputed_leg_bare:${leg.id}`,
      severity: "fail",
      message: `Conf #${leg.confNumber} is going into the dispute but has zero attachments and is not mentioned by number anywhere in the description.`,
    });
  }
  return out;
}

export function lintDraft(
  submission: LintSubmission,
  claim: LintClaim,
  evidence: LintEvidence[],
  context: LintContext = {},
): LintResult[] {
  const results: LintResult[] = [];
  const text = htmlToText(submission.descriptionHtml);

  if (!text) {
    results.push({
      ruleKey: "empty_description",
      severity: "fail",
      message: "Description is empty. Add a write-up before submitting.",
    });
    return results;
  }

  // Task #708: when the caller threads leg context through, per-leg
  // coverage (`missing_conf_number_for_leg:<id>`) replaces the legacy
  // `missing_conf_number` rule entirely — both checks would otherwise
  // double-fire on the same missing leg. The legacy rule remains as a
  // back-compat fallback for callers that pass no leg context.
  const legsForConfCheck = (context.legs ?? []).filter(
    (l) => l.includedInDispute !== false && (l.confNumber || "").trim().length > 0,
  );
  const paragraphs = htmlToParagraphs(submission.descriptionHtml);
  const usePerLegConfCheck = legsForConfCheck.length > 0;

  const conf = (submission.confNumber || claim.confNumber || "").trim();
  if (!usePerLegConfCheck) {
    if (conf) {
      const expected = splitConfNumbers(conf);
      if (expected.length === 0) {
        if (!text.includes(conf)) {
          results.push({
            ruleKey: "missing_conf_number",
            severity: "fail",
            message: `Confirmation number ${conf} is not mentioned in the description.`,
          });
        }
      } else {
        const missing = expected.filter((n) => !descriptionContainsNumber(text, n));
        if (missing.length > 0) {
          const label = missing.length === 1 ? "Confirmation number" : "Confirmation numbers";
          results.push({
            ruleKey: "missing_conf_number",
            severity: "fail",
            message: `${label} ${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} not mentioned in the description.`,
          });
        }
      }
    } else if (!CONF_RE.test(text)) {
      results.push({
        ruleKey: "missing_conf_number",
        severity: "fail",
        message: "No confirmation number is referenced in the description.",
      });
    }
  }

  const claimAmountRaw = claim.claimAmount;
  if (claimAmountRaw !== null && claimAmountRaw !== undefined && String(claimAmountRaw).length > 0) {
    const claimAmount = parseAmount(String(claimAmountRaw));
    if (claimAmount !== null) {
      const matches = Array.from(text.matchAll(DOLLAR_RE));
      const mismatched: string[] = [];
      for (const m of matches) {
        const v = parseAmount(m[1]);
        if (v === null) continue;
        if (Math.abs(v - claimAmount) > 0.01) {
          mismatched.push(`$${m[1]}`);
        }
      }
      if (mismatched.length > 0) {
        const unique = Array.from(new Set(mismatched));
        results.push({
          ruleKey: "dollar_amount_mismatch",
          severity: "warn",
          message: `Description references ${unique.join(", ")} which doesn't match the claim amount $${claimAmount.toFixed(2)}.`,
        });
      }
    }
  }

  // Structural rules — only fire when the caller threads leg context
  // through. The route handlers do; older callers and the keyword-focused
  // unit tests don't, in which case the rules are no-ops.
  const evidenceList = evidence || [];
  const legs = context.legs ?? [];
  if (legs.length > 0) {
    results.push(...ruleMissingConfNumberPerLeg(legs, paragraphs));
    results.push(...ruleRequiresEvidenceNode(legs, evidenceList));
    results.push(...ruleDispositionWithoutTerminal(legs));
    results.push(...ruleDisputedLegBareOfEvidenceAndProse(legs, evidenceList, text));
  }

  // Task #709: bidirectional reconciliation between the prose and the
  // bot's effective upload set. Both rules route the upload check
  // through `effectiveUploads` so they cannot drift from
  // `collectGroupEvidenceUrls`. These run regardless of leg context —
  // they only inspect text + evidence.
  const uploads = effectiveUploads(evidenceList);
  const proseAttachmentMatch = text.match(PROSE_ATTACHMENT_PHRASE_RE);
  if (proseAttachmentMatch && uploads.length === 0) {
    results.push({
      ruleKey: "prose_claims_attachment_but_none_uploadable",
      severity: "warn",
      message: `Description says "${proseAttachmentMatch[0]}" but no attachments will be uploaded with this submission.`,
    });
  }
  if (uploads.length > 0) {
    const loweredText = text.toLowerCase();
    const unreferenced: string[] = [];
    for (const e of uploads) {
      const label = evidenceDisplayLabel(e);
      if (!label) continue; // opaque-only row — skip per spec
      const name = (e.evidenceTypeName || "").trim();
      const base = evidenceBasename(e.imageUrl);
      const tokens: string[] = [];
      if (name && !OPAQUE_EVIDENCE_NAME_RE.test(name)) tokens.push(name);
      if (base && !OPAQUE_EVIDENCE_NAME_RE.test(base.replace(/\.[^.]+$/, ""))) tokens.push(base);
      const referenced = tokens.some((t) => loweredText.includes(t.toLowerCase()));
      if (!referenced) unreferenced.push(label);
    }
    if (unreferenced.length > 0) {
      const unique = Array.from(new Set(unreferenced));
      results.push({
        ruleKey: "unreferenced_attachment",
        severity: "info",
        message: `Description does not reference attached ${unique.length === 1 ? "file" : "files"}: ${unique.join(", ")}.`,
      });
    }
  }

  // Demoted keyword family — same matcher as before, severity dropped to
  // `info` so it surfaces in the lint payload without blocking the gate.
  // We match keywords against the evidence's type name AND its file basename
  // AND its notes (any of the three is enough). This is necessary because in
  // production the SOP runner persists synthetic `ev_<timestamp>` type names
  // (see OPAQUE_EVIDENCE_NAME_RE above) — without the wider match the lint
  // would warn on every dispute that mentions a tracked keyword. The
  // attachment-present escape hatch is preserved so the historical false
  // positive on invoice 1864796540 / conf 15004552 still passes silently.
  const anyAttachmentPresent = uploads.length > 0;
  for (const rule of EVIDENCE_KEYWORDS) {
    if (!rule.keyword.test(text)) continue;
    const matched = evidenceList.some((e) => evidenceMatchTexts(e).some((t) => rule.matches(t)));
    if (matched) continue;
    if (anyAttachmentPresent) continue;
    results.push({
      ruleKey: `unattached_evidence:${rule.label.replace(/\s+/g, "_")}`,
      severity: "info",
      message: `Description references ${rule.label}, but no matching evidence is attached to the claim.`,
    });
  }

  return results;
}

/**
 * Task #735: derive the set of decision-tree node ids whose
 * `evidenceRequirements[].required` is `true` AND that the operator
 * actually visited on this leg's walk. The walk is the union of every
 * `nodeId` recorded in `claims.sop_answers` plus the leg's terminal
 * `sop_node_id` bookmark.
 *
 * Replaces the previous tree-wide collection (Task #707) which produced
 * false-positive lint failures: most error-type trees branch into several
 * terminals, each with its own required-evidence list, but only one path
 * is ever walked per leg. The tree-wide check demanded uploads stamped
 * with sibling-terminal ids the operator never touched.
 *
 * Safety choice: when the leg has no recorded walk (legacy claims with
 * empty `sop_answers` and null `sop_node_id`), the helper returns `[]`
 * so the rule becomes a no-op for that leg — better to under-enforce on
 * historical rows than to silently demand evidence stamps for every
 * required-bearing node in the tree, which is exactly the bug we're
 * fixing here. New legs always carry at least the terminal id, so this
 * fallback only matters for pre-Task-#735 data.
 */
export function requiredEvidenceNodeIdsForWalk(
  decisionTree: unknown,
  visitedNodeIds: ReadonlyArray<string> | null | undefined,
): string[] {
  if (!decisionTree || typeof decisionTree !== "object") return [];
  const nodes = (decisionTree as { nodes?: unknown }).nodes;
  if (!Array.isArray(nodes)) return [];
  if (!visitedNodeIds || visitedNodeIds.length === 0) return [];
  const visited = new Set(
    visitedNodeIds.filter((id): id is string => typeof id === "string" && id.length > 0),
  );
  if (visited.size === 0) return [];
  const out: string[] = [];
  for (const n of nodes) {
    if (!n || typeof n !== "object") continue;
    const id = (n as { id?: unknown }).id;
    if (typeof id !== "string" || !visited.has(id)) continue;
    const reqs = (n as { evidenceRequirements?: unknown }).evidenceRequirements;
    if (!Array.isArray(reqs)) continue;
    const hasRequired = reqs.some(
      (r) => r && typeof r === "object" && (r as { required?: unknown }).required === true,
    );
    if (hasRequired) out.push(id);
  }
  return out;
}
