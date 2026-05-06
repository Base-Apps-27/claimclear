// SOP-advance player. Renders the live walk for a leg's decision tree
// and posts each step to /sop-advance so the server stays the source
// of truth. Renders helpText, instructionText, instructionImage,
// instructionLink, and per-step evidence capture (uploads + notes).
// Required evidence is satisfied only by a real attachment or
// non-empty text — never by an "acknowledged" checkbox.
//
// Discriminated by `mode`:
//   - "live" (default): requires `leg`, posts to /sop-advance,
//     persists evidence, renders live terminal sub-screens
//     (closed/hold/duplicate, Include Ready, PerLegContextEditor).
//   - "preview": no `leg`; local-only state advance; uploads and
//     evidence list are no-ops; renders a generic inline outcome
//     card with Undo/Restart instead of live terminals (those bind
//     to leg id and fire server mutations, which preview must avoid).
//     Used by the admin "Test Decision Tree" dialog.

import * as React from "react";
import { useMemo, useState, useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { EMAIL_MESSAGE_MAX_BYTES } from "@workspace/api-zod";

void React; // JSX runtime: keep React in scope under tsx --test (jsxFactory=React.createElement).
import {
  type DecisionTree,
  type TreeNode,
  type EvidenceReq,
  type OutcomeType,
  OUTCOME_LABELS,
  OUTCOME_COLORS,
  getMaxDepth,
} from "./types";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { markLocalAction } from "@/hooks/use-local-action-mark";
import {
  ChevronRight,
  HelpCircle,
  CheckCircle2,
  Loader2,
  Info,
  ExternalLink,
  FileText,
  X,
  Paperclip,
  FlaskConical,
  Undo2,
  RotateCcw,
} from "lucide-react";
import {
  terminalKindForLeg,
  channelHintForErrorType,
  channelHintLabel,
} from "@/lib/sop-terminal-routing";
import { ClosedTerminal } from "./terminals/closed-terminal";
import { HoldTerminal } from "./terminals/hold-terminal";
import { DuplicateTerminal } from "./terminals/duplicate-terminal";
import {
  SiblingDuplicatePrompt,
  type SiblingDuplicatePromptProps,
} from "./terminals/sibling-prompt";
import type { TerminalLeg } from "./terminals/types";
import type { ErrorTypeChannelInput } from "@/lib/sop-terminal-routing";
import { PerLegContextEditor } from "./per-leg-context-editor";
import {
  useListClaimEvidence,
  getListClaimEvidenceQueryKey,
  useGroupSopAdvance,
} from "@workspace/api-client-react";
import type {
  ClaimEvidenceResponse,
  ClaimResponse,
  BulkSopAdvanceResponse,
} from "@workspace/api-client-react";
import {
  ALLOWED_EVIDENCE_TYPES,
  MAX_EVIDENCE_SIZE,
  extractClipboardFiles,
} from "./evidence-paste";
import { EvidencePasteUpload } from "./evidence-paste-upload";

interface SopAnswerRow {
  nodeId: string;
  answer: string;
  ts: string;
}

interface LegLite extends TerminalLeg {
  errorTypeId?: string | null;
  sopAnswers?: unknown;
}

/** Optional in-memory state for preview mode. Lets a host (e.g. a
 *  saved-progress sandbox) seed the walker mid-tree. The Test
 *  Decision Tree dialog leaves it `undefined` and starts at the
 *  root. */
export interface SopAdvancePlayerPreviewState {
  currentNodeId: string;
  answers: SopAnswerRow[];
  sopOutcome: string | null;
}

interface BaseProps {
  tree: DecisionTree;
  /** Disable advancing — typically when the parent surface is locked or
   *  the leg is in a terminal sub-status the operator must reclassify out
   *  of first. */
  disabledReason?: string | null;
  /** Live mode only. Called after a successful `/sop-advance` POST. */
  onAdvanced?: (next: { isTerminal: boolean; sopOutcome: string | null }) => void;
  /** Source for the include terminal's "Channel: …" hint. */
  errorType?: ErrorTypeChannelInput | null;
  /** Live mode only. Sibling-detection prompt above the first question. */
  siblingPrompt?: Omit<SiblingDuplicatePromptProps, "legId" | "invoiceGroupId"> | null;
  /** Task #470 — Pivot B1. Number of OTHER legs in the same invoice
   *  group that are parked at this same SOP node, included in dispute,
   *  not terminal, and not sibling-duplicates. The "Apply to all
   *  matching legs" checkbox is rendered iff
   *  `currentNode.appliesPerInvoice === true` AND this is `> 0` AND the
   *  current leg has an invoiceGroupId. Live mode only. */
  bulkSiblingCount?: number;
}

interface LiveProps extends BaseProps {
  mode?: "live";
  leg: LegLite;
}

interface PreviewProps extends BaseProps {
  mode: "preview";
  /** Optional starting state. Defaults to `rootId` with no answers. */
  initialState?: SopAdvancePlayerPreviewState;
}

type Props = LiveProps | PreviewProps;

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

  const MAX_EVIDENCE_SIZE_CENTRAL = EMAIL_MESSAGE_MAX_BYTES;
let __pendIdCounter = 0;
const newPendingId = () => `pend_${Date.now().toString(36)}_${(++__pendIdCounter).toString(36)}`;

/**
 * Pure: an evidence requirement is satisfied iff (and only iff) the
 * operator has supplied real content of the kind it accepts. There is
 * NO "acknowledged" checkbox short-circuit — required items demand a
 * real attachment or non-empty notes.
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

/** Synthetic leg used as the rendering source-of-truth in preview
 *  mode. Mirrors the LegLite shape so the rest of the component is
 *  identical to live. */
function synthesizePreviewLeg(state: {
  currentNodeId: string | null;
  answers: SopAnswerRow[];
  sopOutcome: string | null;
}): LegLite {
  return {
    id: 0,
    sopOutcome: state.sopOutcome,
    sopNodeId: state.currentNodeId,
    sopAnswers: state.answers,
    invoiceGroupId: null,
    duplicateOfClaimId: null,
    dropReason: null,
    perLegContext: null,
  };
}

export function SopAdvancePlayer(props: Props) {
  const { tree, disabledReason, onAdvanced, errorType, siblingPrompt, bulkSiblingCount = 0 } = props;
  const isPreview = props.mode === "preview";
  const qc = useQueryClient();
  const disabled = !!disabledReason;
  const maxDepth = useMemo(() => getMaxDepth(tree), [tree]);

  // Preview-mode local state. Hooks are always declared; they're inert
  // in live mode because nothing reads them.
  const previewInit = isPreview ? props.initialState : undefined;
  const [previewNodeId, setPreviewNodeId] = useState<string | null>(
    previewInit?.currentNodeId ?? tree.rootId,
  );
  const [previewAnswers, setPreviewAnswers] = useState<SopAnswerRow[]>(
    previewInit?.answers ?? [],
  );
  const [previewSopOutcome, setPreviewSopOutcome] = useState<string | null>(
    previewInit?.sopOutcome ?? null,
  );

  // Live uses the prop leg; preview synthesizes one from local state.
  const leg: LegLite = isPreview
    ? synthesizePreviewLeg({
        currentNodeId: previewNodeId,
        answers: previewAnswers,
        sopOutcome: previewSopOutcome,
      })
    : props.leg;

  const answers = useMemo(() => normalizeAnswers(leg.sopAnswers), [leg.sopAnswers]);

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

  // Server-source-of-truth evidence list. Disabled in preview mode so
  // the rendering layer always falls through to an empty `persistedAll`.
  const { data: evidenceResp } = useListClaimEvidence(isPreview ? 0 : leg.id, {
    query: {
      queryKey: getListClaimEvidenceQueryKey(isPreview ? 0 : leg.id),
      enabled: !isPreview && !!leg.id,
    },
  });
  const persistedAll: ClaimEvidenceResponse[] = useMemo(() => {
    if (isPreview) return [];
    const e = evidenceResp as { evidence?: ClaimEvidenceResponse[] } | ClaimEvidenceResponse[] | undefined;
    if (!e) return [];
    if (Array.isArray(e)) return e;
    return Array.isArray(e.evidence) ? e.evidence : [];
  }, [evidenceResp, isPreview]);

  // Group persisted evidence per (nodeId, evidenceTypeName=key) so each
  // requirement row can render its own collected items / notes. We use
  // `evidenceTypeName` as the join key because that's what the POST
  // endpoint persists from the player; evidenceTypeId is optional and
  // not always set on the tree.
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
          description: `This file is ${(file.size / (1024 * 1024)).toFixed(1)} MB — emails are capped at 25 MB total. Please compress or split it before uploading.`,
          variant: "destructive",
        });
        return;
      }
      const tempId = newPendingId();
      const previewUrl = URL.createObjectURL(file);

      // Preview mode: skip the storage POST. Treat the blob URL as
      // both the local preview AND the `imageUrl`, so isReqSatisfied
      // trips green without ever talking to the server.
      if (isPreview) {
        updatePending(nodeId, key, (cur) => ({
          ...cur,
          items: [
            ...cur.items,
            { id: tempId, uploading: false, imagePreview: previewUrl, imageUrl: previewUrl },
          ],
        }));
        return;
      }

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
    [isPreview, leg.id],
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

  // Task #470 — Pivot B1. Local toggle for the per-step "Apply to all
  // matching legs" checkbox. Reset to false whenever the leg or the
  // current node changes — a one-shot opt-in, never sticky.
  const [bulkApply, setBulkApply] = useState(false);
  const currentNodeIdForReset = !isPreview ? leg.sopNodeId ?? null : null;
  const legIdForReset = !isPreview ? leg.id : 0;
  React.useEffect(() => {
    setBulkApply(false);
  }, [legIdForReset, currentNodeIdForReset]);

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
      // Task #495 — leave a local mark so the leg-level "you finished
      // a thing" microinteraction (claim-detail-v2 + leg-conclusion-row)
      // can fire on the operator's own SOP advance even if the SSE
      // author tag hasn't propagated yet. See use-local-action-mark.
      markLocalAction(`claim:${leg.id}`);
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

  // Task #470 — Pivot B1. Bulk advance for matching legs in the parent
  // group. Uses the generated useGroupSopAdvance hook so the body /
  // response shape stays in lock-step with openapi.yaml. The toast
  // surfaces a truncated-at-5 list of skipped refs so the operator can
  // pivot without leaving the page.
  const bulkAdvanceMutation = useGroupSopAdvance<Error>({
    mutation: {
      onSuccess: async (result: BulkSopAdvanceResponse) => {
        // Task #495 — bulk advance can resolve sibling legs en masse;
        // mark each affected claim id and the parent group so any
        // mounted leg/group watcher animates on this operator's action.
        for (const c of (result.succeeded ?? []) as ClaimResponse[]) {
          if (typeof c.id === "number") {
            markLocalAction(`claim:${c.id}`);
          }
        }
        if (leg.invoiceGroupId != null) {
          markLocalAction(`group:${leg.invoiceGroupId}`);
        }
        if (currentNode) clearPendingForNode(currentNode.id);
        qc.invalidateQueries({ queryKey: ["claim", leg.id] });
        qc.invalidateQueries({ queryKey: ["claims"] });
        qc.invalidateQueries({ queryKey: getListClaimEvidenceQueryKey(leg.id) });
        if (leg.invoiceGroupId != null) {
          qc.invalidateQueries({ queryKey: ["invoice-group", leg.invoiceGroupId] });
          qc.invalidateQueries({ queryKey: ["invoice-groups"] });
        }
        const succeeded = result.succeeded ?? [];
        // Invalidate every affected sibling leg's detail+evidence keys so
        // open detail views in other tabs/panels reflect the new state
        // without a manual refresh.
        for (const c of succeeded as ClaimResponse[]) {
          if (c.id === leg.id) continue;
          qc.invalidateQueries({ queryKey: ["claim", c.id] });
          qc.invalidateQueries({ queryKey: getListClaimEvidenceQueryKey(c.id) });
        }
        const skipped = result.skipped ?? [];
        const truncatedRefs = skipped.slice(0, 5).map((s) => s.ref);
        const skippedDescription = skipped.length === 0
          ? undefined
          : skipped.length <= 5
            ? `Skipped: ${truncatedRefs.join(", ")}`
            : `Skipped: ${truncatedRefs.join(", ")} +${skipped.length - 5} more`;
        toast({
          title: `Applied to ${succeeded.length} leg${succeeded.length === 1 ? "" : "s"}` +
            (skipped.length > 0 ? ` (skipped ${skipped.length})` : ""),
          description: skippedDescription,
        });
        // The succeeded array is full ClaimResponse[] — find our leg by
        // id to drive the parent page reaction (terminal vs mid-walk).
        const mine = (succeeded as ClaimResponse[]).find((c) => c.id === leg.id);
        if (mine) {
          onAdvanced?.({
            isTerminal: mine.sopOutcome != null,
            sopOutcome: mine.sopOutcome ?? null,
          });
        }
        setBulkApply(false);
        setPendingAnswer(null);
      },
      onError: (err: Error) => {
        // The generated mutation surfaces the server's `code` /
        // `reason` body via err.message when orval-fetch is configured
        // for it. Fall back to the raw message otherwise.
        const raw = err.message ?? "";
        let title = "Could not bulk-advance the SOP";
        let description = raw;
        if (raw.includes("node_not_bulk_eligible")) {
          title = "Bulk advance not available for this step";
          description = "This SOP step needs a per-leg answer or per-leg evidence. Uncheck \"Apply to all matching legs\" to continue.";
        } else if (raw.includes("no_eligible_legs")) {
          title = "No matching legs to advance";
          description = "Use a per-leg advance instead.";
        }
        toast({ title, description, variant: "destructive" });
        setPendingAnswer(null);
      },
    },
  });

  // Wrapper that mirrors the previous .mutate({nodeId,answer}) shape so
  // existing call-sites don't have to change. Persists current-node
  // evidence first so the bulk advance doesn't out-race the upload.
  const triggerBulkAdvance = useCallback(
    async ({ nodeId, answer }: { nodeId: string; answer: string }) => {
      if (isPreview) return;
      const groupId = leg.invoiceGroupId;
      if (groupId == null) {
        toast({
          title: "Could not bulk-advance the SOP",
          description: "Leg has no invoice group.",
          variant: "destructive",
        });
        setPendingAnswer(null);
        return;
      }
      if (currentNode) {
        await persistEvidenceForCurrentNode(currentNode);
      }
      bulkAdvanceMutation.mutate({ id: groupId, data: { nodeId, answer } });
    },
    [bulkAdvanceMutation, currentNode, isPreview, leg.invoiceGroupId, persistEvidenceForCurrentNode, toast],
  );

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

  // ---- Preview-mode advance / undo / restart -----------------------
  // Pure local-state transitions. No fetch, no toast unless the
  // gating UX needs it (the existing `evidenceReady` / `anyUploading`
  // gates apply identically to preview mode — even Test Mode forces
  // the operator through the required-evidence flow so the dialog
  // surfaces gating bugs).
  const handlePreviewAdvance = useCallback(
    (answer: string) => {
      if (!currentNode) return;
      const opt = currentNode.options.find((o) => o.label === answer);
      if (!opt) return;
      const nextAnswers = [
        ...previewAnswers,
        { nodeId: currentNode.id, answer, ts: new Date().toISOString() },
      ];
      setPreviewAnswers(nextAnswers);
      if (opt.childId) {
        setPreviewNodeId(opt.childId);
      } else if (opt.outcomeType) {
        // Terminal — record the outcome locally; render switches to
        // the inline outcome card on next render.
        setPreviewSopOutcome(opt.outcomeType);
      } else {
        // Misconfigured option (no childId, no outcomeType). Surface
        // it so authors notice while testing rather than silently
        // dead-ending.
        toast({
          title: "Option not configured",
          description: `"${opt.label}" has no next step or outcome configured.`,
          variant: "destructive",
        });
      }
      clearPendingForNode(currentNode.id);
    },
    [currentNode, previewAnswers],
  );

  const handlePreviewUndo = useCallback(() => {
    if (previewAnswers.length === 0) return;
    const last = previewAnswers[previewAnswers.length - 1];
    setPreviewAnswers(previewAnswers.slice(0, -1));
    setPreviewNodeId(last.nodeId);
    setPreviewSopOutcome(null);
  }, [previewAnswers]);

  const handlePreviewRestart = useCallback(() => {
    setPreviewAnswers([]);
    setPreviewNodeId(tree.rootId);
    setPreviewSopOutcome(null);
    setPendingByReq({});
  }, [tree.rootId]);

  const handleChoice = useCallback(
    (answer: string) => {
      if (!currentNode || disabled) return;
      if (!isPreview && (advanceMutation.isPending || bulkAdvanceMutation.isPending)) return;
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
      if (isPreview) {
        handlePreviewAdvance(answer);
        return;
      }
      setPendingAnswer(answer);
      // Task #470 — Pivot B1. If the operator opted into "Apply to all
      // matching legs" AND the current node is bulk-eligible AND there
      // are sibling legs, route through the group endpoint. Otherwise
      // fall through to the per-leg path unchanged.
      if (
        bulkApply &&
        currentNode.appliesPerInvoice === true &&
        bulkSiblingCount > 0 &&
        leg.invoiceGroupId != null
      ) {
        void triggerBulkAdvance({ nodeId: currentNode.id, answer });
        return;
      }
      advanceMutation.mutate({ nodeId: currentNode.id, answer });
    },
    [
      currentNode,
      disabled,
      isPreview,
      advanceMutation,
      bulkAdvanceMutation,
      triggerBulkAdvance,
      evidenceReady,
      anyUploading,
      handlePreviewAdvance,
      bulkApply,
      bulkSiblingCount,
      leg,
    ],
  );

  // ---- Preview mode: simple inline outcome card --------------------
  // When a preview walk lands at a terminal we render an inline
  // outcome card with Undo/Restart instead of dispatching to the live
  // ClosedTerminal/HoldTerminal/DuplicateTerminal/Include screens
  // (which all assume a real leg.id and fire mutations on click).
  if (isPreview && previewSopOutcome) {
    return (
      <div className="space-y-3 min-w-0" data-testid="sop-advance-player">
        <PreviewModeBadge />
        {previewAnswers.length > 0 && <SopBreadcrumb tree={tree} answers={previewAnswers} />}
        <PreviewOutcomeCard
          outcomeType={previewSopOutcome as OutcomeType}
          onUndo={handlePreviewUndo}
          onRestart={handlePreviewRestart}
        />
      </div>
    );
  }

  // Terminal dispatch (live mode) — single switch on outcomeRole-derived
  // terminal kind. Closed/Hold/Duplicate keep their dedicated terminal
  // screens; Include renders an inline "Ready" confirmation alongside
  // the same `PerLegContextEditor` that runs during the walk.
  const terminalKind = terminalKindForLeg(leg);
  if (terminalKind !== "none" && terminalKind !== "include") {
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

  if (terminalKind === "include") {
    const channelHint = channelHintForErrorType(errorType);
    return (
      <div className="space-y-3 min-w-0" data-testid="sop-advance-player">
        {answers.length > 0 && <SopBreadcrumb tree={tree} answers={answers} />}
        <Card
          className="border-emerald-200 bg-emerald-50 dark:bg-emerald-950/30 dark:border-emerald-900"
          data-testid="sop-include-ready-card"
        >
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-emerald-700 dark:text-emerald-300" />
              <p
                className="text-base font-semibold text-emerald-800 dark:text-emerald-200"
                data-testid="sop-include-ready-label"
              >
                Ready
              </p>
            </div>
            <p
              className="text-xs text-muted-foreground"
              data-testid="sop-include-channel-hint"
            >
              {channelHintLabel(channelHint)}
            </p>
            {disabled && disabledReason && (
              <p className="text-xs text-muted-foreground italic">{disabledReason}</p>
            )}
          </CardContent>
        </Card>
        <PerLegContextEditor
          legId={leg.id}
          perLegContext={leg.perLegContext ?? null}
          disabled={disabled}
          disabledReason={disabledReason}
        />
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
  const showSiblingPrompt = !isPreview && !!siblingPrompt && answers.length === 0;
  const persistedHere = persistedForNode(currentNode.id);
  const hasInstructionBlock =
    currentNode.instructionText ||
    currentNode.instructionImagePath ||
    currentNode.instructionImageUrl ||
    currentNode.instructionLinkUrl;

  return (
    <div className="space-y-3 min-w-0" data-testid="sop-advance-player">
      {isPreview && <PreviewModeBadge />}
      <div className="flex items-center gap-3">
        <Progress value={progress} className="flex-1 h-2" />
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          Step {answers.length + 1}
          {maxDepth > 0 ? ` of ~${maxDepth}` : ""}
        </span>
        {isPreview && (
          <div className="flex items-center gap-1">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs gap-1"
              onClick={handlePreviewUndo}
              disabled={previewAnswers.length === 0}
              data-testid="sop-preview-undo"
            >
              <Undo2 className="h-3 w-3" />
              Undo
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs gap-1"
              onClick={handlePreviewRestart}
              disabled={previewAnswers.length === 0}
              data-testid="sop-preview-restart"
            >
              <RotateCcw className="h-3 w-3" />
              Restart
            </Button>
          </div>
        )}
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
                    disabled={disabled || (!isPreview && advanceMutation.isPending)}
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
              const isPending = !isPreview &&
                (advanceMutation.isPending || bulkAdvanceMutation.isPending) &&
                pendingAnswer === opt.label;
              const blockedByEvidence = !evidenceReady || anyUploading;
              return (
                <Button
                  key={`${currentNode.id}-${i}`}
                  variant="outline"
                  className="w-full justify-between text-left h-auto py-2.5"
                  disabled={
                    disabled ||
                    (!isPreview && (advanceMutation.isPending || bulkAdvanceMutation.isPending)) ||
                    blockedByEvidence
                  }
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
            {/* Task #470 — Pivot B1. The opt-in is rendered ONLY when the
                node is authored bulk-eligible, the leg has a parent group,
                and there are matching sibling legs to advance. Reset to
                false on every leg/node change. */}
            {!isPreview &&
              currentNode.appliesPerInvoice === true &&
              bulkSiblingCount > 0 &&
              leg.invoiceGroupId != null && (
                <label
                  className="flex items-start gap-2 mt-2 p-2 rounded-md border border-blue-200 bg-blue-50 dark:bg-blue-950/20 dark:border-blue-900 cursor-pointer"
                  data-testid="sop-bulk-apply-toggle"
                >
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={bulkApply}
                    onChange={(e) => setBulkApply(e.target.checked)}
                    disabled={
                      disabled ||
                      advanceMutation.isPending ||
                      bulkAdvanceMutation.isPending
                    }
                  />
                  <span className="text-xs text-blue-900 dark:text-blue-200 leading-snug">
                    <span className="font-medium">Apply to all matching legs</span>
                    {" — "}
                    {bulkSiblingCount} other leg{bulkSiblingCount === 1 ? "" : "s"} in this
                    invoice {bulkSiblingCount === 1 ? "is" : "are"} parked at this same step.
                    Choosing an answer below will apply it to every matching leg in one go.
                  </span>
                </label>
              )}
          </div>

          {disabled && disabledReason && (
            <p className="text-xs text-muted-foreground italic">{disabledReason}</p>
          )}
        </CardContent>
      </Card>

      {/*
        Per-leg unique-context editor. Rendered inline on EVERY step of
        the walk so operators can capture context as they go. The same
        component also renders on the inline "Ready" surface above when
        the leg lands at an include outcome, so context can still be
        added/edited post-terminal. Preview mode skips it — there is no
        leg.id to bind it to.
      */}
      {!isPreview && (
        <PerLegContextEditor
          legId={leg.id}
          perLegContext={leg.perLegContext ?? null}
          disabled={disabled}
          disabledReason={disabledReason}
        />
      )}
    </div>
  );
}

function PreviewModeBadge() {
  return (
    <div
      className="flex items-center gap-2 px-2 py-1 rounded-md border bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900"
      data-testid="sop-preview-mode-badge"
    >
      <FlaskConical className="h-3.5 w-3.5 text-amber-700 dark:text-amber-300" />
      <span className="text-[11px] font-medium text-amber-800 dark:text-amber-200">
        Test Mode — no changes are saved
      </span>
    </div>
  );
}

function PreviewOutcomeCard({
  outcomeType,
  onUndo,
  onRestart,
}: {
  outcomeType: OutcomeType;
  onUndo: () => void;
  onRestart: () => void;
}) {
  const colors = OUTCOME_COLORS[outcomeType] ?? OUTCOME_COLORS.cannot_dispute;
  const label = OUTCOME_LABELS[outcomeType] ?? outcomeType;
  return (
    <Card
      className={`${colors.bg} border ${colors.border}`}
      data-testid="sop-preview-outcome-card"
    >
      <CardContent className="p-4 text-center space-y-3">
        <CheckCircle2 className={`h-9 w-9 mx-auto ${colors.text}`} />
        <div className="space-y-1">
          <p
            className={`text-base font-semibold ${colors.text}`}
            data-testid="sop-preview-outcome-label"
          >
            Reached: {label}
          </p>
          <p className="text-xs text-muted-foreground italic">
            Test Mode — no changes are saved.
          </p>
        </div>
        <div className="flex items-center justify-center gap-2 pt-1">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onUndo}
            className="gap-1.5 h-7 text-xs"
            data-testid="sop-preview-undo"
          >
            <Undo2 className="h-3 w-3" />
            Undo
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onRestart}
            className="gap-1.5 h-7 text-xs"
            data-testid="sop-preview-restart"
          >
            <RotateCcw className="h-3 w-3" />
            Restart
          </Button>
        </div>
      </CardContent>
    </Card>
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
          // notes box OR the empty drop zone both work. The shared
          // primitive owns the explicit Upload + Paste buttons; this
          // wrapper owns the keyboard-paste capture only.
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
            <EvidencePasteUpload
              onFile={onUpload}
              disabled={disabled}
              hasItems={totalImages > 0}
              acceptPdf={true}
              testIdPrefix={`sop-evidence-req-${req.key}`}
            />
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
