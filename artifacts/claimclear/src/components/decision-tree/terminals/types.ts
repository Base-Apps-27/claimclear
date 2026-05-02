// Shared input shape for SOP terminal renderers.

import type { DecisionTree } from "../types";

export interface TerminalLeg {
  id: number;
  sopOutcome?: string | null;
  sopNodeId?: string | null;
  dropReason?: string | null;
  duplicateOfClaimId?: number | null;
  invoiceGroupId?: number | null;
  perLegContext?: string | null;
}

export interface TerminalCommonProps {
  leg: TerminalLeg;
  /** Optional — duplicate terminal can mount tree-less. */
  tree?: DecisionTree | null;
  /** When set, interactive controls are disabled and the reason is
   *  rendered as a muted footnote. */
  disabledReason?: string | null;
  /** Fires after a successful state change. */
  onAdvanced?: (next: { isTerminal: boolean; sopOutcome: string | null }) => void;
}
