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
  displayEvidenceTypeName,
} from "./types";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { toast, successToast } from "@/hooks/use-toast";
import { markLocalAction } from "@/hooks/use-local-action-mark";
import {
  ChevronRight,
  ChevronLeft,
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
  Layers,
  AlertTriangle,
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
  useSopBackStepLeg,
  useSopJumpLeg,
  useSopRestartLeg,
  useReclassifyLeg,
  useUnmarkLegDuplicate,
  getGetSopRewindImpactQueryKey,
} from "@workspace/api-client-react";
import { invalidateLegCache } from "@/lib/apply-mutation-result";
import { RefNumber } from "@/components/ref-number";
import { useIsQueuePreview } from "@/lib/preview-mode";
import type {
  ClaimEvidenceResponse,
  ClaimResponse,
  BulkSopAdvanceResponse,
  SopRewindAction,
  SopRewindImpactResponse,
} from "@workspace/api-client-react";
import {
  RewindConfirmDialog,
} from "./rewind-confirm-dialog";
import { ReclassifyConfirmDialog } from "./reclassify-confirm-dialog";
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
  /** Optional ref label for rewind dialog headers (e.g. "CLM-12" or
   *  the leg's confirmation number). */
  confNumber?: string | null;
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
  /** Task #526 R2 — when provided, the player's demoted "Reclassify"
   *  CTAs (action strip + closed-terminal footnote) delegate to the
   *  parent's existing reclassify flow (e.g. claim-detail-v2's
   *  ReclassifyDialog). The player will NOT mount its own confirm
   *  dialog or fire the reclassify mutation in that case — keeping
   *  the existing route-driven wiring unchanged so only placement /
   *  visual demotion changes. When omitted (e.g. inline group
   *  workspace mounts the player without a parent dialog), the
   *  player falls back to its built-in inline confirm. */
  onRequestReclassify?: () => void;
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
  const { tree, disabledReason, onAdvanced, errorType, siblingPrompt, bulkSiblingCount = 0, onRequestReclassify } = props;
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
          // Diagnostic capture for 403/4xx/5xx that bypass Express
          // (HTML error pages with `<title>403</title>` come from the
          // edge proxy, not our handler — Express always returns JSON).
          // Pull the edge identifiers so we can pinpoint which layer
          // is rejecting on the next failure.
          const rawText = await res.text().catch(() => "");
          const isJson = (res.headers.get("content-type") || "").includes("application/json");
          let parsedError: string | undefined;
          if (isJson) {
            try { parsedError = JSON.parse(rawText)?.error; } catch { /* noop */ }
          }
          const diag = {
            status: res.status,
            cfRay: res.headers.get("cf-ray"),
            server: res.headers.get("server"),
            via: res.headers.get("via"),
            xAmznErr: res.headers.get("x-amzn-errortype"),
            xReplit: res.headers.get("x-replit-request-id"),
            ctype: res.headers.get("content-type"),
            clen: res.headers.get("content-length"),
            bodySnippet: rawText.slice(0, 240),
            file: { name: file.name, type: file.type, size: file.size },
          };
          // eslint-disable-next-line no-console
          console.error("[upload-diag]", diag);
          const diagLine =
            `${res.status}` +
            (diag.cfRay ? ` · cf-ray:${diag.cfRay}` : "") +
            (diag.server ? ` · server:${diag.server}` : "") +
            (diag.xReplit ? ` · rid:${diag.xReplit}` : "") +
            ` · ${file.type || "?"} ${(file.size / 1024).toFixed(0)}KB`;
          toast({
            title: "Upload failed",
            description: `${parsedError || `HTTP ${res.status}`} — diag: ${diagLine}`,
            variant: "destructive",
          });
          updatePending(nodeId, key, (cur) => ({
            ...cur,
            items: cur.items.filter((it) => it.id !== tempId),
          }));
          return;
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
      // Task #706 — persisted rows are keyed by `evidence_type_name`,
      // which is now `req.label` for new rows but legacy rows still
      // carry the opaque `req.key`. Try the human label first, fall
      // back to the key so legacy rows continue to dedupe correctly.
      const persistedMap = persistedForNode(node.id);
      const persistedKey = req.label?.trim() || req.key;
      const persisted = persistedMap[persistedKey] ?? persistedMap[req.key] ?? [];
      const lastPersistedNotes = persisted.find((p) => p.notes && p.notes.trim().length > 0)?.notes?.trim() ?? "";

      // Notes-only row written iff (a) there ARE notes, AND (b) they
      // differ from anything already on file. Avoids duplicate
      // notes-only rows when an operator pages back to a node and
      // re-advances without changing anything.
      const shouldPostNotes = notes.length > 0 && notes !== lastPersistedNotes;

      // Image rows: every pending item with an objectPath becomes its
      // own evidence row. We don't bind notes to the image rows — the
      // notes get their own row so the audit trail keeps them legible.
      // Task #706 — persist the human label as the row's semantic
      // `evidence_type_name`. Falls back to `req.key` (the opaque
      // synthetic id) only when a legacy node somehow lacks a label;
      // the editor now blocks saving a tree in that state, so this
      // fallback is purely defensive for in-flight legacy trees.
      const persistedName = req.label?.trim() || req.key;
      for (const it of itemsToPost) {
        const res = await fetch(`${apiBase()}/api/claims/${leg.id}/evidence`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            evidenceTypeName: persistedName,
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
            evidenceTypeName: persistedName,
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
      invalidateLegCache(qc, leg.id, leg.invoiceGroupId);
      qc.invalidateQueries({ queryKey: getListClaimEvidenceQueryKey(leg.id) });
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
        invalidateLegCache(qc, leg.id, leg.invoiceGroupId);
        qc.invalidateQueries({ queryKey: getListClaimEvidenceQueryKey(leg.id) });
        const succeeded = result.succeeded ?? [];
        // Invalidate every affected sibling leg's detail+evidence keys so
        // open detail views in other tabs/panels reflect the new state
        // without a manual refresh.
        for (const c of succeeded as ClaimResponse[]) {
          if (c.id === leg.id) continue;
          invalidateLegCache(qc, c.id, leg.invoiceGroupId);
          qc.invalidateQueries({ queryKey: getListClaimEvidenceQueryKey(c.id) });
        }
        const skipped = result.skipped ?? [];
        const truncatedRefs = skipped.slice(0, 5).map((s) => s.ref);
        const skippedDescription = skipped.length === 0
          ? undefined
          : skipped.length <= 5
            ? `Skipped: ${truncatedRefs.join(", ")}`
            : `Skipped: ${truncatedRefs.join(", ")} +${skipped.length - 5} more`;
        successToast({
          title: "__VERB__",
          description:
            `Applied to ${succeeded.length} leg${succeeded.length === 1 ? "" : "s"}` +
            (skipped.length > 0 ? ` (skipped ${skipped.length})` : "") +
            (skippedDescription ? ` — ${skippedDescription}` : ""),
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

  // ─────────────────────────────────────────────────────────────────
  // Task #526 — Player rewind UI (R1 + R2 + R5).
  // ─────────────────────────────────────────────────────────────────

  const legRefLabel = !isPreview
    ? leg.confNumber || `CLM-${leg.id}`
    : null;

  type PendingRewind =
    | { action: SopRewindAction; nodeId?: string | null }
    | null;
  const [rewindPending, setRewindPending] = useState<PendingRewind>(null);
  const [reclassifyOpen, setReclassifyOpen] = useState(false);

  const invalidateAfterRewind = useCallback(() => {
    if (isPreview) return;
    invalidateLegCache(qc, leg.id, leg.invoiceGroupId);
    qc.invalidateQueries({
      queryKey: getListClaimEvidenceQueryKey(leg.id),
    });
    qc.invalidateQueries({
      queryKey: getGetSopRewindImpactQueryKey(leg.id),
    });
  }, [isPreview, leg.id, leg.invoiceGroupId, qc]);

  function handleRewindError(err: unknown) {
    const e = err as { status?: number; message?: string };
    toast({
      title: "Could not rewind the SOP walk",
      description: e?.message || "Please try again.",
      variant: "destructive",
    });
  }

  function handleRewindSuccess(verb: string) {
    // Drop ALL local pending evidence — once the server has popped /
    // restarted the walk, anything captured below the new current node
    // belongs to a node we no longer occupy. Clearing the entire map
    // keeps the next walk starting clean (matches Task #526 R1/R2
    // expectation: "fresh walk starts clean").
    setPendingByReq({});
    markLocalAction(`claim:${leg.id}`);
    invalidateAfterRewind();
    successToast({ title: "__VERB__", description: verb });
    setRewindPending(null);
    onAdvanced?.({ isTerminal: false, sopOutcome: null });
  }

  // Rewind mutations declared without global onSuccess/onError so each
  // call site (handleRewindConfirm, handleQuickBack) is the SOLE owner
  // of its callbacks. TanStack Query runs both global and per-call
  // callbacks, so global handlers here would double-fire toasts /
  // invalidations and — critically — would run the destructive error
  // toast on the 409-then-confirm flow before the heavy dialog opens.
  const backStepMutation = useSopBackStepLeg<Error>();
  const jumpMutation = useSopJumpLeg<Error>();
  const restartMutation = useSopRestartLeg<Error>();
  // Task #688 — Duplicate terminals had no back-out. `useSopRestartLeg`
  // doesn't clear `duplicateOfClaimId`, so the un-mark needs its own
  // mutation. Mirrors the on-success contract of the rewind mutations
  // so the leg cache invalidates and the parent can advance.
  const unmarkDuplicateMutation = useUnmarkLegDuplicate<Error>({
    mutation: {
      onSuccess: () => {
        markLocalAction(`claim:${leg.id}`);
        invalidateAfterRewind();
        successToast({
          title: "__VERB__",
          description: "Sibling-duplicate link cleared — this leg can be walked again",
        });
        onAdvanced?.({ isTerminal: false, sopOutcome: null });
      },
      onError: handleRewindError,
    },
  });
  const reclassifyMutation = useReclassifyLeg<Error>({
    mutation: {
      onSuccess: () => {
        markLocalAction(`claim:${leg.id}`);
        invalidateAfterRewind();
        successToast({
          title: "__VERB__",
          description: "Leg reclassified — pick an error type to start over",
        });
        setReclassifyOpen(false);
        onAdvanced?.({ isTerminal: false, sopOutcome: null });
      },
      onError: handleRewindError,
    },
  });

  const anyRewindPending =
    backStepMutation.isPending ||
    jumpMutation.isPending ||
    restartMutation.isPending;

  const openRewindDialog = useCallback(
    (action: SopRewindAction, nodeId?: string | null) => {
      if (isPreview || disabled || anyRewindPending) return;
      setRewindPending({ action, nodeId: nodeId ?? null });
    },
    [isPreview, disabled, anyRewindPending],
  );

  const closeRewindDialog = useCallback(() => {
    if (anyRewindPending) return;
    setRewindPending(null);
  }, [anyRewindPending]);

  const handleRewindConfirm = useCallback(
    ({ impact }: { impact: SopRewindImpactResponse }) => {
      if (!rewindPending) return;
      const discardDraft = impact.draftWillBeDiscarded;
      const data = { discardDraft };
      switch (rewindPending.action) {
        case "back-step":
          backStepMutation.mutate(
            { id: leg.id, data },
            {
              onSuccess: () =>
                handleRewindSuccess("Walk stepped back one answer"),
              onError: handleRewindError,
            },
          );
          return;
        case "restart":
          restartMutation.mutate(
            { id: leg.id, data },
            {
              onSuccess: () =>
                handleRewindSuccess("Walk restarted from the top"),
              onError: handleRewindError,
            },
          );
          return;
        case "jump":
          if (!rewindPending.nodeId) return;
          jumpMutation.mutate(
            {
              id: leg.id,
              data: { nodeId: rewindPending.nodeId, discardDraft },
            },
            {
              onSuccess: () =>
                handleRewindSuccess("Walk rewound to selected step"),
              onError: handleRewindError,
            },
          );
          return;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      rewindPending,
      backStepMutation,
      jumpMutation,
      restartMutation,
      leg.id,
    ],
  );

  // Quick Back: when at a non-terminal step, fire the mutation directly
  // with discardDraft:false. If the server returns 409 (a draft exists
  // and would be discarded), open the heavy dialog so the operator can
  // confirm.
  const handleQuickBack = useCallback(() => {
    if (isPreview || disabled || anyRewindPending) return;
    if (answers.length === 0) return;
    backStepMutation.mutate(
      { id: leg.id, data: { discardDraft: false } },
      {
        onSuccess: () => handleRewindSuccess("Walk stepped back one answer"),
        onError: (err: unknown) => {
          const e = err as { status?: number };
          if (e?.status === 409) {
            // Surface the heavy dialog; it will refetch the impact
            // (cache is invalidated above on success, no-op here) and
            // render the discard-draft callout.
            setRewindPending({ action: "back-step", nodeId: null });
            return;
          }
          handleRewindError(err);
        },
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPreview, disabled, anyRewindPending, answers.length, backStepMutation, leg.id]);

  // Required-evidence gate for the current node. The operator cannot
  // advance until every required req has real content (image or notes).
  // Pending uploads still in flight count as "not yet satisfied" — we
  // wait for the green imageUrl before letting the gate trip.
  const evidenceReady = useMemo(() => {
    if (!currentNode?.evidenceRequirements?.length) return true;
    const persistedMap = persistedForNode(currentNode.id);
    return currentNode.evidenceRequirements.every((req) => {
      // Task #706 — same dual-key lookup as the persistence path: new
      // rows persist `req.label` as `evidence_type_name`, legacy rows
      // still carry `req.key`. Match either.
      const persistedKey = req.label?.trim() || req.key;
      return isReqSatisfied({
        req,
        pending: getPending(currentNode.id, req.key),
        persistedItems: persistedMap[persistedKey] ?? persistedMap[req.key] ?? [],
      });
    });
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
        {previewAnswers.length > 0 && (
          <SopBreadcrumb tree={tree} answers={previewAnswers} />
        )}
        <PreviewOutcomeCard
          outcomeType={previewSopOutcome as OutcomeType}
          onUndo={handlePreviewUndo}
          onRestart={handlePreviewRestart}
        />
      </div>
    );
  }

  // Terminal dispatch (live mode) — single switch on outcomeRole-derived
  // terminal kind. Closed terminals adopt the R2 verdict-card layout
  // with per-step "Rewind to here" buttons and the demoted Reclassify
  // footnote. Hold/Duplicate keep their dedicated terminal screens
  // (Hold has its own Resume affordance; Duplicate is a sibling marker
  // not a walk verdict). Include renders an inline "Ready" confirmation
  // alongside the same `PerLegContextEditor` that runs during the walk.
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
        {terminalKind === "closed" && (
          <ClosedTerminalRewindCard
            tree={tree}
            answers={answers}
            sopOutcome={leg.sopOutcome ?? null}
            disabled={disabled}
            onChangeAnswer={() => openRewindDialog("back-step")}
            onRestart={() => openRewindDialog("restart")}
            onJumpTo={(nodeId) => openRewindDialog("jump", nodeId)}
            onReclassify={onRequestReclassify ?? (() => setReclassifyOpen(true))}
            anyPending={anyRewindPending || reclassifyMutation.isPending}
          />
        )}
        {terminalKind === "hold" && (
          <>
            {answers.length > 0 && (
              <LiveBreadcrumb
                tree={tree}
                answers={answers}
                onChipClick={(nodeId) => openRewindDialog("jump", nodeId)}
                disabled={disabled || anyRewindPending}
                currentNodeId={null}
              />
            )}
            <HoldTerminal
              leg={terminalLeg}
              tree={tree}
              disabledReason={disabledReason}
              onAdvanced={onAdvanced}
            />
            {/* Task #688 — Hold's Resume button only continues the walk
                from where it left off; it doesn't help when the operator
                walked into the hold by mistake. The shared rewind footer
                lets them step back or restart, same as a closed terminal.
                executeRewind clears `sopOutcome`, so Restart also
                releases the hold. Gated on !isPreview so the admin
                "Test Decision Tree" dialog (which bypasses live mutations)
                doesn't surface buttons that would hit /sop-restart. */}
            {!isPreview && (
              <LegTerminalRewindFooter
                variant="rewind"
                hasAnswers={answers.length > 0}
                interactionDisabled={!!disabled || anyRewindPending}
                onChangeAnswer={() => openRewindDialog("back-step")}
                onRestart={() => openRewindDialog("restart")}
                onReclassify={
                  onRequestReclassify ?? (() => setReclassifyOpen(true))
                }
                reclassifyDisabled={
                  !!disabled || anyRewindPending || reclassifyMutation.isPending
                }
                testIdPrefix="sop-hold"
              />
            )}
          </>
        )}
        {terminalKind === "duplicate" && (
          <>
            <DuplicateTerminal
              leg={terminalLeg}
              tree={tree}
              disabledReason={disabledReason}
              onAdvanced={onAdvanced}
            />
            {/* Task #688 — Sibling-duplicate is a dead-end if the
                operator linked the wrong primary or shouldn't have
                marked this leg at all. Unmark clears `duplicateOfClaimId`
                via /claims/:id/duplicate-of (DELETE) and the leg
                returns to the walk queue. Gated on !isPreview so the
                admin "Test Decision Tree" dialog doesn't fire real
                un-mark mutations. */}
            {!isPreview && (
              <LegTerminalRewindFooter
                variant="duplicate"
                hasAnswers={false}
                interactionDisabled={!!disabled || unmarkDuplicateMutation.isPending}
                onUnmarkDuplicate={() =>
                  unmarkDuplicateMutation.mutate({ id: leg.id })
                }
                unmarkPending={unmarkDuplicateMutation.isPending}
                onReclassify={
                  onRequestReclassify ?? (() => setReclassifyOpen(true))
                }
                reclassifyDisabled={
                  !!disabled ||
                  unmarkDuplicateMutation.isPending ||
                  reclassifyMutation.isPending
                }
                testIdPrefix="sop-duplicate"
              />
            )}
          </>
        )}
        {!isPreview && rewindPending && (
          <RewindConfirmDialog
            open={!!rewindPending}
            onOpenChange={(next) => !next && closeRewindDialog()}
            legId={leg.id}
            legRef={legRefLabel}
            action={rewindPending.action}
            nodeId={rewindPending.nodeId ?? undefined}
            currentVerdictLabel={leg.sopOutcome ?? null}
            onConfirm={handleRewindConfirm}
            isPending={anyRewindPending}
          />
        )}
        {!isPreview && !onRequestReclassify && reclassifyOpen && (
          <ReclassifyConfirmDialog
            open={reclassifyOpen}
            onOpenChange={(next) =>
              !reclassifyMutation.isPending && setReclassifyOpen(next)
            }
            legRef={legRefLabel}
            isPending={reclassifyMutation.isPending}
            onConfirm={() => reclassifyMutation.mutate({ id: leg.id })}
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
        {/* Task #688 — Include/Ready is the green "this leg is
            disputable" terminal. If the operator walked here by
            mistake, they need the same back-step / restart pair as
            closed terminals. */}
        {!isPreview && (
          <LegTerminalRewindFooter
            variant="rewind"
            hasAnswers={answers.length > 0}
            interactionDisabled={!!disabled || anyRewindPending}
            onChangeAnswer={() => openRewindDialog("back-step")}
            onRestart={() => openRewindDialog("restart")}
            onReclassify={
              onRequestReclassify ?? (() => setReclassifyOpen(true))
            }
            reclassifyDisabled={
              !!disabled || anyRewindPending || reclassifyMutation.isPending
            }
            testIdPrefix="sop-include"
          />
        )}
        {!isPreview && rewindPending && (
          <RewindConfirmDialog
            open={!!rewindPending}
            onOpenChange={(next) => !next && closeRewindDialog()}
            legId={leg.id}
            legRef={legRefLabel}
            action={rewindPending.action}
            nodeId={rewindPending.nodeId ?? undefined}
            currentVerdictLabel={leg.sopOutcome ?? null}
            onConfirm={handleRewindConfirm}
            isPending={anyRewindPending}
          />
        )}
        {!isPreview && !onRequestReclassify && reclassifyOpen && (
          <ReclassifyConfirmDialog
            open={reclassifyOpen}
            onOpenChange={(next) =>
              !reclassifyMutation.isPending && setReclassifyOpen(next)
            }
            legRef={legRefLabel}
            isPending={reclassifyMutation.isPending}
            onConfirm={() => reclassifyMutation.mutate({ id: leg.id })}
          />
        )}
      </div>
    );
  }

  if (!currentNode) {
    // Task #688 — The tree-config-error fallback used to be plain
    // muted text telling the operator to reclassify. The actual recovery
    // path is now a real button. Restart-walk is intentionally omitted
    // because /sop-restart 400s when the tree can't be loaded.
    return (
      <div className="space-y-3 min-w-0" data-testid="sop-advance-player">
        <Card
          className="border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-900"
          data-testid="sop-tree-error-card"
        >
          <CardContent className="p-4 space-y-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-5 w-5 mt-0.5 text-amber-700 dark:text-amber-300 shrink-0" />
              <div className="space-y-1">
                <p className="text-base font-semibold text-amber-800 dark:text-amber-200">
                  Tree configuration error
                </p>
                <p className="text-xs text-muted-foreground">
                  Step <code className="font-mono">{currentNodeId}</code> is no
                  longer in the active decision tree. Reclassify the leg to pick
                  a different tree and start over.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                onClick={
                  onRequestReclassify ?? (() => setReclassifyOpen(true))
                }
                disabled={!!disabled || reclassifyMutation.isPending}
                className="gap-1.5 h-8 text-xs"
                data-testid="sop-tree-error-reclassify"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Reclassify the leg
              </Button>
              <span className="text-[11px] text-muted-foreground">
                Wipes the SOP walk and returns the leg to needs-classification.
              </span>
            </div>
          </CardContent>
        </Card>
        {!isPreview && !onRequestReclassify && reclassifyOpen && (
          <ReclassifyConfirmDialog
            open={reclassifyOpen}
            onOpenChange={(next) =>
              !reclassifyMutation.isPending && setReclassifyOpen(next)
            }
            legRef={legRefLabel}
            isPending={reclassifyMutation.isPending}
            onConfirm={() => reclassifyMutation.mutate({ id: leg.id })}
          />
        )}
      </div>
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

  // Queue-preview surface only — surface the leg's confirmation
  // number inline in the player header so operators don't have to
  // detour to claim/invoice detail just to know which record they're
  // walking. Distinct from `isPreview` (the player's own sandbox
  // mode); we read the route-level context to decide whether to show.
  const queuePreview = useIsQueuePreview();
  // `leg` is `LegLite` (live → ClaimResponse, preview → synthesized).
  // Both shapes carry these as optional metadata, but the Lite type
  // narrows them away. Read once via a single typed view rather than
  // re-asserting at each call site.
  const legMeta = leg as { confNumber?: string | null; errorTypeName?: string | null };
  const headerLegConfNumber: string | null =
    !isPreview && legMeta.confNumber ? legMeta.confNumber : null;
  const headerLegErrorType: string | null = legMeta.errorTypeName ?? null;

  return (
    <div className="space-y-3 min-w-0" data-testid="sop-advance-player">
      {isPreview && <PreviewModeBadge />}
      {queuePreview && headerLegConfNumber && (
        <div
          className="flex items-center gap-2 text-[11px]"
          data-testid="sop-player-claim-id-row"
        >
          <span className="text-muted-foreground uppercase tracking-wider text-[10px] font-semibold">
            Claim
          </span>
          <RefNumber
            value={headerLegConfNumber}
            variant="inline"
            className="font-semibold"
          />
          {headerLegErrorType && (
            <>
              <span className="text-muted-foreground">·</span>
              <span className="text-muted-foreground">{headerLegErrorType}</span>
            </>
          )}
        </div>
      )}
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

      {answers.length > 0 &&
        (isPreview ? (
          <SopBreadcrumb tree={tree} answers={answers} />
        ) : (
          <LiveBreadcrumb
            tree={tree}
            answers={answers}
            onChipClick={(nodeId) => openRewindDialog("jump", nodeId)}
            disabled={disabled || anyRewindPending}
            currentNodeId={currentNode?.id ?? null}
          />
        ))}

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
                // Task #706 — dual-key lookup matches the persistence
                // path (label for new rows, opaque key for legacy).
                const persistedKey = req.label?.trim() || req.key;
                const persisted =
                  persistedHere[persistedKey] ?? persistedHere[req.key] ?? [];
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

      {!isPreview && (
        <div
          className="flex items-center justify-between gap-2 pt-1"
          data-testid="sop-action-strip"
        >
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs gap-1"
              onClick={handleQuickBack}
              disabled={
                disabled || answers.length === 0 || anyRewindPending
              }
              data-testid="sop-action-back"
            >
              {backStepMutation.isPending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <ChevronLeft className="h-3 w-3" />
              )}
              Back
            </Button>
            <span
              className="text-[11px] text-muted-foreground"
              data-testid="sop-action-back-helper"
            >
              Pops the last answer
            </span>
          </div>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs gap-1 text-muted-foreground"
            onClick={() =>
              onRequestReclassify
                ? onRequestReclassify()
                : setReclassifyOpen(true)
            }
            disabled={disabled || reclassifyMutation.isPending}
            data-testid="sop-action-reclassify"
          >
            <Layers className="h-3 w-3" />
            Reclassify
          </Button>
        </div>
      )}

      {!isPreview && rewindPending && (
        <RewindConfirmDialog
          open={!!rewindPending}
          onOpenChange={(next) => !next && closeRewindDialog()}
          legId={leg.id}
          legRef={legRefLabel}
          action={rewindPending.action}
          nodeId={rewindPending.nodeId ?? undefined}
          currentVerdictLabel={leg.sopOutcome ?? null}
          onConfirm={handleRewindConfirm}
          isPending={anyRewindPending}
        />
      )}
      {!isPreview && !onRequestReclassify && reclassifyOpen && (
        <ReclassifyConfirmDialog
          open={reclassifyOpen}
          onOpenChange={(next) =>
            !reclassifyMutation.isPending && setReclassifyOpen(next)
          }
          legRef={legRefLabel}
          isPending={reclassifyMutation.isPending}
          onConfirm={() => reclassifyMutation.mutate({ id: leg.id })}
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
      title={displayEvidenceTypeName(ev.evidenceTypeName)}
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

// ─────────────────────────────────────────────────────────────────────
// Task #526 — Live (clickable) breadcrumb. Used in live mode only;
// preview keeps the read-only `SopBreadcrumb`. Clicking a chip opens
// the shared rewind confirm dialog with action="jump" + nodeId.
// ─────────────────────────────────────────────────────────────────────

function LiveBreadcrumb({
  tree,
  answers,
  onChipClick,
  disabled,
  currentNodeId,
}: {
  tree: DecisionTree;
  answers: SopAnswerRow[];
  onChipClick: (nodeId: string) => void;
  disabled?: boolean;
  /** Active question the operator is parked on (mid-walk). Rendered as
   *  a non-clickable highlighted chip at the tail of the strip so the
   *  operator can see "you are here" relative to the answered chips.
   *  Pass null at terminals — the verdict card already owns the
   *  "current step" affordance there. */
  currentNodeId?: string | null;
}) {
  const currentNode = currentNodeId
    ? tree.nodes.find((n) => n.id === currentNodeId)
    : null;
  // The "current node" chip is suppressed if the operator is parked on
  // a node they've already answered (rewinds re-park you on the
  // answered node — duplicate display is noise, not signal).
  const showCurrent =
    !!currentNode && !answers.some((a) => a.nodeId === currentNode.id);
  return (
    <div
      className="flex flex-wrap items-center gap-1.5 text-[11px]"
      data-testid="sop-breadcrumb-live"
    >
      {answers.map((a, i) => {
        const node = tree.nodes.find((n) => n.id === a.nodeId);
        return (
          <React.Fragment key={`${a.nodeId}-${i}`}>
            <button
              type="button"
              onClick={() => onChipClick(a.nodeId)}
              disabled={!!disabled}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border bg-muted/50 hover:bg-muted hover:border-blue-400 disabled:opacity-60 disabled:cursor-not-allowed transition-colors group"
              data-testid={`sop-breadcrumb-chip-${a.nodeId}`}
              title={`Rewind to: ${node?.question ?? a.nodeId}`}
            >
              <span className="font-mono text-[10px] text-muted-foreground">
                Q{i + 1}
              </span>
              <span className="text-muted-foreground truncate max-w-[120px]">
                {node?.question ?? a.nodeId}
              </span>
              <span className="text-muted-foreground">→</span>
              <Badge
                variant="secondary"
                className="h-4 px-1 text-[10px] font-medium"
              >
                {a.answer}
              </Badge>
              <RotateCcw className="h-2.5 w-2.5 opacity-0 group-hover:opacity-60" />
            </button>
            {(i < answers.length - 1 || showCurrent) && (
              <ChevronRight className="h-3 w-3 opacity-50" />
            )}
          </React.Fragment>
        );
      })}
      {showCurrent && currentNode && (
        <span
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-blue-400 bg-blue-50 dark:bg-blue-950/30 ring-1 ring-blue-300"
          data-testid={`sop-breadcrumb-current-${currentNode.id}`}
          aria-current="step"
          title={`Current question: ${currentNode.question}`}
        >
          <span className="font-mono text-[10px] text-blue-700 dark:text-blue-300">
            Q{answers.length + 1}
          </span>
          <span className="text-blue-800 dark:text-blue-200 truncate max-w-[140px]">
            {currentNode.question}
          </span>
          <span className="text-[10px] text-blue-700 dark:text-blue-300 italic">
            you are here
          </span>
        </span>
      )}
      {answers.length > 0 && !showCurrent && (
        <CheckCircle2 className="h-3 w-3 text-green-600 ml-1" />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Task #526 R2 — Closed-terminal verdict layout with per-step
// "Rewind to here" buttons and a footer of Change-my-answer /
// Restart-walk plus a demoted Reclassify footnote.
// ─────────────────────────────────────────────────────────────────────

function ClosedTerminalRewindCard({
  tree,
  answers,
  sopOutcome,
  disabled,
  onChangeAnswer,
  onRestart,
  onJumpTo,
  onReclassify,
  anyPending,
}: {
  tree: DecisionTree;
  answers: SopAnswerRow[];
  sopOutcome: string | null;
  disabled?: boolean;
  onChangeAnswer: () => void;
  onRestart: () => void;
  onJumpTo: (nodeId: string) => void;
  onReclassify: () => void;
  anyPending: boolean;
}) {
  const outcomeType = (sopOutcome ?? "cannot_dispute") as OutcomeType;
  const colors = OUTCOME_COLORS[outcomeType] ?? OUTCOME_COLORS.cannot_dispute;
  const label = OUTCOME_LABELS[outcomeType] ?? outcomeType;
  const interactionDisabled = !!disabled || anyPending;

  return (
    <Card
      className={`${colors.bg} border ${colors.border}`}
      data-testid="sop-terminal-card"
      data-outcome={outcomeType}
    >
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start gap-2">
          <CheckCircle2
            className={`h-5 w-5 mt-0.5 ${colors.text} shrink-0`}
          />
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <p
                className={`text-base font-semibold ${colors.text}`}
                data-testid="sop-terminal-verdict-label"
              >
                {label}
              </p>
              <Badge
                variant="secondary"
                className="h-5 px-1.5 text-[10px] font-medium"
                data-testid="sop-terminal-answer-count"
              >
                {answers.length} answer{answers.length === 1 ? "" : "s"}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              The walk reached a terminal verdict based on your answers
              below. You can rewind to any step or change your last
              answer.
            </p>
          </div>
        </div>

        {answers.length > 0 && (
          <div
            className="rounded-md border bg-background/60"
            data-testid="sop-terminal-answers"
          >
            <div className="px-3 py-1.5 border-b text-[11px] uppercase tracking-wider text-muted-foreground">
              Your answers
            </div>
            <ol className="divide-y">
              {answers.map((a, i) => {
                const node = tree.nodes.find((n) => n.id === a.nodeId);
                const isTriggering = i === answers.length - 1;
                return (
                  <li
                    key={`${a.nodeId}-${i}`}
                    className={`flex items-center gap-2 px-3 py-1.5 text-xs ${
                      isTriggering ? "bg-amber-50/60 dark:bg-amber-950/20" : ""
                    }`}
                    data-testid={`sop-terminal-answer-${i}`}
                    data-triggering={isTriggering ? "true" : undefined}
                  >
                    <span className="text-muted-foreground tabular-nums w-5 shrink-0">
                      {i + 1}.
                    </span>
                    <span className="flex-1 min-w-0 truncate">
                      {node?.question ?? a.nodeId}
                    </span>
                    {isTriggering && (
                      <Badge
                        variant="outline"
                        className="h-4 px-1 text-[9px] font-medium shrink-0 border-amber-400 text-amber-800 dark:text-amber-200"
                        data-testid="sop-terminal-triggering-pill"
                      >
                        Triggered verdict
                      </Badge>
                    )}
                    <Badge
                      variant="secondary"
                      className="h-4 px-1 text-[10px] font-medium shrink-0"
                    >
                      {a.answer}
                    </Badge>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-6 px-1.5 text-[10px] gap-1"
                      onClick={() => onJumpTo(a.nodeId)}
                      disabled={interactionDisabled}
                      data-testid={`sop-terminal-rewind-to-${a.nodeId}`}
                    >
                      <RotateCcw className="h-3 w-3" />
                      Rewind to here
                    </Button>
                  </li>
                );
              })}
            </ol>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button
            type="button"
            size="sm"
            onClick={onChangeAnswer}
            disabled={interactionDisabled || answers.length === 0}
            className="gap-1.5 h-8 text-xs"
            data-testid="sop-terminal-change-answer"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            Change my answer
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onRestart}
            disabled={interactionDisabled}
            className="gap-1.5 h-8 text-xs"
            data-testid="sop-terminal-restart"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Restart walk
          </Button>
          {/* R2 mockup helper — both verbs keep the classification, so
              the operator knows neither path forces a reclassify. */}
          <span
            className="text-[11px] text-muted-foreground ml-auto"
            data-testid="sop-terminal-verb-helper"
          >
            In case you mis-clicked · both keep the classification
          </span>
        </div>

        <p
          className="text-[11px] text-muted-foreground pt-1 border-t"
          data-testid="sop-terminal-reclassify-footnote"
        >
          Wrong error type altogether?{" "}
          <button
            type="button"
            className="underline decoration-dotted hover:text-foreground disabled:opacity-60"
            onClick={onReclassify}
            disabled={interactionDisabled}
            data-testid="sop-terminal-reclassify"
          >
            Reclassify the leg
          </button>{" "}
          to pick a different decision tree.
        </p>
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Task #688 — Shared rewind footer for non-closed terminal screens
// (Hold, Duplicate, Include/Ready). Mirrors the action row at the
// bottom of `ClosedTerminalRewindCard` so every leg terminal exposes
// a consistent way out: either rewind the SOP walk (Change/Restart)
// or, for sibling-duplicates, unmark the duplicate link. The
// Reclassify footnote stays demoted as on the closed card — same
// recovery copy, same disabled rules.
// ─────────────────────────────────────────────────────────────────────

function LegTerminalRewindFooter({
  variant,
  hasAnswers,
  interactionDisabled,
  onChangeAnswer,
  onRestart,
  onUnmarkDuplicate,
  unmarkPending,
  onReclassify,
  reclassifyDisabled,
  testIdPrefix,
}: {
  variant: "rewind" | "duplicate";
  hasAnswers: boolean;
  interactionDisabled: boolean;
  onChangeAnswer?: () => void;
  onRestart?: () => void;
  onUnmarkDuplicate?: () => void;
  unmarkPending?: boolean;
  onReclassify: () => void;
  reclassifyDisabled: boolean;
  testIdPrefix: string;
}) {
  return (
    <Card
      className="bg-muted/20 border-muted-foreground/20"
      data-testid={`${testIdPrefix}-rewind-footer`}
    >
      <CardContent className="p-3 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          {variant === "rewind" && (
            <>
              <Button
                type="button"
                size="sm"
                onClick={onChangeAnswer}
                disabled={interactionDisabled || !hasAnswers}
                className="gap-1.5 h-8 text-xs"
                data-testid={`${testIdPrefix}-change-answer`}
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                Change my answer
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={onRestart}
                disabled={interactionDisabled}
                className="gap-1.5 h-8 text-xs"
                data-testid={`${testIdPrefix}-restart`}
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Restart walk
              </Button>
              <span
                className="text-[11px] text-muted-foreground ml-auto"
                data-testid={`${testIdPrefix}-verb-helper`}
              >
                In case you mis-clicked · both keep the classification
              </span>
            </>
          )}
          {variant === "duplicate" && (
            <>
              <Button
                type="button"
                size="sm"
                onClick={onUnmarkDuplicate}
                disabled={interactionDisabled}
                className="gap-1.5 h-8 text-xs"
                data-testid={`${testIdPrefix}-unmark`}
              >
                {unmarkPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Undo2 className="h-3.5 w-3.5" />
                )}
                Unmark sibling duplicate
              </Button>
              <span
                className="text-[11px] text-muted-foreground ml-auto"
                data-testid={`${testIdPrefix}-verb-helper`}
              >
                In case this isn't actually a duplicate · the leg returns to the walk queue
              </span>
            </>
          )}
        </div>
        <p
          className="text-[11px] text-muted-foreground pt-1 border-t"
          data-testid={`${testIdPrefix}-reclassify-footnote`}
        >
          Wrong error type altogether?{" "}
          <button
            type="button"
            className="underline decoration-dotted hover:text-foreground disabled:opacity-60"
            onClick={onReclassify}
            disabled={reclassifyDisabled}
            data-testid={`${testIdPrefix}-reclassify`}
          >
            Reclassify the leg
          </button>{" "}
          to pick a different decision tree.
        </p>
      </CardContent>
    </Card>
  );
}

