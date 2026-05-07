import { db, invoiceGroupsTable, claimsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { InvoicePhase, ClaimDisposition } from "@workspace/vocab";

export const DEFAULT_DISPOSITION_BY_PHASE: Record<InvoicePhase, ClaimDisposition> = {
  triage: "unclassified",
  ready_to_submit: "disposed_portal",
  submitted: "disposed_portal",
  response_received: "awaiting_review",
  reviewed: "verdict_denied",
  awaiting_reattestation: "attest_pending",
  closed: "final_reattested",
};

export function dispositionForPhase(phase: InvoicePhase | null | undefined): ClaimDisposition {
  if (!phase) return "unclassified";
  return DEFAULT_DISPOSITION_BY_PHASE[phase] ?? "unclassified";
}

export async function dispositionForGroup(invoiceGroupId: number | null | undefined): Promise<ClaimDisposition> {
  if (invoiceGroupId == null) return "unclassified";
  const [parent] = await db
    .select({ phase: invoiceGroupsTable.phase })
    .from(invoiceGroupsTable)
    .where(eq(invoiceGroupsTable.id, invoiceGroupId));
  return dispositionForPhase(parent?.phase as InvoicePhase | undefined);
}

export const STATUS_TO_PHASE: Record<string, InvoicePhase> = {
  "New": "triage",
  "Needs Evidence": "triage",
  "On Hold": "triage",
  "Portal Queued": "submitted",
  "Generating Email": "submitted",
  "Awaiting Response": "submitted",
  "Ready to Review": "response_received",
  "Needs Review": "response_received",
  "MAS Eligible": "awaiting_reattestation",
  "Resolved": "closed",
  "Denied": "closed",
};

export function phaseForStatus(status: string | null | undefined): InvoicePhase {
  if (!status) return "triage";
  return STATUS_TO_PHASE[status] ?? "triage";
}

export type MakeGroupOpts = Partial<typeof invoiceGroupsTable.$inferInsert> & {
  status?: string;
  phase?: InvoicePhase;
};

export async function makeGroup(opts: MakeGroupOpts = {}): Promise<typeof invoiceGroupsTable.$inferSelect> {
  const invoiceNumber =
    opts.invoiceNumber ?? `FX-G-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const status = opts.status ?? "Needs Evidence";
  const phase = opts.phase ?? phaseForStatus(status);
  const { status: _s, phase: _p, invoiceNumber: _in, ...rest } = opts;
  const [row] = await db
    .insert(invoiceGroupsTable)
    .values({
      invoiceNumber,
      status: status as any,
      outcome: (opts.outcome ?? "Pending") as any,
      phase,
      ...rest,
    })
    .returning();
  return row;
}

export type MakeClaimOpts = Partial<typeof claimsTable.$inferInsert> & {
  status?: string;
  disposition?: ClaimDisposition;
};

export async function makeClaim(opts: MakeClaimOpts = {}): Promise<typeof claimsTable.$inferSelect> {
  const confNumber =
    opts.confNumber ?? `FX-C-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const { status: _s, disposition: _d, confNumber: _cn, ...rest } = opts;
  const [row] = await db
    .insert(claimsTable)
    .values({
      confNumber,
      status: (opts.status ?? "Needs Evidence") as any,
      outcome: (opts.outcome ?? "Pending") as any,
      claimAmount: opts.claimAmount ?? "100.00",
      ...(opts.disposition ? { disposition: opts.disposition } : {}),
      ...rest,
    })
    .returning();
  return row;
}
