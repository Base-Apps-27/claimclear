import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useUpdateClaimOutcome,
  useUpdateInvoiceGroupOutcome,
  useAttachClosureEvidence,
  getGetClaimQueryKey,
  getGetClaimValidTransitionsQueryKey,
  getListClaimAuditLogsQueryKey,
  getGetInvoiceGroupQueryKey,
  getGetInvoiceGroupValidTransitionsQueryKey,
  getListClaimEvidenceQueryKey,
  getListInvoiceGroupEvidenceQueryKey,
  getListWithdrawalsQueryKey,
  type UpdateClaimOutcomeBodyClosureAccountabilityTagsItem,
  type UpdateClaimOutcomeBodyClosureReason,
  type UpdateInvoiceGroupOutcomeBodyClosureReason,
  type ClosurePersonRef,
} from "@workspace/api-client-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Plus, Trash2, X, Upload, Loader2 } from "lucide-react";
import {
  CLOSURE_CATEGORIES,
  CLOSURE_ACCOUNTABILITY_TAGS,
  CLOSURE_REASON_BANNER,
  ROOT_CAUSES_BY_CATEGORY,
  type ClosureAccountabilityTag,
  type ClosureReasonKey,
} from "./closure-options";

const NARRATIVE_MIN = 150;

const NARRATIVE_PLACEHOLDER =
  "Driver assigned 7:14a for 8:00a pickup; tracking didn't initiate until 7:52a at the midpoint of the route. Dispatcher assigned early; driver didn't start the app at pickup.";

type PersonEntry = {
  uid: string;
  name: string;
  id: string;
};

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
  onSuccess?: () => void;
};

let nextEntryUid = 0;
function newPersonEntry(): PersonEntry {
  nextEntryUid += 1;
  return { uid: `person-${nextEntryUid}`, name: "", id: "" };
}

function PersonList({
  label,
  entries,
  onChange,
  testIdPrefix,
}: {
  label: string;
  entries: PersonEntry[];
  onChange: (next: PersonEntry[]) => void;
  testIdPrefix: string;
}) {
  return (
    <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3">
      <Label className="text-xs font-semibold uppercase text-muted-foreground">{label}</Label>
      <div className="space-y-2">
        {entries.map((entry, idx) => (
          <div key={entry.uid} className="flex items-end gap-2">
            <div className="flex-1">
              <Label className="text-[11px] text-muted-foreground">Name</Label>
              <Input
                value={entry.name}
                onChange={(e) => {
                  const next = entries.slice();
                  next[idx] = { ...entry, name: e.target.value };
                  onChange(next);
                }}
                placeholder="Full name"
                data-testid={`${testIdPrefix}-${idx}-name`}
              />
            </div>
            <div className="flex-1">
              <Label className="text-[11px] text-muted-foreground">ID (if known)</Label>
              <Input
                value={entry.id}
                onChange={(e) => {
                  const next = entries.slice();
                  next[idx] = { ...entry, id: e.target.value };
                  onChange(next);
                }}
                placeholder="Optional"
                data-testid={`${testIdPrefix}-${idx}-id`}
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => onChange(entries.filter((_, i) => i !== idx))}
              disabled={entries.length === 1}
              aria-label={`Remove ${label.toLowerCase()} entry`}
              data-testid={`${testIdPrefix}-${idx}-remove`}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onChange([...entries, newPersonEntry()])}
        data-testid={`${testIdPrefix}-add`}
      >
        <Plus className="h-3.5 w-3.5" /> Add another
      </Button>
    </div>
  );
}

export function ClosureIntakeDialog({
  open,
  onOpenChange,
  target,
  reason,
  prefill,
  onSuccess,
}: ClosureIntakeDialogProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const banner = CLOSURE_REASON_BANNER[reason];

  const [category, setCategory] = useState<string>("");
  const [categoryOther, setCategoryOther] = useState("");
  const [rootCause, setRootCause] = useState<string>("");
  const [rootCauseOther, setRootCauseOther] = useState("");
  const [narrative, setNarrative] = useState("");
  const [tags, setTags] = useState<ClosureAccountabilityTag[]>([]);
  const [tagOther, setTagOther] = useState("");
  const [drivers, setDrivers] = useState<PersonEntry[]>([newPersonEntry()]);
  const [dispatchers, setDispatchers] = useState<PersonEntry[]>([newPersonEntry()]);
  const [communicatedTo, setCommunicatedTo] = useState("");
  const [uploads, setUploads] = useState<UploadedEvidence[]>([]);
  const [uploading, setUploading] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const updateClaimOutcome = useUpdateClaimOutcome();
  const updateGroupOutcome = useUpdateInvoiceGroupOutcome();
  const attachEvidence = useAttachClosureEvidence();

  const isClaim = target.kind === "claim";
  const submitting =
    (isClaim ? updateClaimOutcome.isPending : updateGroupOutcome.isPending) || uploading;

  // Reset state whenever the dialog (re)opens or the reason/prefill changes.
  useEffect(() => {
    if (!open) return;
    setCategory(prefill?.category ?? "");
    setCategoryOther("");
    setRootCause(prefill?.rootCause ?? "");
    setRootCauseOther("");
    setNarrative("");
    setTags([]);
    setTagOther("");
    setDrivers([newPersonEntry()]);
    setDispatchers([newPersonEntry()]);
    setCommunicatedTo("");
    setUploads([]);
    setSubmitError(null);
  }, [open, reason, prefill?.category, prefill?.rootCause]);

  const rootCauseOptions = useMemo(() => {
    if (!category) return [];
    return ROOT_CAUSES_BY_CATEGORY[category] ?? [];
  }, [category]);

  const narrativeLength = narrative.trim().length;
  const narrativeReady = narrativeLength >= NARRATIVE_MIN;

  const tagsValid = tags.length > 0;
  const driverEntriesValid =
    !tags.includes("driver") || drivers.some((d) => d.name.trim().length > 0);
  const dispatcherEntriesValid =
    !tags.includes("dispatcher") || dispatchers.some((d) => d.name.trim().length > 0);
  const tagOtherValid = !tags.includes("other") || tagOther.trim().length > 0;

  const categoryValid = !!category && (category !== "other" || categoryOther.trim().length > 0);
  const rootCauseValid =
    category === "other"
      ? true
      : !!rootCause && (rootCause !== "other" || rootCauseOther.trim().length > 0);

  const canSubmit =
    !submitting &&
    categoryValid &&
    rootCauseValid &&
    narrativeReady &&
    tagsValid &&
    driverEntriesValid &&
    dispatcherEntriesValid &&
    tagOtherValid;

  const toggleTag = (tag: ClosureAccountabilityTag) => {
    setTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
  };

  const handleUpload = async (file: File) => {
    setUploading(true);
    try {
      const presignRes = await fetch("/api/storage/uploads/request-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type }),
      });
      if (!presignRes.ok) throw new Error("Failed to request upload URL");
      const { uploadURL, objectPath } = await presignRes.json();
      const putRes = await fetch(uploadURL, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!putRes.ok) throw new Error("Upload failed");

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

  const personListToPayload = (entries: PersonEntry[]): ClosurePersonRef[] =>
    entries
      .filter((e) => e.name.trim().length > 0)
      .map((e) => ({
        name: e.name.trim(),
        id: e.id.trim() ? e.id.trim() : null,
      }));

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitError(null);

    const accountabilityTags = tags as UpdateClaimOutcomeBodyClosureAccountabilityTagsItem[];
    const closureCategory = category;
    const closureCategoryOther = category === "other" ? categoryOther.trim() : null;
    const closureRootCause = category === "other" ? null : rootCause;
    const closureRootCauseOther = rootCause === "other" ? rootCauseOther.trim() : null;
    const closureAccountabilityOther = tags.includes("other") ? tagOther.trim() : null;
    const closureDrivers = tags.includes("driver") ? personListToPayload(drivers) : null;
    const closureDispatchers = tags.includes("dispatcher")
      ? personListToPayload(dispatchers)
      : null;
    const closureCommunicatedTo = communicatedTo.trim() ? communicatedTo.trim() : null;

    const outcome = reason === "non_issue" ? "Non-Issue" : "Withdrawn";

    try {
      if (isClaim) {
        await updateClaimOutcome.mutateAsync({
          id: target.id,
          data: {
            outcome,
            closureReason: reason as UpdateClaimOutcomeBodyClosureReason,
            closureCategory,
            closureCategoryOther,
            closureRootCause,
            closureRootCauseOther,
            closureNarrative: narrative.trim(),
            closureAccountabilityTags: accountabilityTags,
            closureAccountabilityOther,
            closureDrivers,
            closureDispatchers,
            closureCommunicatedTo,
          },
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
          data: {
            outcome,
            closureReason: reason as UpdateInvoiceGroupOutcomeBodyClosureReason,
            closureCategory,
            closureCategoryOther,
            closureRootCause,
            closureRootCauseOther,
            closureNarrative: narrative.trim(),
            closureAccountabilityTags:
              accountabilityTags as unknown as import("@workspace/api-client-react").UpdateInvoiceGroupOutcomeBodyClosureAccountabilityTagsItem[],
            closureAccountabilityOther,
            closureDrivers,
            closureDispatchers,
            closureCommunicatedTo,
          },
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

      toast({
        title:
          reason === "non_issue"
            ? "Marked as Non-Issue — added to Withdrawals Review"
            : "Marked as Cannot Dispute — added to Withdrawals Review",
      });
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
                {CLOSURE_CATEGORIES.map((cat) => (
                  <SelectItem key={cat.value} value={cat.value}>
                    {cat.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {category === "other" && (
              <Input
                className="mt-2"
                value={categoryOther}
                onChange={(e) => setCategoryOther(e.target.value)}
                placeholder="Describe the category"
                data-testid="closure-category-other-input"
              />
            )}
          </div>

          {category && category !== "other" && (
            <div>
              <Label className="text-xs">Root cause <span className="text-destructive">*</span></Label>
              <Select value={rootCause} onValueChange={setRootCause}>
                <SelectTrigger data-testid="closure-root-cause-select">
                  <SelectValue placeholder="What actually caused this?" />
                </SelectTrigger>
                <SelectContent>
                  {rootCauseOptions.map((rc) => (
                    <SelectItem key={rc.value} value={rc.value}>
                      {rc.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {rootCause === "other" && (
                <Input
                  className="mt-2"
                  value={rootCauseOther}
                  onChange={(e) => setRootCauseOther(e.target.value)}
                  placeholder="Describe the root cause"
                  data-testid="closure-root-cause-other-input"
                />
              )}
            </div>
          )}

          <div>
            <Label className="text-xs">
              What happened? <span className="text-destructive">*</span>
            </Label>
            <Textarea
              value={narrative}
              onChange={(e) => setNarrative(e.target.value)}
              placeholder={NARRATIVE_PLACEHOLDER}
              rows={5}
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
              Who needs to hear about this? <span className="text-destructive">*</span>
            </Label>
            <div className="flex flex-wrap gap-2 mt-1">
              {CLOSURE_ACCOUNTABILITY_TAGS.map((tag) => {
                const selected = tags.includes(tag.value);
                return (
                  <button
                    key={tag.value}
                    type="button"
                    onClick={() => toggleTag(tag.value)}
                    aria-pressed={selected}
                    data-testid={`closure-tag-${tag.value}`}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                      selected
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background text-foreground border-border hover:bg-muted",
                    )}
                  >
                    {tag.label}
                  </button>
                );
              })}
            </div>
            {tags.includes("other") && (
              <Input
                className="mt-2"
                value={tagOther}
                onChange={(e) => setTagOther(e.target.value)}
                placeholder="Who else?"
                data-testid="closure-tag-other-input"
              />
            )}
          </div>

          {tags.includes("driver") && (
            <PersonList
              label="Drivers involved"
              entries={drivers}
              onChange={setDrivers}
              testIdPrefix="closure-driver"
            />
          )}

          {tags.includes("dispatcher") && (
            <PersonList
              label="Dispatchers involved"
              entries={dispatchers}
              onChange={setDispatchers}
              testIdPrefix="closure-dispatcher"
            />
          )}

          <div>
            <Label className="text-xs">Communicated to (optional)</Label>
            <Input
              className="mt-1"
              value={communicatedTo}
              onChange={(e) => setCommunicatedTo(e.target.value)}
              placeholder="e.g. Driver Jane Doe (notified 4/30), dispatch lead Carlos"
              data-testid="closure-communicated-to"
            />
            <p className="text-[11px] text-muted-foreground mt-1">
              Who has already been told about this closure? Can be edited later from the Withdrawals
              Review.
            </p>
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
            {banner.submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
