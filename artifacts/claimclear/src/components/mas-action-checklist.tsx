import * as React from "react";
import { useState } from "react";

void React;
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { TONE_STYLE } from "@/components/cohesion";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Loader2,
} from "lucide-react";
import type {
  ClaimResponse,
  InvoiceGroupDetailResponse,
} from "@workspace/api-client-react";
import { formatDateTime } from "@/lib/format";
import { firstInvoiceToken } from "@/components/attestation/utils";

export interface MasActionChecklistProps {
  group: InvoiceGroupDetailResponse;
  onCompleteLegMasAction: (
    claimId: number,
    body: { note?: string; masReference?: string },
  ) => Promise<void>;
  onCompleteGroupReattest: (body: {
    note?: string;
    masReference?: string;
  }) => Promise<void>;
}

/**
 * One numbered list. Rows are MAS cancel rows (one per leg requiring
 * cancel) followed by a single final re-attest row. The instructional
 * checklist text and the action checklist are unified — each MAS row
 * carries the `reattest-instruction-mas-{invoice}` testid for the
 * invoice it addresses, and the re-attest row carries
 * `reattest-instruction-reattest`. No nested cards anywhere; tone
 * tokens drive every status color.
 */
export function MasActionChecklist({
  group,
  onCompleteLegMasAction,
  onCompleteGroupReattest,
}: MasActionChecklistProps) {
  const rides = group.rides ?? [];
  const cancelLegs = rides.filter(
    (r) => r.masActionRequired === "cancel" && r.includedInDispute,
  );
  const pendingLegs = cancelLegs.filter((r) => !r.masActionCompletedAt);
  const reattestGated = cancelLegs.length > 0 && pendingLegs.length > 0;

  const reattestPending =
    group.reattestRequired === true && !group.reattestCompletedAt;

  if (cancelLegs.length === 0 && !reattestPending) {
    return (
      <div
        className="flex items-center gap-2 text-sm text-muted-foreground"
        data-testid="mas-action-empty"
      >
        <CheckCircle2 className="h-4 w-4" style={{ color: TONE_STYLE.green.fg }} />
        No MAS cancellations or re-attestations owed for this group.
      </div>
    );
  }

  let stepNumber = 0;

  return (
    <div data-testid="mas-action-checklist" className="space-y-3">
      <ol
        data-testid="reattest-instruction-list"
        className="space-y-3"
      >
        {cancelLegs.map((claim) => {
          stepNumber += 1;
          const invoice = firstInvoiceToken(claim) ?? group.invoiceNumber ?? "this invoice";
          return (
            <MasCancelChecklistRow
              key={claim.id}
              index={stepNumber}
              invoice={invoice}
              claim={claim}
              onComplete={(body) => onCompleteLegMasAction(claim.id, body)}
            />
          );
        })}
        {reattestPending && (
          <ReattestChecklistRow
            index={stepNumber + 1}
            gated={reattestGated}
            gateReason={
              reattestGated
                ? `Check off the ${pendingLegs.length} pending MAS cancel${pendingLegs.length === 1 ? "" : "s"} above first.`
                : ""
            }
            onComplete={onCompleteGroupReattest}
          />
        )}
      </ol>
    </div>
  );
}

function StepNumber({ n, done }: { n: number; done?: boolean }) {
  return (
    <span
      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted font-mono text-[11px] font-medium text-muted-foreground"
      style={
        done
          ? { background: TONE_STYLE.green.bg, color: TONE_STYLE.green.fg }
          : undefined
      }
    >
      {done ? <CheckCircle2 className="h-3.5 w-3.5" /> : n}
    </span>
  );
}

function MasCancelChecklistRow({
  index,
  invoice,
  claim,
  onComplete,
}: {
  index: number;
  invoice: string;
  claim: ClaimResponse;
  onComplete: (body: { note?: string; masReference?: string }) => Promise<void>;
}) {
  const [masRef, setMasRef] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isDone = !!claim.masActionCompletedAt;

  const handleToggle = async (next: boolean | "indeterminate") => {
    if (next !== true || isDone || submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      await onComplete({
        note: note.trim() || undefined,
        masReference: masRef.trim() || undefined,
      });
      setMasRef("");
      setNote("");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to mark cancelled.";
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  if (isDone) {
    return (
      <li
        className="flex items-start gap-3 rounded-md border-l-2 pl-3 py-2"
        style={{ borderLeftColor: TONE_STYLE.green.fg }}
        data-testid={`reattest-instruction-mas-${invoice}`}
      >
        <StepNumber n={index} done />
        <div className="flex-1 min-w-0">
          <div
            className="flex items-center gap-2 text-sm flex-wrap"
            data-testid={`mas-cancel-row-done-${claim.id}`}
          >
            <Checkbox checked disabled aria-label="MAS cancelled" />
            <span className="font-mono line-through opacity-70">
              #{claim.confNumber}
            </span>
            <span className="text-xs text-muted-foreground">
              In MAS · cancel / accept GPS deviation for invoice{" "}
              <span className="font-mono">#{invoice}</span>
            </span>
            <span
              className="text-xs ml-auto"
              style={{ color: TONE_STYLE.green.fg }}
            >
              {claim.masActionCompletedBy
                ? `${claim.masActionCompletedBy} · `
                : ""}
              {claim.masActionCompletedAt
                ? formatDateTime(claim.masActionCompletedAt)
                : ""}
            </span>
          </div>
        </div>
      </li>
    );
  }

  return (
    <li
      className="flex items-start gap-3 rounded-md border-l-2 pl-3 py-2"
      style={{ borderLeftColor: TONE_STYLE.amber.fg }}
      data-testid={`reattest-instruction-mas-${invoice}`}
    >
      <StepNumber n={index} />
      <div
        className="flex-1 min-w-0 space-y-2"
        data-testid={`mas-cancel-row-pending-${claim.id}`}
      >
        <div className="flex items-center gap-2 text-sm flex-wrap">
          <Checkbox
            id={`mas-cb-${claim.id}`}
            checked={false}
            disabled={submitting}
            onCheckedChange={handleToggle}
            aria-label={`Mark MAS cancelled for ${claim.confNumber}`}
            data-testid={`checkbox-mas-${claim.id}`}
          />
          <Label
            htmlFor={`mas-cb-${claim.id}`}
            className="cursor-pointer flex items-center gap-2"
          >
            <span className="font-mono">#{claim.confNumber}</span>
            {claim.errorTypeName && (
              <Badge variant="secondary" className="text-[10px]">
                {claim.errorTypeName}
              </Badge>
            )}
          </Label>
          <span className="text-xs text-muted-foreground">
            In MAS · cancel / accept GPS deviation for invoice{" "}
            <span className="font-mono">#{invoice}</span>
          </span>
          {submitting && (
            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground ml-auto" />
          )}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label
              htmlFor={`mas-ref-${claim.id}`}
              className="text-xs text-muted-foreground"
            >
              MAS reference (optional)
            </Label>
            <Input
              id={`mas-ref-${claim.id}`}
              value={masRef}
              onChange={(e) => setMasRef(e.target.value)}
              disabled={submitting}
              placeholder="e.g. MAS-CXL-12345"
              data-testid={`input-mas-ref-${claim.id}`}
            />
          </div>
          <div className="space-y-1">
            <Label
              htmlFor={`mas-note-${claim.id}`}
              className="text-xs text-muted-foreground"
            >
              Note (optional)
            </Label>
            <Textarea
              id={`mas-note-${claim.id}`}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              disabled={submitting}
              rows={2}
              data-testid={`input-mas-note-${claim.id}`}
            />
          </div>
        </div>
        {error && (
          <p
            className="text-xs rounded px-2 py-1"
            style={{
              color: TONE_STYLE.red.fg,
              background: TONE_STYLE.red.bg,
            }}
            data-testid={`error-mas-${claim.id}`}
          >
            {error}
          </p>
        )}
      </div>
    </li>
  );
}

function ReattestChecklistRow({
  index,
  gated,
  gateReason,
  onComplete,
}: {
  index: number;
  gated: boolean;
  gateReason: string;
  onComplete: (body: { note?: string; masReference?: string }) => Promise<void>;
}) {
  const [masRef, setMasRef] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleToggle = async (next: boolean | "indeterminate") => {
    if (next !== true || gated || submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      await onComplete({
        note: note.trim() || undefined,
        masReference: masRef.trim() || undefined,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to confirm re-attest.";
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <li
      className="flex items-start gap-3 rounded-md border-l-2 pl-3 py-2"
      style={{
        borderLeftColor: gated
          ? TONE_STYLE.muted.fg
          : TONE_STYLE.green.fg,
      }}
      data-testid="reattest-instruction-reattest"
    >
      <StepNumber n={index} />
      <div className="flex-1 min-w-0 space-y-2">
        <div className="text-sm font-medium">Re-attest the invoice.</div>
        {gated ? (
          <Alert variant="default" data-testid="reattest-gate">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription className="text-xs">{gateReason}</AlertDescription>
          </Alert>
        ) : (
          <Alert
            variant="default"
            data-testid="reattest-ready"
            style={{
              borderColor: TONE_STYLE.green.border,
              background: TONE_STYLE.green.bg,
              color: TONE_STYLE.green.fg,
            }}
          >
            <ExternalLink className="h-4 w-4" style={{ color: TONE_STYLE.green.fg }} />
            <AlertDescription className="text-xs">
              Re-attest the surviving Approved legs in MAS, then check the
              box below to finalize.
            </AlertDescription>
          </Alert>
        )}
        <div className="flex items-center gap-2 text-sm">
          <Checkbox
            id="reattest-cb"
            checked={false}
            disabled={gated || submitting}
            onCheckedChange={handleToggle}
            aria-label="Confirm group re-attest"
            data-testid="checkbox-reattest"
          />
          <Label
            htmlFor="reattest-cb"
            className={`font-medium ${gated ? "" : "cursor-pointer"}`}
          >
            Re-attest confirmed in MAS
          </Label>
          {submitting && (
            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground ml-auto" />
          )}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label
              htmlFor="reattest-mas-ref"
              className="text-xs text-muted-foreground"
            >
              MAS reference (optional)
            </Label>
            <Input
              id="reattest-mas-ref"
              value={masRef}
              onChange={(e) => setMasRef(e.target.value)}
              disabled={gated || submitting}
              placeholder="e.g. MAS-REATTEST-12345"
              data-testid="input-reattest-mas-ref"
            />
          </div>
          <div className="space-y-1">
            <Label
              htmlFor="reattest-note"
              className="text-xs text-muted-foreground"
            >
              Note (optional)
            </Label>
            <Textarea
              id="reattest-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              disabled={gated || submitting}
              rows={2}
              data-testid="input-reattest-note"
            />
          </div>
        </div>
        {error && (
          <p
            className="text-xs rounded px-2 py-1"
            style={{
              color: TONE_STYLE.red.fg,
              background: TONE_STYLE.red.bg,
            }}
            data-testid="error-reattest"
          >
            {error}
          </p>
        )}
      </div>
    </li>
  );
}
