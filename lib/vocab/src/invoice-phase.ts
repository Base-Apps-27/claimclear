import type { GlossaryEntry } from "./domains";

export const INVOICE_PHASES = [
  "triage",
  "ready_to_submit",
  "submitted",
  "response_received",
  "reviewed",
  "awaiting_reattestation",
  "closed",
] as const;

export type InvoicePhase = typeof INVOICE_PHASES[number];

export const INVOICE_PHASE: Record<InvoicePhase, GlossaryEntry> = {
  triage: {
    enumValue: "triage",
    label: "Triage",
    description: "Just imported. Operator is deciding what to do with each leg before anything is filed.",
    domain: "invoice_phase",
  },
  ready_to_submit: {
    enumValue: "ready_to_submit",
    label: "Ready to submit",
    description: "Every leg has a committed disposition. Nothing has been filed at the payor yet.",
    domain: "invoice_phase",
  },
  submitted: {
    enumValue: "submitted",
    label: "Submitted",
    description: "Filed at the payor. Awaiting the payor's response.",
    domain: "invoice_phase",
  },
  response_received: {
    enumValue: "response_received",
    label: "Response received",
    description: "The payor's reply was parsed and linked. At least one verdict still needs to be confirmed.",
    domain: "invoice_phase",
  },
  reviewed: {
    enumValue: "reviewed",
    label: "Reviewed",
    description: "Operator has confirmed a verdict for every leg.",
    domain: "invoice_phase",
  },
  awaiting_reattestation: {
    enumValue: "awaiting_reattestation",
    label: "Awaiting re-attestation",
    description: "At least one Approved or Partial verdict still needs MAS re-attestation before the funds release.",
    domain: "invoice_phase",
  },
  closed: {
    enumValue: "closed",
    label: "Closed",
    description: "Terminal. The closure_reason explains why (re-attested, denied, withdrawn, expired, or non-issue).",
    domain: "invoice_phase",
  },
};

const PHASE_ORDER: Record<InvoicePhase, number> = {
  triage: 0,
  ready_to_submit: 1,
  submitted: 2,
  response_received: 3,
  reviewed: 4,
  awaiting_reattestation: 5,
  closed: 6,
};

export function invoicePhaseLabel(phase: string): string {
  return INVOICE_PHASE[phase as InvoicePhase]?.label ?? phase;
}

export function invoicePhaseDescription(phase: string): string | undefined {
  return INVOICE_PHASE[phase as InvoicePhase]?.description;
}

export function isInvoicePhase(value: string): value is InvoicePhase {
  return value in INVOICE_PHASE;
}

export function comparePhase(a: InvoicePhase, b: InvoicePhase): number {
  return PHASE_ORDER[a] - PHASE_ORDER[b];
}

export function isPhaseAtLeast(actual: InvoicePhase, threshold: InvoicePhase): boolean {
  return PHASE_ORDER[actual] >= PHASE_ORDER[threshold];
}
