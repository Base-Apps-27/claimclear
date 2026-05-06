export type OutcomeType =
  | "portal_dispute"
  | "internal"
  | "hold"
  | "dispute"
  | "cannot_dispute"
  | "non_issue";

export interface EvidenceReq {
  key: string;
  label: string;
  required: boolean;
  evidenceTypeId?: number;
  acceptsImage?: boolean;
  acceptsText?: boolean;
}

export interface TreeNode {
  id: string;
  question: string;
  helpText?: string;
  instructionText?: string;
  instructionImageUrl?: string;
  instructionImagePath?: string;
  instructionLinkUrl?: string;
  instructionLinkLabel?: string;
  options: TreeOption[];
  evidenceRequirements?: EvidenceReq[];
}

export interface TreeOption {
  label: string;
  childId?: string;
  outcomeType?: OutcomeType;
  outcomeLabel?: string;
  closureCategory?: string;
  closureRootCause?: string;
}

export interface DecisionTree {
  nodes: TreeNode[];
  rootId: string;
}

export interface LegacyTreeNode {
  question: string;
  helpText?: string;
  instructionText?: string;
  yesLabel?: string;
  noLabel?: string;
  yesAction?: string;
  noAction?: string;
  yesChild?: LegacyTreeNode;
  noChild?: LegacyTreeNode;
  evidenceRequirements?: EvidenceReq[];
}

// SOP author-time outcome labels — these label the *kinds of leaves a
// SOP can produce*, not the per-claim outcome chip. The vocab glossary
// owns "Non-issue" / "Non-contestable", and we route through it so the
// editor matches what the operator will see at runtime.
import { LEG_CONCLUSION } from "@workspace/vocab";

// Read-compat is forever (Task #309 / Guard #2): the keys
// `portal_dispute` and `dispute` MUST keep resolving to a string so that
// legacy trees stored with those outcome types continue to render
// without crashing anywhere downstream. The label for `portal_dispute`
// has been relabeled to "Ready" — the runtime label maps to the new
// vocabulary while preserving the key for back-compat.
export const OUTCOME_LABELS: Record<OutcomeType, string> = {
  portal_dispute: "Ready",
  dispute: "Send Dispute Email",
  internal: "Resolve Internally",
  hold: "Place on Hold",
  cannot_dispute: `${LEG_CONCLUSION.cannot_dispute.label} (Withdraw)`,
  non_issue: LEG_CONCLUSION.non_issue.label,
};

// The set of outcome types that NEW tree options are allowed to author.
// Per Task #309: channel (portal vs email) is owned by the error_type
// template, not the tree, so authors no longer pick between
// `portal_dispute` and `dispute` — they pick the role-level vocabulary.
// Keep this as the single source of truth for the editor's allowlist;
// inlining this list in JSX in two places is the kind of drift that
// silently re-introduces legacy values later (Guard #3).
export const OUTCOME_AUTHOR_OPTIONS: ReadonlyArray<OutcomeType> = [
  "portal_dispute", // labeled "Ready" — the include role
  "hold",
  "cannot_dispute",
  "non_issue",
  "internal",
];

// Legacy outcome types — values that pre-date the new vocabulary
// decision (Task #309) where channel ownership moved off the tree and
// onto the error_type template. Kept readable forever for back-compat
// (`OUTCOME_LABELS` still resolves both keys, runtime renders both
// without crashing). The editor uses this set to hide values from the
// new-author dropdown and tag any legacy value with "(legacy)" when
// editing an existing node that still stores one. Note: `portal_dispute`
// is *also* a legacy enum value, but it's been repurposed as the
// storage key for the new "Ready" (include) author option (relabeled
// in `OUTCOME_LABELS` above), so it intentionally does NOT live in
// this hidden-from-author set — flagging it as legacy would orphan the
// new "Ready" option since there's no other OutcomeType variant for
// the include role and Guard #9 forbids adding one.
export const LEGACY_OUTCOME_TYPES: ReadonlySet<OutcomeType> = new Set([
  "dispute",
]);

export const OUTCOME_COLORS: Record<OutcomeType, { bg: string; text: string; border: string }> = {
  portal_dispute: { bg: "bg-green-50", text: "text-green-700", border: "border-green-300" },
  dispute: { bg: "bg-blue-50", text: "text-blue-700", border: "border-blue-300" },
  internal: { bg: "bg-red-50", text: "text-red-700", border: "border-red-300" },
  hold: { bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-300" },
  cannot_dispute: { bg: "bg-orange-50", text: "text-orange-700", border: "border-orange-300" },
  non_issue: { bg: "bg-slate-50", text: "text-slate-700", border: "border-slate-300" },
};

let _counter = 0;
export function generateNodeId(): string {
  return `node_${Date.now()}_${++_counter}`;
}

export function legacyToTree(legacy: LegacyTreeNode): DecisionTree {
  const nodes: TreeNode[] = [];

  function convert(leg: LegacyTreeNode): string {
    const id = generateNodeId();
    const options: TreeOption[] = [];

    const yesLabel = leg.yesLabel || "Yes";
    const noLabel = leg.noLabel || "No";

    if (leg.yesChild) {
      options.push({ label: yesLabel, childId: convert(leg.yesChild) });
    } else if (leg.yesAction) {
      const outcomeType = parseActionOutcome(leg.yesAction);
      options.push({ label: yesLabel, outcomeType, outcomeLabel: leg.yesAction });
    } else {
      options.push({ label: yesLabel });
    }

    if (leg.noChild) {
      options.push({ label: noLabel, childId: convert(leg.noChild) });
    } else if (leg.noAction) {
      const outcomeType = parseActionOutcome(leg.noAction);
      options.push({ label: noLabel, outcomeType, outcomeLabel: leg.noAction });
    } else {
      options.push({ label: noLabel });
    }

    const node: TreeNode = { id, question: leg.question, options };
    if (leg.helpText) node.helpText = leg.helpText;
    if (leg.instructionText) node.instructionText = leg.instructionText;
    if (leg.evidenceRequirements?.length) node.evidenceRequirements = leg.evidenceRequirements;
    nodes.push(node);
    return id;
  }

  const rootId = convert(legacy);
  return { nodes, rootId };
}

export function treeToLegacy(tree: DecisionTree): LegacyTreeNode | null {
  if (!tree.nodes.length) return null;

  function convert(nodeId: string): LegacyTreeNode | null {
    const node = tree.nodes.find(n => n.id === nodeId);
    if (!node) return null;

    const yesOpt = node.options[0];
    const noOpt = node.options[1];

    const result: LegacyTreeNode = {
      question: node.question,
      yesLabel: yesOpt?.label || "Yes",
      noLabel: noOpt?.label || "No",
    };

    if (yesOpt?.childId) {
      result.yesChild = convert(yesOpt.childId) ?? undefined;
    } else if (yesOpt?.outcomeLabel) {
      result.yesAction = yesOpt.outcomeLabel;
    }

    if (noOpt?.childId) {
      result.noChild = convert(noOpt.childId) ?? undefined;
    } else if (noOpt?.outcomeLabel) {
      result.noAction = noOpt.outcomeLabel;
    }

    return result;
  }

  return convert(tree.rootId);
}

function parseActionOutcome(action: string): OutcomeType {
  const lower = action.toLowerCase();
  if (lower.includes("portal") || lower.includes("submit dispute")) return "portal_dispute";
  if (lower.includes("hold")) return "hold";
  if (lower.includes("email") || lower.includes("send dispute")) return "dispute";
  if (lower.includes("deny") || lower.includes("internal") || lower.includes("resolve")) return "internal";
  return "portal_dispute";
}

export function createEmptyTree(): DecisionTree {
  const rootId = generateNodeId();
  return {
    rootId,
    nodes: [{
      id: rootId,
      question: "",
      options: [
        { label: "Yes" },
        { label: "No" },
      ],
    }],
  };
}

export function getNodeById(tree: DecisionTree, id: string): TreeNode | undefined {
  return tree.nodes.find(n => n.id === id);
}

export function countPaths(tree: DecisionTree, nodeId?: string): number {
  const node = tree.nodes.find(n => n.id === (nodeId || tree.rootId));
  if (!node) return 0;
  let count = 0;
  for (const opt of node.options) {
    if (opt.childId) {
      count += countPaths(tree, opt.childId);
    } else {
      count += 1;
    }
  }
  return count;
}

// ---------------------------------------------------------------------------
// Tree mutation helpers (Task #459 — delete-with-re-parent + undo).
//
// These are intentionally pure: the editor lifts the snapshot and toast
// state up to the top-level component and only delegates the actual
// tree rewrite to these helpers so the same edges are unit-testable
// without mounting the editor in jsdom (the project's test pattern,
// see per-leg-context-editor.test.tsx).
// ---------------------------------------------------------------------------

export function findParent(
  tree: DecisionTree,
  nodeId: string,
): { parentNode: TreeNode; optionIndex: number } | null {
  for (const n of tree.nodes) {
    for (let i = 0; i < n.options.length; i++) {
      if (n.options[i].childId === nodeId) {
        return { parentNode: n, optionIndex: i };
      }
    }
  }
  return null;
}

export function removeSubtree(nodes: TreeNode[], rootId: string): TreeNode[] {
  const seen = new Set<string>();
  const stack: string[] = [rootId];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const node = nodes.find(n => n.id === id);
    if (!node) continue;
    for (const opt of node.options) {
      if (opt.childId && !seen.has(opt.childId)) stack.push(opt.childId);
    }
  }
  return nodes.filter(n => !seen.has(n.id));
}

// Counts the node itself + every reachable descendant. Defensive against
// cycles (visits each node at most once).
export function countDescendants(tree: DecisionTree, nodeId: string): number {
  const seen = new Set<string>();
  const stack: string[] = [nodeId];
  let count = 0;
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const node = tree.nodes.find(n => n.id === id);
    if (!node) continue;
    count += 1;
    for (const opt of node.options) {
      if (opt.childId && !seen.has(opt.childId)) stack.push(opt.childId);
    }
  }
  return count;
}

export interface OrphanedChild {
  optionIndex: number;
  optionLabel: string;
  childId: string;
  childQuestion: string;
  descendantCount: number;
}

// Children that would be orphaned if `nodeId` were deleted. Order matches
// the option order on the deleted node. Defensive: skips self-references
// (an option whose childId points back at the deleted node — that link is
// going away with the node, not orphaned) and skips any option whose
// childId no longer resolves to a real node. Also de-duplicates by
// childId so a node with two options pointing at the same child only
// surfaces that child once (we have one home for it on the new parent).
export function getOrphanedChildren(
  tree: DecisionTree,
  nodeId: string,
): OrphanedChild[] {
  const node = tree.nodes.find(n => n.id === nodeId);
  if (!node) return [];
  const out: OrphanedChild[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < node.options.length; i++) {
    const opt = node.options[i];
    if (!opt.childId) continue;
    if (opt.childId === nodeId) continue;          // self-reference
    if (seen.has(opt.childId)) continue;            // multi-reference dedupe
    const child = tree.nodes.find(n => n.id === opt.childId);
    if (!child) continue;                           // dangling reference
    seen.add(opt.childId);
    out.push({
      optionIndex: i,
      optionLabel: opt.label,
      childId: opt.childId,
      childQuestion: child.question,
      descendantCount: countDescendants(tree, opt.childId),
    });
  }
  return out;
}

// Slots on `parent` that can receive an orphaned child after the delete.
// A slot is receivable when it is currently empty (no childId, no
// outcomeType) OR it is the slot that currently points at the
// to-be-deleted node (since that link is about to be detached).
export function findReceivableSlots(
  parent: TreeNode,
  deletedNodeId: string,
): number[] {
  const out: number[] = [];
  // Place the about-to-detach slot first so the orphan that previously
  // sat there visually stays in roughly the same position after the
  // re-parent.
  for (let i = 0; i < parent.options.length; i++) {
    if (parent.options[i].childId === deletedNodeId) out.push(i);
  }
  for (let i = 0; i < parent.options.length; i++) {
    const opt = parent.options[i];
    if (opt.childId === deletedNodeId) continue;
    if (!opt.childId && !opt.outcomeType) out.push(i);
  }
  return out;
}

export type DeleteNodeResult =
  | { ok: true; tree: DecisionTree }
  | {
      ok: false;
      reason: "root" | "not_found" | "no_parent" | "no_available_slot";
    };

// Single entry point for both the leaf-delete and the
// delete-with-re-parent flows. Callers decide whether to prompt the
// user (orphan count > 0) before invoking; this function applies the
// mutation atomically and returns a NEW DecisionTree (the snapshot for
// undo is whatever the caller passed in).
export function deleteNodeWithReparent(
  tree: DecisionTree,
  nodeId: string,
): DeleteNodeResult {
  if (nodeId === tree.rootId) return { ok: false, reason: "root" };
  const node = tree.nodes.find(n => n.id === nodeId);
  if (!node) return { ok: false, reason: "not_found" };

  const parentInfo = findParent(tree, nodeId);
  if (!parentInfo) return { ok: false, reason: "no_parent" };
  const { parentNode } = parentInfo;

  const orphans = getOrphanedChildren(tree, nodeId);
  const slots = findReceivableSlots(parentNode, nodeId);
  if (orphans.length > slots.length) {
    return { ok: false, reason: "no_available_slot" };
  }

  // 1) Rewrite the parent's options: detach EVERY link to the deleted
  //    node (multi-reference defense — a malformed tree could have
  //    more than one option on the parent pointing at the deleted
  //    node), then assign each orphan to its slot. Orphans keep their
  //    existing sub-tree wiring; only the parent's option pointers
  //    change.
  const newParentOptions = parentNode.options.map(opt =>
    opt.childId === nodeId ? { ...opt, childId: undefined } : opt,
  );
  for (let k = 0; k < orphans.length; k++) {
    const slotIdx = slots[k];
    const orphan = orphans[k];
    newParentOptions[slotIdx] = {
      ...newParentOptions[slotIdx],
      childId: orphan.childId,
      outcomeType: undefined,
      outcomeLabel: undefined,
    };
  }

  // 2) Drop the deleted node from the array (do NOT cascade — the
  //    orphans are now wired to the new parent and need to survive).
  // 3) Defensive cleanup on every other surviving node: null out any
  //    option whose childId still points at the deleted node. The
  //    editor's invariants normally guarantee single-parent wiring,
  //    but a tree imported from elsewhere (or one with self-references)
  //    can carry extra refs we must not leave dangling.
  const newNodes = tree.nodes
    .filter(n => n.id !== nodeId)
    .map(n => {
      if (n.id === parentNode.id) return { ...n, options: newParentOptions };
      let changed = false;
      const opts = n.options.map(o => {
        if (o.childId === nodeId) {
          changed = true;
          return { ...o, childId: undefined };
        }
        return o;
      });
      return changed ? { ...n, options: opts } : n;
    });

  return { ok: true, tree: { ...tree, nodes: newNodes } };
}

export function getMaxDepth(tree: DecisionTree, nodeId?: string, depth = 0): number {
  const node = tree.nodes.find(n => n.id === (nodeId || tree.rootId));
  if (!node) return depth;
  let max = depth;
  for (const opt of node.options) {
    if (opt.childId) {
      max = Math.max(max, getMaxDepth(tree, opt.childId, depth + 1));
    } else {
      max = Math.max(max, depth + 1);
    }
  }
  return max;
}

export const TEMPLATES: Record<string, { name: string; tree: DecisionTree }> = {
  gps_deviation: {
    name: "GPS Control Deviation",
    tree: legacyToTree({
      question: "Is GPS breadcrumb data available for this trip?",
      yesLabel: "Yes, GPS data available",
      noLabel: "No GPS data",
      yesChild: {
        question: "Do the GPS breadcrumbs confirm the vehicle was at the pickup and dropoff locations?",
        yesLabel: "Yes, locations confirmed",
        noLabel: "No, locations don't match",
        yesAction: "Submit Portal Dispute",
        noChild: {
          question: "Is there a reasonable explanation for the GPS deviation (e.g., construction detour, GPS signal loss)?",
          yesLabel: "Yes, explainable",
          noLabel: "No explanation",
          yesAction: "Submit Portal Dispute",
          noAction: "Resolve Internally - Deny Claim",
        },
      },
      noChild: {
        question: "Can the driver provide a signed attestation confirming the trip?",
        yesLabel: "Yes, attestation available",
        noLabel: "No attestation",
        yesAction: "Submit Portal Dispute",
        noAction: "Place on Hold - Request GPS from fleet system",
      },
    }),
  },
  invoice_not_found: {
    name: "Invoice Number Not in System (MAS Cancelled Trip)",
    tree: {
      rootId: "mas_q1",
      nodes: [
        {
          id: "mas_q1",
          question: "Was the trip or affected leg actually completed before MAS cancelled it?",
          helpText: "Check dispatch history: Job Filter > All Comments > search 'CANCELLED BY MAS'. Confirm whether the driver picked up and dropped off the member before the cancellation timestamp.",
          options: [
            { label: "Yes, trip was completed", childId: "mas_q2" },
            { label: "No, trip was not completed", outcomeType: "internal" as OutcomeType, outcomeLabel: "Trip was not completed — no basis for correction" },
          ],
        },
        {
          id: "mas_q2",
          question: "Can completion be verified by GPS, member signature/receipt, and dispatch timestamps?",
          helpText: "All three pieces of evidence are required: (1) GPS route showing pickup and drop-off, (2) signed member receipt, (3) dispatch timestamps confirming completion before cancellation.",
          evidenceRequirements: [
            { key: "gps_screenshot", label: "GPS Screenshot", required: true, acceptsImage: true },
            { key: "receipt_signed", label: "Signed Member Receipt", required: true, acceptsImage: true },
            { key: "mas_portal_screenshot", label: "MAS Portal Invoice/Trip Screenshot", required: true, acceptsImage: true },
          ],
          options: [
            { label: "Yes, all evidence available", childId: "mas_q3" },
            { label: "No, missing documentation", outcomeType: "hold" as OutcomeType, outcomeLabel: "Place on hold — request additional documentation from dispatch/driver" },
          ],
        },
        {
          id: "mas_q3",
          question: "Review dispatch history: did MAS cancel one leg or both legs, and did the cancellation happen before pickup, after pickup, or after drop-off?",
          helpText: "Search the member/trip record. Determine exactly when the cancellation occurred relative to the trip timeline. This determines whether a correction is supportable.",
          options: [
            { label: "Reviewed — continue", childId: "mas_q4" },
          ],
        },
        {
          id: "mas_q4",
          question: "Did MAS cancel the trip after drop-off or after the completed leg was finalized?",
          helpText: "If MAS cancelled after the trip was already completed, the case qualifies for correction. If MAS cancelled before service was performed, the case is not supportable.",
          options: [
            { label: "Yes, cancelled after completion", childId: "mas_q5" },
            { label: "No, cancelled before completion", outcomeType: "internal" as OutcomeType, outcomeLabel: "Cancellation occurred before completion — not correctable" },
          ],
        },
        {
          id: "mas_q5",
          question: "Is the Correction Request option available in the MAS portal for this invoice?",
          helpText: "Access the MAS portal: Manage Trips > Search Trip by Invoice. Check whether the Correction Request button is available. Ensure submission is within the 30-day deadline.",
          evidenceRequirements: [
            { key: "correction_explanation", label: "Brief written explanation of why correction is needed", required: true, acceptsText: true },
          ],
          options: [
            { label: "Yes, Correction Request available", outcomeType: "portal_dispute" as OutcomeType, outcomeLabel: "Submit correction request through MAS portal" },
            { label: "No, Correction Request not available", outcomeType: "dispute" as OutcomeType, outcomeLabel: "Email correction request to tripinvresolution@medanswering.com with all evidence attached" },
          ],
        },
      ],
    },
  },
  attestation_timing: {
    name: "Attestation Timing Issue",
    tree: legacyToTree({
      question: "Was the attestation form signed within the required timeframe?",
      yesLabel: "Yes, on time",
      noLabel: "No, late or missing",
      yesAction: "Submit Portal Dispute",
      noChild: {
        question: "Is there documentation explaining why the attestation was delayed?",
        yesLabel: "Yes, explanation available",
        noLabel: "No explanation",
        yesAction: "Submit Portal Dispute",
        noAction: "Resolve Internally - Deny Claim",
      },
    }),
  },
  ineligible_enrollee: {
    name: "Ineligible Enrollee",
    tree: legacyToTree({
      question: "Was the member eligible on the date of service according to enrollment records?",
      yesLabel: "Yes, eligible per records",
      noLabel: "No, confirmed ineligible",
      yesAction: "Submit Portal Dispute",
      noChild: {
        question: "Has the member's eligibility been retroactively updated since the trip?",
        yesLabel: "Yes, retroactive update",
        noLabel: "No updates",
        yesAction: "Submit Portal Dispute",
        noAction: "Resolve Internally - Deny Claim",
      },
    }),
  },
};
