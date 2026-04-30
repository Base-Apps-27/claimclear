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

export interface WorkflowStep {
  nodeId: string;
  question: string;
  answer: string;
  timestamp: string;
}

export interface WorkflowProgress {
  currentNodeId: string;
  history: WorkflowStep[];
  completed: boolean;
  resolutionType?: OutcomeType;
}

export const OUTCOME_LABELS: Record<OutcomeType, string> = {
  portal_dispute: "Submit Portal Dispute",
  dispute: "Send Dispute Email",
  internal: "Resolve Internally",
  hold: "Place on Hold",
  cannot_dispute: "Cannot Dispute (Withdraw)",
  non_issue: "Non-Issue",
};

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
