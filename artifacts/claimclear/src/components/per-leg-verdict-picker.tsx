import { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Loader2, Sparkles, Link2 } from "lucide-react";
import type {
  AiCalibrationResponse,
  ClaimResponse,
  ClaimVerdictResponse,
  RecordVerdictBodyOutcome,
} from "@workspace/api-client-react";
import { outcomeRole } from "@workspace/leg-state";

export type VerdictOutcome = RecordVerdictBodyOutcome;

// Per-leg verdicts are binary. A leg either had the payor agree with us
// (Approved) or stand by their denial (Denied) — there is no per-leg
// "Partial". Partial only makes sense at the invoice level (some legs
// approved, others denied) and that mix is already represented by the
// per-leg verdicts together. The backend `RecordVerdictBodyOutcome`
// type still accepts "Partial" for legacy rows recorded under the old
// UI; we just no longer offer it as a fresh pick.
const OUTCOMES = ["Approved", "Denied"] as const satisfies readonly VerdictOutcome[];
type PickableOutcome = (typeof OUTCOMES)[number];

// Matches the soft-fill verdict-button voice established by
// response-actions-card.tsx (bg-X-50 hover:bg-X-100 border-X-300 text-X-900).
// Selected state deepens the same family without flipping to a loud strong-fill,
// so picker buttons read consistently with post-response action buttons.
const OUTCOME_TONE: Record<PickableOutcome, string> = {
  Approved:
    "hover:bg-green-50 hover:border-green-300 hover:text-green-900 data-[selected=true]:bg-green-100 data-[selected=true]:border-green-400 data-[selected=true]:text-green-900",
  Denied:
    "hover:bg-red-50 hover:border-red-300 hover:text-red-900 data-[selected=true]:bg-red-100 data-[selected=true]:border-red-400 data-[selected=true]:text-red-900",
};

const CALIBRATION_MIN_CONFIRMATIONS = 5;

export interface PerLegVerdictPickerProps {
  claim: ClaimResponse;
  latestSuggestion?: ClaimVerdictResponse | null;
  /**
   * Latest *terminal* verdict on the leg (`operator_confirmed` or — only
   * for legacy rows — `ai_suggested`). Used to seed the lit-up pill when
   * the leg already has a confirmed verdict on file (e.g. mixed group
   * where one leg was confirmed under the old behavior and the group
   * hasn't moved out of `response-pending` yet).
   */
  latestVerdict?: ClaimVerdictResponse | null;
  /**
   * Latest `operator_draft` row on the leg (Task #343). When present
   * AND newer than `latestVerdict`, this is what lights up the pill on
   * mount so selections survive refresh + navigation.
   */
  latestDraft?: ClaimVerdictResponse | null;
  calibration?: AiCalibrationResponse;
  /**
   * Save the operator's selection as a draft. Wired by the page to
   * `POST /claims/:id/verdict` with `source: "operator_draft"`.
   * Step 4 commit (re-attest / queue / closure) is what later
   * promotes drafts to `operator_confirmed` atomically.
   */
  onSelect: (outcome: VerdictOutcome) => Promise<void>;
  /**
   * The primary leg this one rides along with, when `claim` is a Sibling
   * Duplicate (`outcomeRole(claim) === "duplicate"`). Used to render a
   * read-only "verdict follows the primary" card that names the primary's
   * confNumber and shows its current verdict, if any. Optional because
   * the picker may be invoked without the primary visible (different
   * group, paged-out, etc.) — when omitted we fall back to a generic
   * notice rather than throwing. Ignored for non-duplicate legs.
   */
  primaryClaim?: ClaimResponse | null;
}

// Pick the seed outcome for the lit-up pill on mount. Drafts win when
// they're newer than (or in the absence of) a confirmed verdict; an
// older confirmed verdict is preserved when no draft exists.
//
// IMPORTANT: `latestVerdict` from the backend is the newest *non-draft*
// row, which means it can be an `ai_suggested` row when the operator
// hasn't picked anything yet. AI suggestions MUST NOT seed the pill
// — Step 3 is an explicit operator selection. If we lit up the AI's
// suggestion as the picked pill, an operator who agrees with the AI
// would have no way to record a draft (clicking the already-selected
// pill is a no-op by design). So we ignore `latestVerdict` unless its
// source is `operator_confirmed`.
//
// Drafts (`operator_draft`) are always operator-authored, so we trust
// them as a seed regardless of source check. Only pickable outcomes
// (Approved / Denied) light up — legacy "Partial" rows are ignored
// for highlight purposes since the picker doesn't offer that pill.
function seedSelectionFrom(
  draft: ClaimVerdictResponse | null | undefined,
  confirmed: ClaimVerdictResponse | null | undefined,
): PickableOutcome | null {
  // Only operator_confirmed rows count as a real prior selection. An
  // `ai_suggested` row is a hint, never a pick.
  const operatorConfirmed =
    confirmed && confirmed.source === "operator_confirmed" ? confirmed : null;
  let chosen: ClaimVerdictResponse | null = null;
  if (draft && operatorConfirmed) {
    chosen =
      new Date(draft.createdAt).getTime() >=
      new Date(operatorConfirmed.createdAt).getTime()
        ? draft
        : operatorConfirmed;
  } else {
    chosen = draft ?? operatorConfirmed ?? null;
  }
  if (!chosen) return null;
  if (chosen.outcome === "Approved" || chosen.outcome === "Denied") {
    return chosen.outcome;
  }
  return null;
}

export function PerLegVerdictPicker({
  claim,
  latestSuggestion,
  latestVerdict,
  latestDraft,
  calibration,
  onSelect,
  primaryClaim,
}: PerLegVerdictPickerProps) {
  // Sibling-duplicate guard (Task #309). The action rail filters
  // duplicates out of `actionableRides`, so under normal data flow the
  // picker never sees one. This branch is the defense-in-depth safety
  // net: if a caller passes a duplicate leg anyway (test harness, ad
  // hoc preview, future reuse), render a muted read-only card instead
  // of the verdict buttons. Picker MUST NOT throw — duplicates derive
  // their verdict from the primary, never from a per-leg pick.
  if (outcomeRole(claim) === "duplicate") {
    const primaryRef = primaryClaim?.confNumber
      ? `#${primaryClaim.confNumber}`
      : claim.duplicateOfClaimId != null
        ? `claim ${claim.duplicateOfClaimId}`
        : "the primary leg";
    const primaryVerdict = primaryClaim?.latestVerdict?.outcome ?? null;
    return (
      <Card
        className="bg-muted/40 border-dashed"
        data-testid={`per-leg-verdict-duplicate-${claim.id}`}
      >
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2 flex-wrap text-muted-foreground">
            <Link2 className="h-4 w-4" />
            <span className="font-mono">#{claim.confNumber}</span>
            <Badge variant="outline" className="text-[10px]">
              Sibling duplicate
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="text-xs text-muted-foreground space-y-1">
          <p>
            Verdict follows the primary leg ({primaryRef}). No per-leg pick is
            recorded here.
          </p>
          {primaryVerdict && (
            <p data-testid={`duplicate-primary-verdict-${claim.id}`}>
              Primary verdict: <span className="font-medium">{primaryVerdict}</span>
            </p>
          )}
        </CardContent>
      </Card>
    );
  }

  // Mount-time seed. We only re-seed when the inbound row identities
  // change (id + createdAt of the latest draft / latest verdict) so an
  // optimistic refetch that returns the same selection doesn't clobber
  // an in-flight click.
  const seed = useMemo(
    () => seedSelectionFrom(latestDraft ?? null, latestVerdict ?? null),
    [
      latestDraft?.id,
      latestDraft?.createdAt,
      latestVerdict?.id,
      latestVerdict?.createdAt,
    ],
  );

  const [picked, setPicked] = useState<PickableOutcome | null>(seed);
  // Re-sync when the seed changes (e.g. after invalidation post-draft
  // save, or when the operator switches groups in the queue).
  const lastSeedRef = useRef<PickableOutcome | null>(seed);
  useEffect(() => {
    if (lastSeedRef.current !== seed) {
      lastSeedRef.current = seed;
      setPicked(seed);
    }
  }, [seed]);

  // We track which outcome is currently in flight so the spinner
  // lands on the right pill and we can keep the OTHER pill clickable
  // (changing your mind mid-save still works once the previous save
  // settles).
  const [submittingOutcome, setSubmittingOutcome] = useState<PickableOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Click contract (Task #343 §3): clicking the *already-selected* pill
  // is a no-op. Selections in this UI are forward-only — clearing a
  // selection isn't a real intent (the operator either picks the OTHER
  // pill or leaves the existing pick in place). Documenting here so
  // future readers don't "fix" it into a toggle-off.
  const handlePick = async (outcome: PickableOutcome) => {
    if (submittingOutcome != null) return;
    if (picked === outcome) return;
    setError(null);
    setSubmittingOutcome(outcome);
    // Optimistic: light up the new pill immediately so the click feels
    // instant. Roll back on failure.
    const previous = picked;
    setPicked(outcome);
    try {
      await onSelect(outcome);
    } catch (e) {
      setPicked(previous);
      setError(toFriendlyVerdictError(e));
    } finally {
      setSubmittingOutcome(null);
    }
  };

  const calibrationLine = useMemo(
    () => renderCalibrationLine(claim.errorTypeId, calibration),
    [claim.errorTypeId, calibration],
  );

  return (
    <Card data-testid={`per-leg-verdict-picker-${claim.id}`}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2 flex-wrap">
          <span className="font-mono">#{claim.confNumber}</span>
          {claim.errorTypeName && (
            <Badge variant="secondary" className="text-[10px]">
              {claim.errorTypeName}
            </Badge>
          )}
        </CardTitle>
        {claim.errorDetails && (
          <p
            className="text-xs text-muted-foreground line-clamp-2"
            title={claim.errorDetails}
          >
            {claim.errorDetails}
          </p>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {latestSuggestion && (
          <div
            className="rounded-md border border-blue-200 bg-blue-50 p-3 space-y-1.5 dark:bg-blue-950/30 dark:border-blue-900 dark:text-blue-100"
            data-testid={`ai-suggestion-${claim.id}`}
          >
            <div className="flex items-center gap-2 text-sm">
              <Sparkles className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              <span className="font-medium">
                AI suggests {latestSuggestion.outcome}
                {formatConfidence(latestSuggestion.confidence)}
              </span>
            </div>
            {latestSuggestion.reasoning && (
              <p className="text-xs text-muted-foreground italic line-clamp-3">
                {latestSuggestion.reasoning}
              </p>
            )}
            <p
              className="text-xs text-muted-foreground"
              data-testid={`calibration-line-${claim.id}`}
            >
              {calibrationLine}
            </p>
          </div>
        )}

        <div className="space-y-1.5">
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">
            Pick an outcome
          </Label>
          <div className="grid grid-cols-2 gap-2">
            {OUTCOMES.map((o) => (
              <Button
                key={o}
                type="button"
                variant="outline"
                size="sm"
                data-selected={picked === o}
                disabled={submittingOutcome != null && submittingOutcome !== o}
                onClick={() => handlePick(o)}
                className={OUTCOME_TONE[o]}
                data-testid={`button-pick-${o.toLowerCase()}-${claim.id}`}
              >
                {submittingOutcome === o && (
                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                )}
                {o}
              </Button>
            ))}
          </div>
        </div>

        {error && (
          <p
            className="text-xs text-red-700 bg-red-50 rounded px-2 py-1"
            data-testid={`error-confirm-${claim.id}`}
          >
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// Defensive 409-reason mapping (Task #301). The verdict endpoint returns
// `{ error, reason }` on the sop_outcome gate; orval bubbles that body
// up via `axios.error.response.data`. We translate the machine reason
// to an inline operator-friendly hint so people aren't left staring at
// a raw JSON error string. Falls back to the message verbatim for any
// other shape.
function toFriendlyVerdictError(e: unknown): string {
  if (e != null && typeof e === "object" && "response" in e) {
    const axiosErr = e as {
      response?: { data?: { error?: string; reason?: string } };
    };
    const data = axiosErr.response?.data;
    if (data?.reason === "leg_not_in_submission") {
      return "This leg wasn't part of an invoice-group submission, so the normal verdict path is closed. Use the \u201CFiled before invoice groups\u201D section to record the outcome with a note.";
    }
    if (data?.error) return data.error;
  }
  return e instanceof Error ? e.message : "Failed to record verdict.";
}

function formatConfidence(c: string | null | undefined): string {
  if (c == null) return "";
  const n = typeof c === "number" ? c : Number(c);
  if (!Number.isFinite(n)) return "";
  const pct = n <= 1 ? Math.round(n * 100) : Math.round(n);
  return ` (${pct}% confident)`;
}

function renderCalibrationLine(
  errorTypeId: string | null | undefined,
  calibration: AiCalibrationResponse | undefined,
): string {
  if (!errorTypeId) return "Not enough history yet.";
  if (!calibration) return "Loading calibration…";
  if (calibration.totalConfirmations < CALIBRATION_MIN_CONFIRMATIONS) {
    return "Not enough history yet.";
  }
  return `For this error type, AI agreed with operator on ${calibration.agreementCount} of last ${calibration.totalConfirmations} verdicts (window ${calibration.windowDays}d).`;
}
