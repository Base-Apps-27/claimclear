export type LintSeverity = "warn" | "fail";

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
}

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

const EVIDENCE_KEYWORDS: EvidenceKeywordRule[] = [
  {
    keyword: /\b(gps|breadcrumbs?)\b/i,
    matches: (n) => /gps|breadcrumb/i.test(n),
    label: "GPS or breadcrumb evidence",
  },
  {
    keyword: /\b(screenshot|screen\s*shot)\b/i,
    matches: (n) => /screenshot/i.test(n),
    label: "screenshot",
  },
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

export function lintDraft(
  submission: LintSubmission,
  claim: LintClaim,
  evidence: LintEvidence[],
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

  const conf = (submission.confNumber || claim.confNumber || "").trim();
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

  // We match keywords against the evidence's type name AND its file basename
  // AND its notes (any of the three is enough). This is necessary because in
  // production the SOP runner persists synthetic `ev_<timestamp>` type names
  // (see OPAQUE_EVIDENCE_NAME_RE above) — without the wider match the lint
  // would warn on every dispute that mentions a tracked keyword.
  //
  // Final escape hatch: if at least one evidence row is attached for this
  // group/leg but none of the rows produce a textual match, we suppress the
  // warning. The bot is going to upload those files regardless, and the
  // lint's value-add at that point is mostly noise. The underlying
  // `empty_description` / "no attachments at all" guards still catch the
  // genuine "wrote about GPS but attached nothing" case below.
  const evidenceList = evidence || [];
  const anyAttachmentPresent = evidenceList.some(evidenceHasAttachment);
  for (const rule of EVIDENCE_KEYWORDS) {
    if (!rule.keyword.test(text)) continue;
    const matched = evidenceList.some((e) => evidenceMatchTexts(e).some((t) => rule.matches(t)));
    if (matched) continue;
    if (anyAttachmentPresent) continue;
    results.push({
      ruleKey: `unattached_evidence:${rule.label.replace(/\s+/g, "_")}`,
      severity: "warn",
      message: `Description references ${rule.label}, but no matching evidence is attached to the claim.`,
    });
  }

  return results;
}
