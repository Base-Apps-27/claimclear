import { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { CheckCircle2, Loader2, Sparkles, Link2 } from "lucide-react";
import type {
  AiCalibrationResponse,
  ClaimResponse,
  ClaimVerdictResponse,
  RecordVerdictBodyOutcome,
} from "@workspace/api-client-react";
import { outcomeRole } from "@workspace/leg-state";
import { formatDateTime } from "@/lib/format";

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
  latestVerdict?: ClaimVerdictResponse | null;
  calibration?: AiCalibrationResponse;
  onConfirm: (
    outcome: VerdictOutcome,
    note: string | undefined,
    inspectionTimeMs: number,
  ) => Promise<void>;
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

export function PerLegVerdictPicker({
  claim,
  latestSuggestion,
  latestVerdict,
  calibration,
  onConfirm,
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

  const mountAt = useRef<number>(Date.now());
  useEffect(() => {
    mountAt.current = Date.now();
  }, []);

  const [picked, setPicked] = useState<PickableOutcome | null>(null);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isConfirmed =
    latestVerdict?.source === "operator_confirmed" &&
    typeof latestVerdict?.outcome === "string";

  const handleConfirm = async () => {
    if (!picked || submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const elapsed = Math.max(0, Date.now() - mountAt.current);
      await onConfirm(picked, note.trim() || undefined, elapsed);
    } catch (e) {
      setError(toFriendlyVerdictError(e));
    } finally {
      setSubmitting(false);
    }
  };

  const calibrationLine = useMemo(
    () => renderCalibrationLine(claim.errorTypeId, calibration),
    [claim.errorTypeId, calibration],
  );

  if (isConfirmed && latestVerdict) {
    return (
      <Card data-testid={`per-leg-verdict-confirmed-${claim.id}`}>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-green-600" />
            Verdict recorded — {latestVerdict.outcome}
            <Badge variant="outline" className="ml-auto font-mono text-xs">
              #{claim.confNumber}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="text-xs text-muted-foreground space-y-1">
          <div>
            {latestVerdict.createdBy ? `${latestVerdict.createdBy} · ` : ""}
            {formatDateTime(latestVerdict.createdAt)}
          </div>
          {latestVerdict.note && (
            <div className="italic whitespace-pre-wrap">{latestVerdict.note}</div>
          )}
        </CardContent>
      </Card>
    );
  }

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
                disabled={submitting}
                onClick={() => setPicked(o)}
                className={OUTCOME_TONE[o]}
                data-testid={`button-pick-${o.toLowerCase()}-${claim.id}`}
              >
                {o}
              </Button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label
            htmlFor={`verdict-note-${claim.id}`}
            className="text-xs text-muted-foreground"
          >
            Note (optional)
          </Label>
          <Textarea
            id={`verdict-note-${claim.id}`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            disabled={submitting}
            rows={2}
            placeholder="Anything the next reviewer should know."
            data-testid={`input-note-${claim.id}`}
          />
        </div>

        {error && (
          <p
            className="text-xs text-red-700 bg-red-50 rounded px-2 py-1"
            data-testid={`error-confirm-${claim.id}`}
          >
            {error}
          </p>
        )}

        <div className="flex items-center justify-end">
          <Button
            type="button"
            size="sm"
            disabled={!picked || submitting}
            onClick={handleConfirm}
            data-testid={`button-confirm-verdict-${claim.id}`}
          >
            {submitting && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
            Confirm verdict
          </Button>
        </div>
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
