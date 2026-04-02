export type OutcomeType = "portal_dispute" | "internal" | "hold" | "dispute";

export interface EvidenceReq {
  key: string;
  label: string;
  required: boolean;
}

export interface TreeNode {
  id: string;
  question: string;
  helpText?: string;
  options: TreeOption[];
  evidenceRequirements?: EvidenceReq[];
}

export interface TreeOption {
  label: string;
  childId?: string;
  outcomeType?: OutcomeType;
  outcomeLabel?: string;
}

export interface DecisionTree {
  nodes: TreeNode[];
  rootId: string;
}

export interface LegacyTreeNode {
  question: string;
  yesLabel?: string;
  noLabel?: string;
  yesAction?: string;
  noAction?: string;
  yesChild?: LegacyTreeNode;
  noChild?: LegacyTreeNode;
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
};

export const OUTCOME_COLORS: Record<OutcomeType, { bg: string; text: string; border: string }> = {
  portal_dispute: { bg: "bg-green-50", text: "text-green-700", border: "border-green-300" },
  dispute: { bg: "bg-blue-50", text: "text-blue-700", border: "border-blue-300" },
  internal: { bg: "bg-red-50", text: "text-red-700", border: "border-red-300" },
  hold: { bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-300" },
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

    nodes.push({ id, question: leg.question, options });
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
    name: "Invoice Number Not in System",
    tree: legacyToTree({
      question: "Does the invoice number match the trip confirmation number?",
      yesLabel: "Yes, numbers match",
      noLabel: "No, mismatch found",
      yesChild: {
        question: "Was the invoice submitted to the correct payor/plan?",
        yesLabel: "Yes, correct payor",
        noLabel: "Wrong payor",
        yesAction: "Submit Portal Dispute",
        noAction: "Resolve Internally - Resubmit to correct payor",
      },
      noChild: {
        question: "Can the correct invoice number be located in the billing system?",
        yesLabel: "Yes, found correct number",
        noLabel: "Cannot locate",
        yesAction: "Submit Portal Dispute",
        noAction: "Place on Hold - Contact billing team",
      },
    }),
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
