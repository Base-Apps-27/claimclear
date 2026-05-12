import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCompleteGroupReattest,
  useCompleteLegMasAction,
  getListAttestationPendingQueryKey,
  getGetInvoiceGroupAttestationHistoryQueryKey,
  getGetInvoiceGroupQueryKey,
  getGetAttestationCountsQueryKey,
  getGetDashboardSummaryQueryKey,
  getGetClaimQueryKey,
} from "@workspace/api-client-react";
import type {
  ClaimResponse,
  AttestationPendingExtras,
  InvoiceGroupDetailResponse,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TonePill, TONE_STYLE } from "@/components/cohesion";
import { useToast, successToast } from "@/hooks/use-toast";
import { formatDateTime } from "@/lib/format";
import { formatRelative } from "@/lib/time";
import { formatServiceDateShort } from "./utils";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  ExternalLink,
  Lock,
  Mail,
  FileText,
  RotateCcw,
} from "lucide-react";
import type { GroupBucket } from "./group-review-pane";

export interface AttestationWizardProps {
  bucket: GroupBucket;
  detail: InvoiceGroupDetailResponse | null;
  invoiceNumber: string;
  /** Called when the operator hits "Next invoice" in the all-done step. */
  onAdvance: () => void;
}

/** Task #650 Variant B 4-step right-pane wizard. */
export function AttestationWizard({
  bucket,
  detail,
  invoiceNumber,
  onAdvance,
}: AttestationWizardProps) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const completeReattest = useCompleteGroupReattest();
  const completeLegMas = useCompleteLegMasAction();

  // Source legs from the live invoice-group detail when we have it
  // (so a teammate's mutation in another tab is reflected). Fall back
  // to the bucket's cached attestation rows when the detail hasn't
  // loaded yet.
  const allLegs: ClaimResponse[] = useMemo(() => {
    if (detail?.rides && detail.rides.length > 0) return detail.rides;
    return bucket.rows.map((r) => r.claim);
  }, [detail, bucket.rows]);

  // A leg belongs in the "cancel first" bucket when EITHER the payor
  // denied it OR the leg carries an outstanding MAS cancel obligation
  // (e.g. `sop_outcome = cannot_dispute`, which stamps
  // `mas_action_required = 'cancel'` regardless of payor outcome).
  // Mirrors the server's reattest-complete gate at
  // `routes/invoice-groups.ts` (`mas_action_required='cancel' AND
  // mas_action_completed_at IS NULL`). Without this, cannot-dispute
  // legs got bucketed as survivors, the wizard never rendered Step 2,
  // and "Re-attested in MAS" 409'd with "Not all MAS cancel actions
  // are complete" — exactly what the operator can't act on because
  // the cancel step was hidden from her.
  const needsMasCancel = (l: ClaimResponse): boolean =>
    l.outcome === "Denied" || l.masActionRequired === "cancel";
  const deniedLegs = useMemo(
    () => allLegs.filter(needsMasCancel),
    [allLegs],
  );
  const survivedLegs = useMemo(
    () => allLegs.filter((l) => !needsMasCancel(l)),
    [allLegs],
  );
  const pendingDeniedLegs = useMemo(
    () => deniedLegs.filter((l) => !l.masActionCompletedAt),
    [deniedLegs],
  );

  const hasDenied = deniedLegs.length > 0;

  // Most recent payor response across the bucket — drives Step 1's
  // "Payor reply" line.
  const lastResponse: AttestationPendingExtras | null = useMemo(() => {
    let best: AttestationPendingExtras | null = null;
    for (const row of bucket.rows) {
      const ex = row.extras;
      if (!ex?.lastResponseAt) continue;
      if (!best?.lastResponseAt || ex.lastResponseAt > best.lastResponseAt) {
        best = ex;
      }
    }
    return best;
  }, [bucket.rows]);

  const initialStep =
    !hasDenied || pendingDeniedLegs.length === 0 ? 3 : 2;
  const [step, setStep] = useState<number>(initialStep);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [reattestBusy, setReattestBusy] = useState(false);

  // Hold Step 4 ("All done") on screen for ~1.2s after a successful
  // re-attest before auto-advancing to the next bucket. This makes the
  // completion confirmation deterministic instead of relying on
  // refetch / list-invalidation timing to remove the bucket.
  const advanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (step !== 4) return;
    if (advanceTimerRef.current) clearTimeout(advanceTimerRef.current);
    advanceTimerRef.current = setTimeout(() => {
      onAdvance();
    }, 1200);
    return () => {
      if (advanceTimerRef.current) {
        clearTimeout(advanceTimerRef.current);
        advanceTimerRef.current = null;
      }
    };
  }, [step, onAdvance]);

  const enteredAge = bucket.earliestEnteredAt
    ? formatRelative(bucket.earliestEnteredAt)
    : null;
  const serviceDateLabel = useMemo(() => {
    let earliest: string | null = null;
    for (const r of bucket.rows) {
      const d = r.claim.date ?? null;
      if (!d) continue;
      if (!earliest || d < earliest) earliest = d;
    }
    return earliest;
  }, [bucket.rows]);

  const headDenied = deniedLegs[0] ?? null;
  const denialErrorType =
    headDenied?.errorTypeName ?? headDenied?.errorTypeId ?? "verdict";
  const denialConfNumber = headDenied?.confNumber ?? "—";

  const invalidateAfterMutation = async () => {
    const groupId = bucket.invoiceGroupId;
    await Promise.all([
      qc.invalidateQueries({
        queryKey: getListAttestationPendingQueryKey({ state: "pending" }),
      }),
      qc.invalidateQueries({
        queryKey: getListAttestationPendingQueryKey({ state: "queued" }),
      }),
      qc.invalidateQueries({
        queryKey: getGetInvoiceGroupAttestationHistoryQueryKey(),
      }),
      qc.invalidateQueries({ queryKey: getGetAttestationCountsQueryKey() }),
      qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() }),
      ...(groupId != null
        ? [
            qc.invalidateQueries({
              queryKey: getGetInvoiceGroupQueryKey(groupId),
            }),
          ]
        : []),
      ...bucket.rows.map((r) =>
        qc.invalidateQueries({ queryKey: getGetClaimQueryKey(r.claim.id) }),
      ),
    ]);
  };

  const onClickCancel = async () => {
    if (cancelBusy || pendingDeniedLegs.length === 0) return;
    setCancelBusy(true);
    try {
      for (const leg of pendingDeniedLegs) {
        await completeLegMas.mutateAsync({ id: leg.id, data: {} });
      }
      await invalidateAfterMutation();
      successToast({
        title: "__VERB__",
        description: `Marked ${pendingDeniedLegs.length} leg${pendingDeniedLegs.length === 1 ? "" : "s"} cancelled in MAS.`,
      });
      setStep(3);
    } catch (e) {
      const msg =
        e instanceof Error ? e.message : "Failed to mark cancelled in MAS.";
      toast({
        variant: "destructive",
        title: "Couldn't cancel in MAS",
        description: msg,
      });
    } finally {
      setCancelBusy(false);
    }
  };

  const onClickReattest = async () => {
    if (reattestBusy || bucket.invoiceGroupId == null) return;
    setReattestBusy(true);
    try {
      await completeReattest.mutateAsync({
        id: bucket.invoiceGroupId,
        data: {},
      });
      await invalidateAfterMutation();
      const total = survivedLegs.length;
      successToast({
        title: "__VERB__",
        description: `Confirmed re-attestation for invoice ${invoiceNumber || `#${bucket.invoiceGroupId}`} — ${total} leg${total === 1 ? "" : "s"} graduated.`,
      });
      setStep(4);
    } catch (e) {
      const status = (e as { response?: { status?: number } } | null)?.response
        ?.status;
      if (status === 409 && pendingDeniedLegs.length > 0) {
        const refs = pendingDeniedLegs.map((b) => b.confNumber).join(", ");
        toast({
          variant: "destructive",
          title: "Re-attestation skipped some legs",
          description: `${pendingDeniedLegs.length} leg${pendingDeniedLegs.length === 1 ? "" : "s"} on ${invoiceNumber || `#${bucket.invoiceGroupId}`} still need a MAS cancel before they can graduate: ${refs}.`,
        });
      } else {
        const msg =
          e instanceof Error
            ? e.message
            : "Failed to confirm re-attestation.";
        toast({
          variant: "destructive",
          title: "Couldn't confirm re-attestation",
          description: msg,
        });
      }
    } finally {
      setReattestBusy(false);
    }
  };

  // Visual state of step 2: "done" once every denied leg has a
  // masActionCompletedAt stamp from the live group detail.
  const step2Done = hasDenied && pendingDeniedLegs.length === 0;
  const step3Locked = hasDenied && !step2Done && step < 3;

  return (
    <div data-testid={`attestation-wizard-${bucket.key}`} className="space-y-5">
      {/* ── Header ── */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <h3
            className="font-mono text-2xl font-semibold tracking-tight"
            data-testid="wizard-invoice-heading"
          >
            {invoiceNumber || "—"}
          </h3>
          <TonePill
            tone="blue"
            className="text-[10px] uppercase tracking-wide font-bold"
          >
            Working
          </TonePill>
          <span
            className="text-xs text-muted-foreground"
            data-testid="wizard-invoice-meta"
          >
            {serviceDateLabel
              ? `Service ${formatServiceDateShort(serviceDateLabel) ?? serviceDateLabel}`
              : "No service date"}
            {" · "}
            {bucket.rows.length} {bucket.rows.length === 1 ? "leg" : "legs"}
            {enteredAge ? ` · entered ${enteredAge}` : ""}
          </span>
        </div>
        <div
          className="rounded-md px-3 py-2.5 text-sm flex items-start gap-2"
          style={{
            background: TONE_STYLE.blue.bg,
            color: TONE_STYLE.blue.fg,
            border: `1px solid ${TONE_STYLE.blue.border}`,
          }}
          data-testid="wizard-summary-band"
        >
          <ArrowRight className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>
            <strong>You're working on {invoiceNumber || "this invoice"}.</strong>{" "}
            {hasDenied ? (
              <>
                Cancel <span className="font-mono">#{denialConfNumber}</span> in
                MAS, then re-attest the surviving {survivedLegs.length} Approved{" "}
                {survivedLegs.length === 1 ? "leg" : "legs"}. Three steps below.
              </>
            ) : (
              <>
                Re-attest the {survivedLegs.length} Approved{" "}
                {survivedLegs.length === 1 ? "leg" : "legs"} in MAS. Two steps
                below.
              </>
            )}
          </span>
        </div>
      </div>

      {/* ── Step rail ── */}
      <div className="relative">
        <div
          className="absolute top-3 bottom-6 left-3 w-0.5 bg-border z-0"
          aria-hidden="true"
        />
        <div className="relative z-[1] flex flex-col gap-5">
          <Step1ReadVerdict
            step={step}
            survivedCount={survivedLegs.length}
            deniedCount={deniedLegs.length}
            denialErrorType={denialErrorType}
            lastResponse={lastResponse}
          />
          {hasDenied && (
            <Step2Cancel
              step={step}
              done={step2Done}
              busy={cancelBusy}
              denialConfNumber={denialConfNumber}
              denialErrorType={denialErrorType}
              extraDeniedConfs={deniedLegs.slice(1).map((l) => l.confNumber)}
              onConfirm={onClickCancel}
              onUndo={() => setStep(2)}
            />
          )}
          <Step3Reattest
            step={step}
            locked={step3Locked}
            hasStep2={hasDenied}
            busy={reattestBusy}
            invoiceNumber={invoiceNumber}
            survivedConfs={survivedLegs.map((l) => l.confNumber)}
            onConfirm={onClickReattest}
            onUndo={() => setStep(3)}
          />
          {step >= 4 && <Step4Done onAdvance={onAdvance} />}
        </div>
      </div>
    </div>
  );
}

function StepNumber({
  n,
  done,
  locked,
}: {
  n: number;
  done?: boolean;
  locked?: boolean;
}) {
  if (done) {
    return (
      <span
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
        style={{
          background: TONE_STYLE.green.bg,
          color: TONE_STYLE.green.fg,
          border: `1px solid ${TONE_STYLE.green.border}`,
        }}
      >
        <Check className="h-3.5 w-3.5" />
      </span>
    );
  }
  return (
    <span
      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-mono text-[11px] font-semibold border bg-card"
      style={
        locked
          ? {
              background: "hsl(var(--muted))",
              color: "hsl(var(--muted-foreground))",
              borderColor: "hsl(var(--border))",
            }
          : {
              background: TONE_STYLE.blue.bg,
              color: TONE_STYLE.blue.fg,
              borderColor: TONE_STYLE.blue.border,
            }
      }
    >
      {n}
    </span>
  );
}

function StepCard({
  active,
  locked,
  testId,
  stepNum,
  children,
}: {
  active: boolean;
  locked?: boolean;
  testId: string;
  stepNum: number;
  children: React.ReactNode;
}) {
  // Variant B contract: each step card carries a boolean
  // `wizard-step-{n}-locked` attribute when its action is gated by
  // an upstream step. `aria-disabled` is preserved for a11y.
  const lockedAttr = locked
    ? { [`wizard-step-${stepNum}-locked`]: "" }
    : {};
  return (
    <div
      className="flex-1 rounded-md border bg-card p-4"
      style={{
        borderColor: active ? "hsl(var(--primary))" : undefined,
        boxShadow: active ? "0 4px 12px rgba(0,0,0,0.04)" : undefined,
        opacity: locked ? 0.6 : 1,
      }}
      data-testid={testId}
      data-active={active ? "true" : undefined}
      data-locked={locked ? "true" : undefined}
      aria-disabled={locked ? true : undefined}
      {...lockedAttr}
    >
      {children}
    </div>
  );
}

function Step1ReadVerdict({
  step,
  survivedCount,
  deniedCount,
  denialErrorType,
  lastResponse,
}: {
  step: number;
  survivedCount: number;
  deniedCount: number;
  denialErrorType: string;
  lastResponse: AttestationPendingExtras | null;
}) {
  return (
    <div className="flex gap-4">
      <div className="pt-1">
        <StepNumber n={1} done={step > 1} />
      </div>
      <StepCard active={false} testId="wizard-step-1" stepNum={1}>
        <div className="flex items-start justify-between gap-2">
          <div className="text-sm font-semibold">Read the verdict</div>
          <span
            className="text-[10px] font-medium"
            style={{ color: TONE_STYLE.green.fg }}
          >
            Auto-checked
          </span>
        </div>
        {lastResponse?.lastResponseAt ? (
          <div className="mt-2 text-xs text-muted-foreground flex items-center gap-1.5 flex-wrap">
            {lastResponse.lastResponseSource === "email" ? (
              <Mail className="h-3 w-3" />
            ) : (
              <FileText className="h-3 w-3" />
            )}
            <span>
              Payor reply ·{" "}
              {formatDateTime(lastResponse.lastResponseAt)}
              {lastResponse.lastResponseSource
                ? ` · ${lastResponse.lastResponseSource}`
                : ""}
            </span>
          </div>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">
            No payor response on file.
          </p>
        )}
        {lastResponse?.lastResponseSubject && (
          <div
            className="mt-2 px-3 py-2 rounded-r-md italic text-sm"
            style={{
              background: "hsl(var(--muted))",
              borderLeft: `3px solid ${TONE_STYLE.muted.border}`,
            }}
          >
            "{lastResponse.lastResponseSubject}"
          </div>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <TonePill
            tone="green"
            className="text-[10px] uppercase tracking-wide font-bold"
          >
            {survivedCount} Approved
          </TonePill>
          {deniedCount > 0 && (
            <TonePill
              tone="red"
              className="text-[10px] uppercase tracking-wide font-bold"
            >
              {deniedCount} Denied ({denialErrorType})
            </TonePill>
          )}
        </div>
      </StepCard>
    </div>
  );
}

function Step2Cancel({
  step,
  done,
  busy,
  denialConfNumber,
  denialErrorType,
  extraDeniedConfs,
  onConfirm,
  onUndo,
}: {
  step: number;
  done: boolean;
  busy: boolean;
  denialConfNumber: string;
  denialErrorType: string;
  extraDeniedConfs: string[];
  onConfirm: () => void;
  onUndo: () => void;
}) {
  const active = step === 2 && !done;
  return (
    <div className="flex gap-4">
      <div className="pt-1">
        <StepNumber n={2} done={done || step > 2} />
      </div>
      <StepCard active={active} testId="wizard-step-2" stepNum={2}>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="text-sm font-semibold">
            Cancel #{denialConfNumber} in MAS
          </div>
          {active && (
            <TonePill
              tone="blue"
              className="text-[10px] uppercase tracking-wide font-bold"
            >
              Current step
            </TonePill>
          )}
        </div>
        <div className="mt-3 text-xs font-medium">Action required in MAS:</div>
        <ol className="mt-1 ml-5 list-decimal text-xs leading-relaxed text-muted-foreground space-y-0.5">
          <li>
            Search for confirmation{" "}
            <span className="font-mono">#{denialConfNumber}</span>
            {extraDeniedConfs.length > 0 && (
              <>
                {" "}
                <span className="text-muted-foreground/80">
                  (also: {extraDeniedConfs.map((c) => `#${c}`).join(", ")})
                </span>
              </>
            )}
          </li>
          <li>Open the leg details and hit <strong>Cancel</strong></li>
          <li>
            Select reason: <strong>{denialErrorType}</strong>
          </li>
          <li>Save the cancellation</li>
        </ol>
        <div className="mt-4 flex items-center gap-3 flex-wrap">
          {done ? (
            <>
              <span
                className="inline-flex items-center gap-1.5 text-xs font-medium"
                style={{ color: TONE_STYLE.green.fg }}
              >
                <CheckCircle2 className="h-3.5 w-3.5" /> Cancelled in MAS
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={onUndo}
                data-testid="wizard-cancel-undo"
              >
                <RotateCcw className="h-3 w-3 mr-1" /> Undo
              </Button>
            </>
          ) : (
            <Button
              type="button"
              size="sm"
              onClick={onConfirm}
              disabled={busy}
              data-testid="wizard-cancel-button"
            >
              <Check className="h-3.5 w-3.5 mr-1" />
              {busy ? "Saving…" : "I have cancelled this in MAS"}
            </Button>
          )}
          <a
            href="#"
            onClick={(e) => e.preventDefault()}
            className="text-xs font-medium text-primary hover:underline inline-flex items-center gap-1"
            data-testid="wizard-cancel-open-mas"
          >
            Open MAS <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </StepCard>
    </div>
  );
}

function Step3Reattest({
  step,
  locked,
  hasStep2,
  busy,
  invoiceNumber,
  survivedConfs,
  onConfirm,
  onUndo,
}: {
  step: number;
  locked: boolean;
  hasStep2: boolean;
  busy: boolean;
  invoiceNumber: string;
  survivedConfs: string[];
  onConfirm: () => void;
  onUndo: () => void;
}) {
  const active = step === 3 && !locked;
  const done = step > 3;
  return (
    <div className="flex gap-4">
      <div className="pt-1">
        <StepNumber n={3} done={done} locked={locked} />
      </div>
      <StepCard
        active={active}
        locked={locked}
        testId="wizard-step-3"
        stepNum={3}
      >
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="text-sm font-semibold inline-flex items-center gap-2">
            {locked && (
              <Lock className="h-3.5 w-3.5 text-muted-foreground" />
            )}
            Re-attest {invoiceNumber || "invoice"} in MAS
          </div>
          {active && (
            <TonePill
              tone="blue"
              className="text-[10px] uppercase tracking-wide font-bold"
            >
              Current step
            </TonePill>
          )}
          {locked && (
            <span className="text-xs text-muted-foreground">
              Available after step 2
            </span>
          )}
        </div>
        {!locked && (
          <>
            <p className="mt-3 text-xs text-muted-foreground">
              {hasStep2
                ? "Now that the denied leg is cancelled, re-attest the surviving legs together."
                : "Re-attest the Approved legs together."}
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {survivedConfs.map((c) => (
                <Badge
                  key={c}
                  variant="outline"
                  className="font-mono text-[10px] uppercase tracking-wide font-bold"
                >
                  {c}
                </Badge>
              ))}
            </div>
            <div className="mt-4 flex items-center gap-3 flex-wrap">
              {done ? (
                <>
                  <span
                    className="inline-flex items-center gap-1.5 text-xs font-medium"
                    style={{ color: TONE_STYLE.green.fg }}
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" /> Re-attested in MAS
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={onUndo}
                    data-testid="wizard-reattest-undo"
                  >
                    <RotateCcw className="h-3 w-3 mr-1" /> Undo
                  </Button>
                </>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  onClick={onConfirm}
                  disabled={busy}
                  data-testid="wizard-reattest-button"
                >
                  <Check className="h-3.5 w-3.5 mr-1" />
                  {busy ? "Saving…" : "Re-attested in MAS"}
                </Button>
              )}
              <a
                href="#"
                onClick={(e) => e.preventDefault()}
                className="text-xs font-medium text-primary hover:underline inline-flex items-center gap-1"
                data-testid="wizard-reattest-open-mas"
              >
                Open MAS <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </>
        )}
      </StepCard>
    </div>
  );
}

function Step4Done({ onAdvance }: { onAdvance: () => void }) {
  return (
    <div className="flex gap-4">
      <div className="pt-1">
        <span
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
          style={{
            background: TONE_STYLE.green.bg,
            color: TONE_STYLE.green.fg,
            border: `1px solid ${TONE_STYLE.green.border}`,
          }}
        >
          <Check className="h-3.5 w-3.5" />
        </span>
      </div>
      <div
        className="flex-1 rounded-md p-4 flex items-center gap-3"
        style={{
          background: TONE_STYLE.green.bg,
          color: TONE_STYLE.green.fg,
          border: `1px solid ${TONE_STYLE.green.border}`,
        }}
        data-testid="wizard-step-4"
      >
        <div className="flex-1">
          <div className="text-sm font-semibold">All done</div>
          <div className="text-xs opacity-90">
            Invoice successfully processed.
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onAdvance}
          data-testid="wizard-advance-button"
          className="bg-card"
        >
          Next invoice <ArrowRight className="h-3.5 w-3.5 ml-1" />
        </Button>
      </div>
    </div>
  );
}
