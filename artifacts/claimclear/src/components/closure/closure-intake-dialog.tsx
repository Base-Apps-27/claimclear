import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { EMAIL_MESSAGE_MAX_BYTES } from "@workspace/api-zod";
import {
  useUpdateClaimOutcome,
  useUpdateInvoiceGroupOutcome,
  useAttachClosureEvidence,
  useGetClaimValidTransitions,
  useGetInvoiceGroupValidTransitions,
  getGetClaimQueryKey,
  getGetClaimValidTransitionsQueryKey,
  getListClaimAuditLogsQueryKey,
  getGetInvoiceGroupQueryKey,
  getGetInvoiceGroupValidTransitionsQueryKey,
  getListClaimEvidenceQueryKey,
  getListInvoiceGroupEvidenceQueryKey,
  getListWithdrawalsQueryKey,
  type ClosureReason as ApiClosureReason,
  type ClosureResponsibility as ApiClosureResponsibility,
} from "@workspace/api-client-react";
import {
  CLOSURE_RESPONSIBILITIES,
  CLOSURE_RESPONSIBILITY_LABELS,
  CLOSURE_RESPONSIBLE_ROLE_LABELS,
  RESPONSIBILITY_TO_ROLE,
  type ClosureResponsibility,
} from "@workspace/closure-responsibility";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useToast, successToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { X, Upload, Loader2 } from "lucide-react";
import {
  CLOSURE_CATEGORIES,
  CLOSURE_REASON_BANNER,
  assertNeverClosureReason,
  type ClosureReasonKey,
} from "./closure-options";

/**
 * Compile-time guarantee that the frontend `ClosureReasonKey` union stays in
 * lockstep with the codegen `ClosureReason` union — sourced from a single
 * shared OpenAPI component (`#/components/schemas/ClosureReason`) that is
 * `$ref`d by every request schema accepting a closure decision. If the
 * OpenAPI spec ever adds, removes, or renames a closure reason, this
 * assertion fails to compile and forces an explicit reconciliation here
 * rather than letting drift silently break runtime behavior.
 */
type _CodegenClosureReasonParity = ClosureReasonKey extends ApiClosureReason
  ? ApiClosureReason extends ClosureReasonKey
    ? true
    : never
  : never;
const _closureReasonParityCheck: _CodegenClosureReasonParity = true;
void _closureReasonParityCheck;

/**
 * Same compile-time guarantee for the new five-value
 * `ClosureResponsibility` union: the local
 * `@workspace/closure-responsibility` source of truth and the codegen
 * `ClosureResponsibility` (sourced from the shared
 * `#/components/schemas/ClosureResponsibility`) must agree exactly. Drift
 * here would silently let the slim modal post a value the server's
 * superRefine guard rejects, so we force a typecheck failure instead.
 */
type _CodegenClosureResponsibilityParity =
  ClosureResponsibility extends ApiClosureResponsibility
    ? ApiClosureResponsibility extends ClosureResponsibility
      ? true
      : never
    : never;
const _closureResponsibilityParityCheck: _CodegenClosureResponsibilityParity = true;
void _closureResponsibilityParityCheck;

// Task #888 — slim modal: lower the narrative floor (150 → 50) and trim
// the category picker to the handful of buckets the slim flow actually
// needs. The wider taxonomy still lives in `closure-options` for the
// confirm dialogs and historical surfaces.
const NARRATIVE_MIN = 50;
const SLIM_CATEGORY_VALUES = new Set([
  "gps_missing",
  "gps_partial",
  "signature_missing",
  "member_unreachable",
  "data_quirk",
  "other",
]);

const NARRATIVE_PLACEHOLDER =
  "Briefly describe what happened so the responsible team has enough context to follow up.";

type UploadedEvidence = {
  evidenceId: number;
  filename: string;
  imageUrl: string;
};

export type ClosureIntakeDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: { kind: "claim" | "group"; id: number };
  reason: ClosureReasonKey;
  prefill?: {
    category?: string;
    rootCause?: string;
  };
  /**
   * Optional pre-flight callback that runs at the start of `handleSubmit`,
   * AFTER the operator has confirmed the closure form but BEFORE the
   * closure mutation fires. Used by Task #343 Step 4 to promote per-leg
   * verdict drafts so promotion + closure happen in the same operator
   * gesture (open dialog → fill form → submit). If `beforeSubmit` rejects,
   * the dialog stays open with the error displayed and the closure
   * mutation is NOT run, so a cancel-after-open never promotes drafts.
   */
  beforeSubmit?: () => Promise<void>;
  onSuccess?: () => void;
};

export function ClosureIntakeDialog({
  open,
  onOpenChange,
  target,
  reason,
  prefill,
  beforeSubmit,
  onSuccess,
}: ClosureIntakeDialogProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const banner = CLOSURE_REASON_BANNER[reason];

  const [category, setCategory] = useState<string>("");
  const [categoryOther, setCategoryOther] = useState("");
  const [narrative, setNarrative] = useState("");
  const [responsibility, setResponsibility] = useState<ClosureResponsibility | "">("");
  const [uploads, setUploads] = useState<UploadedEvidence[]>([]);
  const [uploading, setUploading] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Task #758 — terminal-closure override: when the target outcome is
  // not in the current item's `validOutcomes` (i.e. closing from a
  // source status that doesn't normally admit this outcome), the
  // operator must justify the override with a ≥20-character reason.
  const [overrideReason, setOverrideReason] = useState("");

  const updateClaimOutcome = useUpdateClaimOutcome();
  const updateGroupOutcome = useUpdateInvoiceGroupOutcome();
  const attachEvidence = useAttachClosureEvidence();

  const isClaim = target.kind === "claim";
  const claimValidTransitions = useGetClaimValidTransitions(target.id, {
    query: {
      queryKey: getGetClaimValidTransitionsQueryKey(target.id),
      enabled: open && isClaim,
    },
  });
  const groupValidTransitions = useGetInvoiceGroupValidTransitions(target.id, {
    query: {
      queryKey: getGetInvoiceGroupValidTransitionsQueryKey(target.id),
      enabled: open && !isClaim,
    },
  });
  const submitting =
    (isClaim ? updateClaimOutcome.isPending : updateGroupOutcome.isPending) || uploading;

  // Reset state whenever the dialog (re)opens or the reason/prefill changes.
  useEffect(() => {
    if (!open) return;
    setCategory(prefill?.category ?? "");
    setCategoryOther("");
    setNarrative("");
    setResponsibility("");
    setUploads([]);
    setSubmitError(null);
    setOverrideReason("");
  }, [open, reason, prefill?.category, prefill?.rootCause]);

  // Task #888 — trimmed picker for the slim modal. Keep the full
  // taxonomy intact in @workspace/closure-options so historical surfaces
  // and the Denied-by-Payor confirm dialog stay untouched; just filter
  // it down to the buckets the slim flow actually offers.
  const slimCategories = useMemo(
    () => CLOSURE_CATEGORIES.filter((c) => SLIM_CATEGORY_VALUES.has(c.value)),
    [],
  );

  const narrativeLength = narrative.trim().length;
  const narrativeReady = narrativeLength >= NARRATIVE_MIN;

  const categoryValid = !!category && (category !== "other" || categoryOther.trim().length > 0);
  const responsibilityValid = !!responsibility;

  // Task #758 — server-driven override gating. Use the per-target
  // `terminalLane` map returned by the valid-transitions endpoint, the
  // same policy the writer uses on the server, instead of re-implementing
  // it on the client.
  // vocab-allow-next-line
  const targetOutcomeName: "Non-Issue" | "Denied" | "Withdrawn" =
    // vocab-allow-next-line
    reason === "non_issue" ? "Non-Issue" : reason === "denied_by_payor" ? "Denied" : "Withdrawn";
  const terminalLane =
    (isClaim
      ? claimValidTransitions.data?.terminalLane
      : groupValidTransitions.data?.terminalLane) ?? null;
  const requiresOverride = terminalLane?.[targetOutcomeName] === "override";
  const overrideTrimmed = overrideReason.trim();
  const overrideValid = !requiresOverride || overrideTrimmed.length >= 20;

  const canSubmit =
    !submitting &&
    categoryValid &&
    narrativeReady &&
    responsibilityValid &&
    overrideValid;

  // Live preview of who the new responsibility column will route to.
  // Drives the badge under the picker so the operator can see, before
  // they submit, which supervisor inbox (Task #889) this closure lands in.
  const routedRole = responsibility ? RESPONSIBILITY_TO_ROLE[responsibility] : null;

  const MAX_UPLOAD_SIZE = EMAIL_MESSAGE_MAX_BYTES;
  const ALLOWED_UPLOAD_TYPES = new Set([
    "image/png", "image/jpeg", "image/gif", "image/webp",
    "image/heic", "image/heif", "image/tiff", "image/bmp",
    "application/pdf",
  ]);

  const handleUpload = async (file: File) => {
    if (!ALLOWED_UPLOAD_TYPES.has(file.type)) {
      toast({ title: "Unsupported file type", description: "Please upload an image (PNG, JPG, GIF, WEBP, HEIC, TIFF, BMP) or PDF.", variant: "destructive" });
      return;
    }
    if (file.size > MAX_UPLOAD_SIZE) {
      toast({ title: "File too large", description: `This file is ${(file.size / (1024 * 1024)).toFixed(1)} MB — emails are capped at 25 MB total. Please compress or split it before uploading.`, variant: "destructive" });
      return;
    }
    setUploading(true);
    try {
      const uploadRes = await fetch("/api/storage/uploads", {
        method: "PUT",
        headers: {
          "Content-Type": file.type,
          "x-upload-name": file.name,
        },
        credentials: "include",
        body: file,
      });
      if (!uploadRes.ok) {
        const err = await uploadRes.json().catch(() => ({ error: "Upload failed" }));
        throw new Error(err.error || "Upload failed");
      }
      const { objectPath } = await uploadRes.json();

      const created = await attachEvidence.mutateAsync({
        data: {
          claimId: isClaim ? target.id : null,
          invoiceGroupId: isClaim ? null : target.id,
          evidenceTypeName: "Closure evidence",
          imageUrl: objectPath,
          notes: file.name,
          closureReasonAtAttach: reason,
        },
      });

      setUploads((prev) => [
        ...prev,
        { evidenceId: created.id, filename: file.name, imageUrl: objectPath },
      ]);
    } catch (err) {
      toast({
        title: "Upload failed",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  };

  const onFileInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    for (const file of files) {
      await handleUpload(file);
    }
  };

  const removeUpload = (evidenceId: number) => {
    setUploads((prev) => prev.filter((u) => u.evidenceId !== evidenceId));
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitError(null);

    // Pre-flight (Task #343): caller-supplied work that MUST succeed
    // before we run the actual closure mutation. Today this is used by
    // the Step 4 close-out path to promote per-leg verdict drafts to
    // operator_confirmed in the same operator gesture as closure. We
    // run it here (inside handleSubmit) rather than at dialog-open time
    // so a cancel-after-open never promotes anything. If it throws, the
    // dialog stays open with the error and the closure mutation does
    // not run.
    if (beforeSubmit) {
      try {
        await beforeSubmit();
      } catch (err: unknown) {
        const msg =
          err instanceof Error ? err.message : "Couldn't save your selections.";
        setSubmitError(msg);
        return;
      }
    }

    // Both PATCH bodies pull `closureReason` from the shared
    // `ClosureReason` component schema, so a single typed value flows
    // into either mutation — no per-schema `as` cast and no place for a
    // typo to sneak in unnoticed.
    const closureReason: ApiClosureReason = reason;
    const closureCategory = category;
    const closureCategoryOther = category === "other" ? categoryOther.trim() : null;
    const closureResponsibility = responsibility as ApiClosureResponsibility;
    // Task #758 — only attach the override block when the dialog
    // determined the closure sits outside the source-status's
    // validOutcomes envelope; otherwise the backend rejects it as
    // "override not needed".
    const overrideField = requiresOverride ? { override: { reason: overrideTrimmed } } : {};

    // The literal "Non-Issue" below is the *API enum value* (kept as-is in
    // the OpenAPI/DB contract). All operator-facing rendering of this
    // outcome routes through @workspace/vocab.
    // vocab-allow-next-line
    const outcome = ((): "Non-Issue" | "Denied" | "Withdrawn" => {
      switch (reason) {
        case "non_issue":
          // vocab-allow-next-line
          return "Non-Issue";
        case "denied_by_payor":
          return "Denied";
        case "cannot_dispute":
          return "Withdrawn";
        default:
          // Exhaustiveness guard: if a new ClosureReasonKey is added without
          // a matching outcome mapping here, this fails to compile.
          return assertNeverClosureReason(reason);
      }
    })();

    try {
      const sharedBody = {
        outcome,
        closureReason,
        closureCategory,
        closureCategoryOther,
        closureNarrative: narrative.trim(),
        closureResponsibility,
        ...overrideField,
      };
      if (isClaim) {
        await updateClaimOutcome.mutateAsync({
          id: target.id,
          data: sharedBody,
        });
        queryClient.invalidateQueries({ queryKey: getGetClaimQueryKey(target.id) });
        queryClient.invalidateQueries({
          queryKey: getGetClaimValidTransitionsQueryKey(target.id),
        });
        queryClient.invalidateQueries({ queryKey: getListClaimAuditLogsQueryKey(target.id) });
        queryClient.invalidateQueries({ queryKey: getListClaimEvidenceQueryKey(target.id) });
        queryClient.invalidateQueries({ queryKey: getListWithdrawalsQueryKey() });
      } else {
        await updateGroupOutcome.mutateAsync({
          id: target.id,
          data: sharedBody,
        });
        queryClient.invalidateQueries({ queryKey: getGetInvoiceGroupQueryKey(target.id) });
        queryClient.invalidateQueries({
          queryKey: getGetInvoiceGroupValidTransitionsQueryKey(target.id),
        });
        queryClient.invalidateQueries({
          queryKey: getListInvoiceGroupEvidenceQueryKey(target.id),
        });
        queryClient.invalidateQueries({ queryKey: getListWithdrawalsQueryKey() });
      }

      const successTitle = ((): string => {
        switch (reason) {
          case "non_issue":
            return "Marked as Non-Issue — added to Withdrawals Review";
          case "denied_by_payor":
            return "Marked as Denied by Payor — added to Withdrawals Review";
          case "cannot_dispute":
            return "Marked as Cannot Dispute — added to Withdrawals Review";
          default:
            return assertNeverClosureReason(reason);
        }
      })();
      successToast({ title: "__VERB__", description: successTitle });
      onOpenChange(false);
      onSuccess?.();
    } catch (err: any) {
      const msg =
        err?.body?.error || err?.responseBody?.error || err?.message || "Failed to record closure";
      setSubmitError(msg);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-xl max-h-[90vh] overflow-y-auto"
        data-testid="closure-intake-dialog"
      >
        <DialogHeader>
          <DialogTitle>{banner.label}</DialogTitle>
          <DialogDescription>
            Capture the structured detail a supervisor needs to follow up.
          </DialogDescription>
        </DialogHeader>

        <div
          className={cn(
            "rounded-md border px-4 py-3 text-sm font-medium",
            banner.bannerClass,
          )}
          data-testid="closure-outcome-banner"
        >
          <div className="font-semibold">{banner.label}</div>
          <div className="text-xs font-normal opacity-90 mt-0.5">{banner.description}</div>
        </div>

        <div className="space-y-4">
          <div>
            <Label className="text-xs">Category <span className="text-destructive">*</span></Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger data-testid="closure-category-select">
                <SelectValue placeholder="Pick the closest fit" />
              </SelectTrigger>
              <SelectContent>
                {slimCategories.map((cat) => (
                  <SelectItem key={cat.value} value={cat.value}>
                    {cat.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {category === "other" && (
              <input
                className="mt-2 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={categoryOther}
                onChange={(e) => setCategoryOther(e.target.value)}
                placeholder="Describe the category"
                data-testid="closure-category-other-input"
              />
            )}
          </div>

          <div>
            <Label className="text-xs">
              What happened? <span className="text-destructive">*</span>
            </Label>
            <Textarea
              value={narrative}
              onChange={(e) => setNarrative(e.target.value)}
              placeholder={NARRATIVE_PLACEHOLDER}
              rows={4}
              data-testid="closure-narrative"
            />
            <span
              className={cn(
                "text-xs",
                narrativeReady ? "text-emerald-600 font-medium" : "text-muted-foreground",
              )}
              data-testid="closure-narrative-counter"
            >
              {narrativeLength} / {NARRATIVE_MIN} minimum
            </span>
          </div>

          <div>
            <Label className="text-xs">
              Who's responsible for following up?{" "}
              <span className="text-destructive">*</span>
            </Label>
            <div
              className="mt-1 grid gap-2"
              role="radiogroup"
              aria-label="Responsibility"
              data-testid="closure-responsibility-group"
            >
              {CLOSURE_RESPONSIBILITIES.map((value) => {
                const selected = responsibility === value;
                return (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setResponsibility(value)}
                    className={cn(
                      "flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-left text-sm transition-colors",
                      selected
                        ? "border-primary bg-primary/5 text-foreground"
                        : "border-border bg-background hover:bg-muted",
                    )}
                    data-testid={`closure-responsibility-${value}`}
                  >
                    <span className="font-medium">
                      {CLOSURE_RESPONSIBILITY_LABELS[value]}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      → {CLOSURE_RESPONSIBLE_ROLE_LABELS[RESPONSIBILITY_TO_ROLE[value]]}
                    </span>
                  </button>
                );
              })}
            </div>
            {routedRole && (
              <p
                className="mt-2 text-[11px] text-muted-foreground"
                data-testid="closure-responsibility-route-badge"
              >
                Routes to{" "}
                <span className="font-semibold text-foreground">
                  {CLOSURE_RESPONSIBLE_ROLE_LABELS[routedRole]}
                </span>
                .
              </p>
            )}
          </div>

          <div>
            <Label className="text-xs">Supporting evidence (optional)</Label>
            <div className="mt-1">
              <label
                className={cn(
                  "inline-flex items-center gap-2 rounded-md border border-dashed border-border bg-muted/30 px-3 py-2 text-xs cursor-pointer hover:bg-muted",
                  uploading && "opacity-50 cursor-wait",
                )}
                data-testid="closure-evidence-uploader"
              >
                {uploading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Upload className="h-3.5 w-3.5" />
                )}
                {uploading ? "Uploading…" : "Add file"}
                <input
                  type="file"
                  className="hidden"
                  multiple
                  accept=".png,.jpg,.jpeg,.gif,.webp,.bmp,.tiff,.heic,.heif,.pdf,image/png,image/jpeg,image/gif,image/webp,image/bmp,image/tiff,image/heic,image/heif,application/pdf"
                  onChange={onFileInput}
                  disabled={uploading}
                />
              </label>
            </div>
            {uploads.length > 0 && (
              <ul className="mt-2 space-y-1" data-testid="closure-evidence-list">
                {uploads.map((u) => (
                  <li
                    key={u.evidenceId}
                    className="flex items-center justify-between rounded-md border border-border bg-muted/30 px-2 py-1 text-xs"
                  >
                    <span className="truncate">{u.filename}</span>
                    <button
                      type="button"
                      onClick={() => removeUpload(u.evidenceId)}
                      className="text-muted-foreground hover:text-destructive"
                      aria-label={`Remove ${u.filename}`}
                      data-testid={`closure-evidence-remove-${u.evidenceId}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {requiresOverride && (
            <div
              className="rounded-md border border-amber-300 bg-amber-50 p-3 space-y-2"
              data-testid="closure-override-panel"
            >
              <div className="text-xs font-semibold text-amber-900">
                Override required
              </div>
              <p className="text-[11px] text-amber-900">
                This item is in a status that doesn't normally allow closing
                as <span className="font-medium">{targetOutcomeName}</span>.
                Explain (≥20 characters) why the normal flow is being
                bypassed; this is recorded on the audit log and surfaced on
                the activity timeline.
              </p>
              <Textarea
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                rows={3}
                placeholder="e.g. Confirmed offline with payor liaison; closing per ticket #4471."
                data-testid="closure-override-reason"
              />
              <div className="text-[11px] text-amber-900/80">
                {overrideTrimmed.length}/20 characters
              </div>
            </div>
          )}

          {submitError && (
            <div
              className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
              data-testid="closure-submit-error"
            >
              {submitError}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
            data-testid="closure-cancel-button"
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className={cn(banner.submitClass)}
            data-testid="closure-submit-button"
          >
            {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {requiresOverride ? `Override and ${banner.submitLabel.toLowerCase()}` : banner.submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
