import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
  const completedLegs = cancelLegs.filter((r) => !!r.masActionCompletedAt);
  const reattestGated = cancelLegs.length > 0 && pendingLegs.length > 0;

  const reattestPending =
    group.reattestRequired === true && !group.reattestCompletedAt;

  if (cancelLegs.length === 0 && !reattestPending) {
    return (
      <Card data-testid="mas-action-empty">
        <CardContent className="pt-6 text-sm text-muted-foreground flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-green-600" />
          No MAS cancellations or re-attestations owed for this group.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4" data-testid="mas-action-checklist">
      {cancelLegs.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center justify-between">
              <span>MAS cancellations</span>
              <Badge variant="outline" className="font-mono">
                {completedLegs.length}/{cancelLegs.length} done
              </Badge>
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Check each leg as you cancel it in MAS. Add a reference or
              note alongside if you have one — they're optional.
            </p>
          </CardHeader>
          <CardContent className="space-y-2">
            {cancelLegs.map((claim) => (
              <MasCancelChecklistRow
                key={claim.id}
                claim={claim}
                onComplete={(body) => onCompleteLegMasAction(claim.id, body)}
              />
            ))}
          </CardContent>
        </Card>
      )}

      {reattestPending && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Re-attest surviving legs</CardTitle>
            <p className="text-xs text-muted-foreground">
              Re-attest the Approved legs in MAS, then check the box to
              finalize this group.
            </p>
          </CardHeader>
          <CardContent>
            <ReattestChecklistRow
              gated={reattestGated}
              gateReason={
                reattestGated
                  ? `Check off the ${pendingLegs.length} pending MAS cancel${pendingLegs.length === 1 ? "" : "s"} above first.`
                  : ""
              }
              onComplete={onCompleteGroupReattest}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function MasCancelChecklistRow({
  claim,
  onComplete,
}: {
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
      <div
        className="flex items-center gap-3 text-sm rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-emerald-900"
        data-testid={`mas-cancel-row-done-${claim.id}`}
      >
        <Checkbox checked disabled aria-label="MAS cancelled" />
        <CheckCircle2 className="h-4 w-4 text-emerald-700 shrink-0" />
        <span className="font-mono">#{claim.confNumber}</span>
        <span className="text-emerald-800/80 text-xs ml-auto">
          {claim.masActionCompletedBy ? `${claim.masActionCompletedBy} · ` : ""}
          {claim.masActionCompletedAt
            ? formatDateTime(claim.masActionCompletedAt)
            : ""}
        </span>
      </div>
    );
  }

  return (
    <div
      className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 space-y-2 text-amber-900"
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
        <span className="ml-auto text-xs text-muted-foreground">
          Mark cancelled in MAS
        </span>
        {submitting && (
          <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
        )}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 pt-1 border-t border-amber-200">
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
          className="text-xs text-red-700 bg-red-50 rounded px-2 py-1"
          data-testid={`error-mas-${claim.id}`}
        >
          {error}
        </p>
      )}
    </div>
  );
}

function ReattestChecklistRow({
  gated,
  gateReason,
  onComplete,
}: {
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
    <div className="space-y-3">
      {gated ? (
        <Alert variant="default" data-testid="reattest-gate">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription className="text-xs">{gateReason}</AlertDescription>
        </Alert>
      ) : (
        <Alert
          variant="default"
          className="border-emerald-200 bg-emerald-50 text-emerald-900 [&>svg]:text-emerald-700"
          data-testid="reattest-ready"
        >
          <ExternalLink className="h-4 w-4" />
          <AlertDescription className="text-xs">
            Re-attest the surviving Approved legs in MAS, then check the
            box below to finalize.
          </AlertDescription>
        </Alert>
      )}
      <div
        className={`flex items-center gap-2 text-sm rounded border px-3 py-2 ${
          gated
            ? "bg-muted/30 border-muted"
            : "bg-white border-emerald-300"
        }`}
      >
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
          className="text-xs text-red-700 bg-red-50 rounded px-2 py-1"
          data-testid="error-reattest"
        >
          {error}
        </p>
      )}
    </div>
  );
}
