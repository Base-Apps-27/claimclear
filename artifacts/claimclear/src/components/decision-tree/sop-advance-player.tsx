// Task #372 — SOP-advance player. Renders the live walk for a leg's
// decision tree, posting each step to /sop-advance so the server stays
// the source of truth. Restored to full per-step fidelity here:
//
//   - helpText, instructionText, instructionImage, instructionLink
//     all render (parity with the test/preview `TreePlayer`).
//   - evidenceRequirements render with a real per-step capture UI:
//     image upload (per /api/storage/uploads) and free-form notes.
//     The previous "acknowledged" checkbox is gone — required items
//     are satisfied only by a real attachment or non-empty text.
//   - Captured evidence is persisted via POST /api/claims/:id/evidence
//     scoped to the current treeNodeId on every advance, so the leg
//     page's existing evidence list and the dispute write-up bot pick
//     it up automatically.
//   - Previously-collected evidence for the current step (matched by
//     treeNodeId via the existing useListClaimEvidence hook) is shown
//     as read-only thumbnails / persisted-notes alongside any pending
//     items the operator is still adding.
//   - The pre-#372 autofill of `perLegContext` with a "• Q — A"
//     breadcrumb is removed entirely. Per-leg unique context is now
//     captured deliberately at the end-of-walk Include terminal with
//     an AI-clarification gate.

import * as React from "react";
import { useMemo, useState, useCallback, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

void React; // JSX runtime: keep React in scope under tsx --test (jsxFactory=React.createElement).
import {
  type DecisionTree,
  type TreeNode,
  type EvidenceReq,
  getMaxDepth,
} from "./types";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import {
  ChevronRight,
  HelpCircle,
  CheckCircle2,
  Loader2,
  Info,
  ExternalLink,
  FileText,
  Upload,
  X,
  Paperclip,
} from "lucide-react";
import { terminalKindForLeg } from "@/lib/sop-terminal-routing";
import { IncludeTerminal } from "./terminals/include-terminal";
import { ClosedTerminal } from "./terminals/closed-terminal";
import { HoldTerminal } from "./terminals/hold-terminal";
import { DuplicateTerminal } from "./terminals/duplicate-terminal";
import {
  SiblingDuplicatePrompt,
  type SiblingDuplicatePromptProps,
} from "./terminals/sibling-prompt";
import type { TerminalLeg } from "./terminals/types";
import type { ErrorTypeChannelInput } from "@/lib/sop-terminal-routing";
import {
  useListClaimEvidence,
  getListClaimEvidenceQueryKey,
} from "@workspace/api-client-react";
import type { ClaimEvidenceResponse } from "@workspace/api-client-react";

interface SopAnswerRow {
  nodeId: string;
  answer: string;
  ts: string;
}

interface LegLite extends TerminalLeg {
  errorTypeId?: string | null;
  sopAnswers?: unknown;
}

interface Props {
  leg: LegLite;
  tree: DecisionTree;
  /** Disable advancing — typically when the parent surface is locked or
   *  the leg is in a terminal sub-status the operator must reclassify out
   *  of first. Tree navigation buttons are still rendered (so the operator
   *  can read the current question) but the answer choices are disabled. */
  disabledReason?: string | null;
  /** Called after a successful `/sop-advance` POST. Lets the parent refresh
   *  related queries (group preview, leg list, etc) without this component
   *  needing to know about them. */
  onAdvanced?: (next: { isTerminal: boolean; sopOutcome: string | null }) => void;
  /** Source for the include terminal's "Channel: …" hint. Owned by the
   *  parent surface (`claim-detail-v2`) which already loads the
   *  error-types list to render the badge in the leg header. */
  errorType?: ErrorTypeChannelInput | null;
  /** When set, the in-SOP sibling-detection prompt renders above the
   *  first SOP question. The parent computes eligibility — see
   *  `lib/sop-sibling-eligibility.ts`. */
  siblingPrompt?: Omit<SiblingDuplicatePromptProps, "legId" | "invoiceGroupId"> | null;
}

function apiBase(): string {
  return import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
}

function normalizeAnswers(raw: unknown): SopAnswerRow[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((r): r is SopAnswerRow =>
    !!r && typeof r === "object" && "nodeId" in r && "answer" in r,
  );
}

// Pending evidence — image uploads and notes the operator has captured
// but not yet persisted. Cleared when /sop-advance lands successfully.
interface PendingItem {
  id: string;
  imageUrl?: string;        // /objects/... once upload completes
  imagePreview?: string;    // local blob: URL while uploading
  uploading?: boolean;
}

interface PendingPerReq {
  items: PendingItem[];
  notes: string;
}

const MAX_EVIDENCE_SIZE = 50 * 1024 * 1024;
const ALLOWED_EVIDENCE_TYPES = new Set([
  "image/png", "image/jpeg", "image/gif", "image/webp",
  "image/heic", "image/heif", "image/tiff", "image/bmp",
  "application/pdf",
]);

let __pendIdCounter = 0;
const newPendingId = () => `pend_${Date.now().toString(36)}_${(++__pendIdCounter).toString(36)}`;

/**
 * Pure: an evidence requirement is satisfied iff (and only iff) the
 * operator has supplied real content of the kind it accepts. There is
 * NO "acknowledged" checkbox short-circuit here — Task #372 explicitly
 * removed the false-satisfy shortcut so required items demand a real
 * attachment or non-empty notes.
 */
export function isReqSatisfied(args: {
  req: EvidenceReq;
  pending: PendingPerReq;
  persistedItems: ClaimEvidenceResponse[];
}): boolean {
  if (!args.req.required) return true;
  const acceptsImage = args.req.acceptsImage !== false;
  const acceptsText = args.req.acceptsText === true;
  if (acceptsImage) {
    const hasPersistedImage = args.persistedItems.some((e) => !!e.imageUrl);
    const hasPendingImage = args.pending.items.some((it) => !!it.imageUrl);
    if (hasPersistedImage || hasPendingImage) return true;
  }
  if (acceptsText) {
    const hasPersistedNote = args.persistedItems.some((e) => !!e.notes && e.notes.trim().length > 0);
    if (hasPersistedNote) return true;
    if (args.pending.notes.trim().length > 0) return true;
  }
  return false;
}

export function SopAdvancePlayer({
  leg,
  tree,
  disabledReason,
  onAdvanced,
  errorType,
  siblingPrompt,
}: Props) {
  const qc = useQueryClient();
  const disabled = !!disabledReason;
  const answers = useMemo(() => normalizeAnswers(leg.sopAnswers), [leg.sopAnswers]);
  const maxDepth = useMemo(() => getMaxDepth(tree), [tree]);

  const currentNodeId: string = leg.sopNodeId ?? tree.rootId;
  const currentNode: TreeNode | undefined = tree.nodes.find((n) => n.id === currentNodeId);

  const [pendingAnswer, setPendingAnswer] = useState<string | null>(null);

  // Per-step pending evidence keyed by `${nodeId}::${reqKey}`. Cleared
  // for the current node after a successful /sop-advance so the next
  // step starts clean. Keep across nodes so an operator who clicks back
  // and forth doesn't lose their work mid-walk.
  const [pendingByReq, setPendingByReq] = useState<Record<string, PendingPerReq>>({});
  const pendingKey = (nodeId: string, key: string) => `${nodeId}::${key}`;
  const getPending = (nodeId: string, key: string): PendingPerReq =>
    pendingByReq[pendingKey(nodeId, key)] ?? { items: [], notes: "" };
  const updatePending = (
    nodeId: string,
    key: string,
    updater: (cur: PendingPerReq) => PendingPerReq,
  ) => {
    setPendingByReq((prev) => {
      const k = pendingKey(nodeId, key);
      const cur = prev[k] ?? { items: [], notes: "" };
      return { ...prev, [k]: updater(cur) };
    });
  };

  // Server-source-of-truth evidence list. We filter to the current node
  // when rendering so the operator sees what they (or a teammate) have
  // already collected for THIS step, not a noisy mixed list.
  const { data: evidenceResp } = useListClaimEvidence(leg.id, {
    query: { queryKey: getListClaimEvidenceQueryKey(leg.id), enabled: !!leg.id },
  });
  const persistedAll: ClaimEvidenceResponse[] = useMemo(() => {
    const e = evidenceResp as { evidence?: ClaimEvidenceResponse[] } | ClaimEvidenceResponse[] | undefined;
    if (!e) return [];
    if (Array.isArray(e)) return e;
    return Array.isArray(e.evidence) ? e.evidence : [];
  }, [evidenceResp]);

  // Group persisted evidence per (nodeId, evidenceTypeName=key) so each
  // requirement row can render its own collected items / notes. We use
  // `evidenceTypeName` as the join key because that's what the POST
  // endpoint persists from the player (see persistEvidenceForCurrentNode
  // below); evidenceTypeId is optional and not always set on the tree.
  const persistedForNode = useCallback(
    (nodeId: string): Record<string, ClaimEvidenceResponse[]> => {
      const out: Record<string, ClaimEvidenceResponse[]> = {};
      for (const ev of persistedAll) {
        if (ev.treeNodeId !== nodeId) continue;
        const k = ev.evidenceTypeName;
        if (!out[k]) out[k] = [];
        out[k].push(ev);
      }
      return out;
    },
    [persistedAll],
  );

  // ---- Image upload --------------------------------------------------
  const uploadFile = useCallback(
    async (nodeId: string, key: string, file: File) => {
      if (!ALLOWED_EVIDENCE_TYPES.has(file.type)) {
        toast({
          title: "Unsupported file type",
          description: "Please upload an image (PNG, JPG, GIF, WEBP, HEIC, TIFF, BMP) or PDF.",
          variant: "destructive",
        });
        return;
      }
      if (file.size > MAX_EVIDENCE_SIZE) {
        toast({
          title: "File too large",
          description: "Please upload a file smaller than 50 MB.",
          variant: "destructive",
        });
        return;
      }
      const tempId = newPendingId();
      const previewUrl = URL.createObjectURL(file);
      updatePending(nodeId, key, (cur) => ({
        ...cur,
        items: [...cur.items, { id: tempId, uploading: true, imagePreview: previewUrl }],
      }));
      try {
        const res = await fetch(`${apiBase()}/api/storage/uploads`, {
          method: "PUT",
          headers: {
            "Content-Type": file.type,
            "x-upload-name": file.name,
          },
          credentials: "include",
          body: file,
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error || `HTTP ${res.status}`);
        }
        const { objectPath } = (await res.json()) as { objectPath: string };
        updatePending(nodeId, key, (cur) => ({
          ...cur,
          items: cur.items.map((it) =>
            it.id === tempId ? { ...it, uploading: false, imageUrl: objectPath } : it,
          ),
        }));
      } catch (err) {
        updatePending(nodeId, key, (cur) => ({
          ...cur,
          items: cur.items.filter((it) => it.id !== tempId),
        }));
        toast({
          title: "Upload failed",
          description: err instanceof Error ? err.message : "Please try again.",
          variant: "destructive",
        });
      }
    },
    [],
  );

  const removePendingItem = useCallback((nodeId: string, key: string, itemId: string) => {
    updatePending(nodeId, key, (cur) => ({
      ...cur,
      items: cur.items.filter((it) => it.id !== itemId),
    }));
  }, []);

  // ---- Persist captured evidence + advance ---------------------------
  /**
   * Persist all pending items + notes for the current node BEFORE the
   * /sop-advance call lands. We deliberately surface the failures here:
   * if any single POST fails, we surface a toast and abort the advance
   * so the operator can retry. (No silent fallback: the captured
   * evidence is the operator's record of what they actually checked.)
   */
  async function persistEvidenceForCurrentNode(node: TreeNode) {
    if (!node.evidenceRequirements?.length) return;
    for (const req of node.evidenceRequirements) {
      const pend = getPending(node.id, req.key);
      // Deliberately skip pending items still uploading — the operator
      // hasn't seen them go green yet, and posting an unset imageUrl
      // would 400. The required-item gate already forbids advancing
      // while an image upload is in flight.
      const itemsToPost = pend.items.filter((it) => it.imageUrl);
      const notes = pend.notes.trim();
      const persisted = persistedForNode(node.id)[req.key] ?? [];
      const lastPersistedNotes = persisted.find((p) => p.notes && p.notes.trim().length > 0)?.notes?.trim() ?? "";

      // Notes-only row written iff (a) there ARE notes, AND (b) they
      // differ from anything already on file. Avoids duplicate
      // notes-only rows when an operator pages back to a node and
      // re-advances without changing anything.
      const shouldPostNotes = notes.length > 0 && notes !== lastPersistedNotes;

      // Image rows: every pending item with an objectPath becomes its
      // own evidence row. We don't bind notes to the image rows — the
      // notes get their own row so the audit trail keeps them legible.
      for (const it of itemsToPost) {
        const res = await fetch(`${apiBase()}/api/claims/${leg.id}/evidence`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            evidenceTypeName: req.key,
            evidenceTypeId: req.evidenceTypeId,
            treeNodeId: node.id,
            imageUrl: it.imageUrl,
          }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error || `Evidence upload HTTP ${res.status}`);
        }
      }
      if (shouldPostNotes) {
        const res = await fetch(`${apiBase()}/api/claims/${leg.id}/evidence`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            evidenceTypeName: req.key,
            evidenceTypeId: req.evidenceTypeId,
            treeNodeId: node.id,
            notes,
          }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error || `Evidence note HTTP ${res.status}`);
        }
      }
    }
  }

  function clearPendingForNode(nodeId: string) {
    setPendingByReq((prev) => {
      const next: Record<string, PendingPerReq> = {};
      for (const [k, v] of Object.entries(prev)) {
        if (k.startsWith(`${nodeId}::`)) continue;
        next[k] = v;
      }
      return next;
    });
  }

  const advanceMutation = useMutation({
    mutationFn: async ({ nodeId, answer }: { nodeId: string; answer: string }) => {
      // Persist evidence FIRST so the leg page's existing evidence card
      // and any downstream consumers see it the moment the advance lands.
      if (currentNode) {
        await persistEvidenceForCurrentNode(currentNode);
      }
      const res = await fetch(`${apiBase()}/api/claims/${leg.id}/sop-advance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ nodeId, answer }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `HTTP ${res.status}`);
      }
      return res.json() as Promise<LegLite & { sopOutcome: string | null }>;
    },
    onSuccess: async (updated) => {
      const isTerminal = updated.sopOutcome != null;
      // Clear pending state for the node we just advanced past.
      if (currentNode) clearPendingForNode(currentNode.id);
      // Invalidate every cache key that includes this leg or its parent
      // group so the rest of the v2 surface (Aggregate Context, Legs
      // Queue, group preview gate, evidence list) reflects the new
      // server state on next render.
      qc.invalidateQueries({ queryKey: ["claim", leg.id] });
      qc.invalidateQueries({ queryKey: ["claims"] });
      qc.invalidateQueries({ queryKey: getListClaimEvidenceQueryKey(leg.id) });
      if (leg.invoiceGroupId != null) {
        qc.invalidateQueries({ queryKey: ["invoice-group", leg.invoiceGroupId] });
        qc.invalidateQueries({ queryKey: ["invoice-groups"] });
      }
      onAdvanced?.({ isTerminal, sopOutcome: updated.sopOutcome });
    },
    onError: (err: Error) => {
      toast({
        title: "Could not advance the SOP",
        description: err.message,
        variant: "destructive",
      });
    },
    onSettled: () => setPendingAnswer(null),
  });

  // Required-evidence gate for the current node. The operator cannot
  // advance until every required req has real content (image or notes).
  // Pending uploads still in flight count as "not yet satisfied" — we
  // wait for the green imageUrl before letting the gate trip.
  const evidenceReady = useMemo(() => {
    if (!currentNode?.evidenceRequirements?.length) return true;
    const persistedMap = persistedForNode(currentNode.id);
    return currentNode.evidenceRequirements.every((req) =>
      isReqSatisfied({
        req,
        pending: getPending(currentNode.id, req.key),
        persistedItems: persistedMap[req.key] ?? [],
      }),
    );
  }, [currentNode, pendingByReq, persistedForNode]);

  const anyUploading = useMemo(() => {
    if (!currentNode?.evidenceRequirements?.length) return false;
    return currentNode.evidenceRequirements.some((req) =>
      getPending(currentNode.id, req.key).items.some((it) => it.uploading),
    );
  }, [currentNode, pendingByReq]);

  const handleChoice = useCallback(
    (answer: string) => {
      if (!currentNode || disabled || advanceMutation.isPending) return;
      if (!evidenceReady) {
        toast({
          title: "Required evidence missing",
          description: "Attach an image or add notes for every required item before continuing.",
          variant: "destructive",
        });
        return;
      }
      if (anyUploading) {
        toast({
          title: "Uploads in progress",
          description: "Wait for the image upload to finish before advancing.",
        });
        return;
      }
      setPendingAnswer(answer);
      advanceMutation.mutate({ nodeId: currentNode.id, answer });
    },
    [currentNode, disabled, advanceMutation, evidenceReady, anyUploading],
  );

  // Terminal dispatch — single switch on outcomeRole-derived terminal
  // kind (Guard #1: no parallel enum, no precedence ladder copy here).
  const terminalKind = terminalKindForLeg(leg);
  if (terminalKind !== "none") {
    const terminalLeg: TerminalLeg = {
      id: leg.id,
      sopOutcome: leg.sopOutcome,
      sopNodeId: leg.sopNodeId,
      dropReason: leg.dropReason,
      duplicateOfClaimId: leg.duplicateOfClaimId,
      invoiceGroupId: leg.invoiceGroupId,
      perLegContext: leg.perLegContext,
    };
    return (
      <div className="space-y-3 min-w-0">
        {answers.length > 0 && <SopBreadcrumb tree={tree} answers={answers} />}
        {terminalKind === "include" && (
          <IncludeTerminal
            leg={terminalLeg}
            tree={tree}
            disabledReason={disabledReason}
            onAdvanced={onAdvanced}
            errorType={errorType ?? null}
          />
        )}
        {terminalKind === "closed" && (
          <ClosedTerminal
            leg={terminalLeg}
            tree={tree}
            disabledReason={disabledReason}
            onAdvanced={onAdvanced}
          />
        )}
        {terminalKind === "hold" && (
          <HoldTerminal
            leg={terminalLeg}
            tree={tree}
            disabledReason={disabledReason}
            onAdvanced={onAdvanced}
          />
        )}
        {terminalKind === "duplicate" && (
          <DuplicateTerminal
            leg={terminalLeg}
            tree={tree}
            disabledReason={disabledReason}
            onAdvanced={onAdvanced}
          />
        )}
      </div>
    );
  }

  if (!currentNode) {
    return (
      <p className="text-sm text-muted-foreground">
        Tree configuration error — node <code>{currentNodeId}</code> not found in the current
        decision tree. Reclassify the leg to recover.
      </p>
    );
  }

  const progress = maxDepth > 0 ? Math.min(100, Math.round((answers.length / maxDepth) * 100)) : 0;
  const showSiblingPrompt = !!siblingPrompt && answers.length === 0;
  const persistedHere = persistedForNode(currentNode.id);
  const hasInstructionBlock =
    currentNode.instructionText ||
    currentNode.instructionImagePath ||
    currentNode.instructionImageUrl ||
    currentNode.instructionLinkUrl;

  return (
    <div className="space-y-3 min-w-0" data-testid="sop-advance-player">
      <div className="flex items-center gap-3">
        <Progress value={progress} className="flex-1 h-2" />
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          Step {answers.length + 1}
          {maxDepth > 0 ? ` of ~${maxDepth}` : ""}
        </span>
      </div>

      {answers.length > 0 && <SopBreadcrumb tree={tree} answers={answers} />}

      {showSiblingPrompt && siblingPrompt && (
        <SiblingDuplicatePrompt
          legId={leg.id}
          invoiceGroupId={leg.invoiceGroupId ?? null}
          {...siblingPrompt}
        />
      )}

      <Card className="border-blue-200 bg-blue-50 dark:bg-blue-950/30 dark:border-blue-900">
        <CardContent className="p-4 space-y-3">
          <p className="text-sm font-semibold">{currentNode.question}</p>

          {currentNode.helpText && (
            <div className="flex items-start gap-2 bg-white dark:bg-background rounded-md p-2 border">
              <HelpCircle className="h-4 w-4 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
              <p className="text-xs text-muted-foreground">{currentNode.helpText}</p>
            </div>
          )}

          {hasInstructionBlock && (
            <div className="bg-indigo-50 dark:bg-indigo-950/20 rounded-md p-3 space-y-2" data-testid="sop-instruction-block">
              {currentNode.instructionText && (
                <>
                  <div className="flex items-center gap-1.5">
                    <Info className="h-3.5 w-3.5 text-indigo-600" />
                    <span className="text-xs font-medium text-indigo-700">Instructions</span>
                  </div>
                  <p className="text-xs text-indigo-800 whitespace-pre-line">{currentNode.instructionText}</p>
                </>
              )}
              {(() => {
                const imgSrc = currentNode.instructionImagePath || currentNode.instructionImageUrl;
                if (!imgSrc) return null;
                const src = imgSrc.startsWith("/objects/") ? `/api/storage${imgSrc}` : imgSrc;
                return <img src={src} alt="Instruction reference" className="rounded-md border max-h-48 w-auto mt-1" />;
              })()}
              {currentNode.instructionLinkUrl && (
                <a
                  href={currentNode.instructionLinkUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-indigo-700 hover:text-indigo-900 underline underline-offset-2 mt-1"
                >
                  <ExternalLink className="h-3 w-3" />
                  {currentNode.instructionLinkLabel || "Open Reference"}
                </a>
              )}
            </div>
          )}

          {currentNode.evidenceRequirements && currentNode.evidenceRequirements.length > 0 && (
            <div className="bg-violet-50 dark:bg-violet-950/20 rounded-md p-3 space-y-3" data-testid="sop-evidence-block">
              <div className="flex items-center gap-1">
                <FileText className="h-3.5 w-3.5 text-violet-600" />
                <span className="text-xs font-medium text-violet-700">Evidence needed at this step</span>
              </div>
              {currentNode.evidenceRequirements.map((req) => {
                const pending = getPending(currentNode.id, req.key);
                const persisted = persistedHere[req.key] ?? [];
                const showImage = req.acceptsImage !== false;
                const showText = req.acceptsText === true;
                const satisfied = isReqSatisfied({ req, pending, persistedItems: persisted });
                return (
                  <EvidenceReqRow
                    key={req.key}
                    req={req}
                    showImage={showImage}
                    showText={showText}
                    satisfied={satisfied}
                    pending={pending}
                    persisted={persisted}
                    onUpload={(file) => uploadFile(currentNode.id, req.key, file)}
                    onRemovePending={(itemId) => removePendingItem(currentNode.id, req.key, itemId)}
                    onNotesChange={(notes) => updatePending(currentNode.id, req.key, (cur) => ({ ...cur, notes }))}
                    disabled={disabled || advanceMutation.isPending}
                  />
                );
              })}
              {!evidenceReady && (
                <p className="text-[11px] text-amber-700 dark:text-amber-400" data-testid="sop-evidence-blocked">
                  Complete every required item before advancing.
                </p>
              )}
            </div>
          )}

          <div className="space-y-1.5">
            {currentNode.options?.map((opt, i) => {
              const isPending = advanceMutation.isPending && pendingAnswer === opt.label;
              const blockedByEvidence = !evidenceReady || anyUploading;
              return (
                <Button
                  key={`${currentNode.id}-${i}`}
                  variant="outline"
                  className="w-full justify-between text-left h-auto py-2.5"
                  disabled={disabled || advanceMutation.isPending || blockedByEvidence}
                  onClick={() => handleChoice(opt.label)}
                  data-testid={`sop-option-${i}`}
                >
                  <span className="text-sm">{opt.label}</span>
                  {isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0 ml-2" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5 opacity-60 shrink-0 ml-2" />
                  )}
                </Button>
              );
            })}
          </div>

          {disabled && disabledReason && (
            <p className="text-xs text-muted-foreground italic">{disabledReason}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function EvidenceReqRow({
  req, showImage, showText, satisfied, pending, persisted,
  onUpload, onRemovePending, onNotesChange, disabled,
}: {
  req: EvidenceReq;
  showImage: boolean;
  showText: boolean;
  satisfied: boolean;
  pending: PendingPerReq;
  persisted: ClaimEvidenceResponse[];
  onUpload: (file: File) => void;
  onRemovePending: (itemId: string) => void;
  onNotesChange: (notes: string) => void;
  disabled: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const persistedImages = persisted.filter((p) => !!p.imageUrl);
  const persistedNote = persisted.find((p) => p.notes && p.notes.trim().length > 0)?.notes ?? "";
  const totalImages = persistedImages.length + pending.items.length;

  return (
    <div className="space-y-2 bg-white dark:bg-background rounded-md p-2 border" data-testid={`sop-evidence-req-${req.key}`}>
      <div className="flex items-center gap-2 text-xs">
        <span className="font-medium">{req.label}</span>
        {req.required && <Badge variant="secondary" className="text-[9px] h-4">Required</Badge>}
        {satisfied && <CheckCircle2 className="h-3.5 w-3.5 text-green-600" data-testid={`sop-evidence-req-${req.key}-satisfied`} />}
        {showImage && totalImages > 0 && (
          <span className="text-[10px] text-muted-foreground ml-auto">
            {totalImages} image{totalImages !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {showImage && (
        <div
          className="space-y-2"
          // Paste-from-clipboard: drop a screenshot or copied PDF into
          // the row and it uploads as a pending image. Mounted at the
          // image-block level (not the textarea) so paste in either the
          // notes box OR the empty drop zone both work.
          onPaste={(e) => extractClipboardFiles(e.clipboardData).forEach(onUpload)}
          data-testid={`sop-evidence-req-${req.key}-paste-zone`}
        >
          {(persistedImages.length > 0 || pending.items.length > 0) && (
            <div className="flex flex-wrap gap-2">
              {persistedImages.map((ev) => (
                <PersistedThumbnail key={`p-${ev.id}`} ev={ev} />
              ))}
              {pending.items.map((it) => (
                <PendingThumbnail
                  key={it.id}
                  item={it}
                  onRemove={() => onRemovePending(it.id)}
                  disabled={disabled}
                />
              ))}
            </div>
          )}
          <div className="flex items-center gap-2 flex-wrap">
            <input
              ref={inputRef}
              type="file"
              className="hidden"
              accept="image/*,application/pdf"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onUpload(f);
                if (inputRef.current) inputRef.current.value = "";
              }}
              data-testid={`sop-evidence-req-${req.key}-file-input`}
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => inputRef.current?.click()}
              disabled={disabled}
              className="gap-1.5 h-7 text-xs"
              data-testid={`sop-evidence-req-${req.key}-upload-btn`}
            >
              <Upload className="h-3 w-3" />
              {totalImages > 0 ? "Add another" : "Upload image"}
            </Button>
            <span className="text-[10px] text-muted-foreground italic">
              or paste a screenshot
            </span>
          </div>
        </div>
      )}

      {showText && (
        <div className="space-y-1">
          {persistedNote && (
            <div className="text-[11px] text-muted-foreground italic flex items-start gap-1" data-testid={`sop-evidence-req-${req.key}-persisted-note`}>
              <Paperclip className="h-3 w-3 mt-0.5 shrink-0" />
              <span className="whitespace-pre-line">Saved: {persistedNote}</span>
            </div>
          )}
          <Textarea
            placeholder={`Notes for ${req.label}…`}
            value={pending.notes}
            onChange={(e) => onNotesChange(e.target.value)}
            // Paste in the notes textarea: a screenshot still uploads
            // as a pending image; plain text pastes pass through to
            // the textarea normally because we only intercept entries
            // whose `kind` is "file".
            onPaste={(e) => {
              const files = extractClipboardFiles(e.clipboardData);
              if (files.length > 0) {
                e.preventDefault();
                files.forEach(onUpload);
              }
            }}
            disabled={disabled}
            rows={2}
            className="text-xs"
            data-testid={`sop-evidence-req-${req.key}-notes`}
          />
        </div>
      )}
    </div>
  );
}

/**
 * Pure-helper extraction of File items from a ClipboardEvent's
 * DataTransfer. Returns only entries whose `kind === "file"` and whose
 * type passes the SOP-evidence allowlist. Exported so the
 * sop-advance-player tests can pin the contract without spinning up
 * jsdom + a real paste event.
 */
export function extractClipboardFiles(
  data: DataTransfer | null | undefined,
): File[] {
  if (!data || !data.items) return [];
  const out: File[] = [];
  for (let i = 0; i < data.items.length; i++) {
    const it = data.items[i];
    if (it.kind !== "file") continue;
    const f = it.getAsFile();
    if (!f) continue;
    if (!ALLOWED_EVIDENCE_TYPES.has(f.type)) continue;
    out.push(f);
  }
  return out;
}

function PersistedThumbnail({ ev }: { ev: ClaimEvidenceResponse }) {
  const url = ev.imageUrl;
  if (!url) return null;
  const src = url.startsWith("/objects/") ? `/api/storage${url}` : url;
  return (
    <a
      href={src}
      target="_blank"
      rel="noopener noreferrer"
      className="border rounded-md p-1.5 bg-muted/20 hover:bg-muted/40 transition-colors"
      title={ev.evidenceTypeName}
    >
      <img src={src} alt="Evidence" className="rounded border max-h-24 w-auto block" />
    </a>
  );
}

function PendingThumbnail({
  item, onRemove, disabled,
}: {
  item: PendingItem;
  onRemove: () => void;
  disabled: boolean;
}) {
  const src = item.imagePreview || (item.imageUrl?.startsWith("/objects/") ? `/api/storage${item.imageUrl}` : item.imageUrl);
  return (
    <div className="border rounded-md p-1.5 bg-muted/20 relative group">
      {src && <img src={src} alt="Evidence (uploading)" className="rounded border max-h-24 w-auto block" />}
      {item.uploading && (
        <div className="absolute inset-0 bg-white/60 flex items-center justify-center rounded">
          <Loader2 className="h-4 w-4 animate-spin text-violet-600" />
        </div>
      )}
      {!item.uploading && !disabled && (
        <button
          onClick={onRemove}
          className="absolute top-0.5 right-0.5 bg-red-500 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
          aria-label="Remove image"
          type="button"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

function SopBreadcrumb({ tree, answers }: { tree: DecisionTree; answers: SopAnswerRow[] }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[11px]" data-testid="sop-breadcrumb">
      {answers.map((a, i) => {
        const node = tree.nodes.find((n) => n.id === a.nodeId);
        return (
          <span
            key={`${a.nodeId}-${i}`}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border bg-muted/50"
          >
            <span className="text-muted-foreground truncate max-w-[140px]">
              {node?.question ?? a.nodeId}
            </span>
            <span className="text-muted-foreground">→</span>
            <Badge variant="secondary" className="h-4 px-1 text-[10px] font-medium">
              {a.answer}
            </Badge>
            {i < answers.length - 1 ? <ChevronRight className="h-3 w-3 opacity-50" /> : null}
          </span>
        );
      })}
      {answers.length > 0 && <CheckCircle2 className="h-3 w-3 text-green-600 ml-1" />}
    </div>
  );
}
