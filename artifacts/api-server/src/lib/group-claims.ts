// Helpers for resolving the "primary leg" of an invoice group.
//
// Post-cutover, portal_submissions and most workflow events are group-scoped
// rather than claim-scoped. Audit-log rows and SSE presence events still
// carry an optional `claimId` for backwards-compatible filtering, so when a
// group-scoped action fires we attribute it to the lowest-id ride on the
// group — the same "primary claim" used elsewhere as the stable
// representative.

import { db, claimsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export async function primaryClaimIdForGroup(invoiceGroupId: number): Promise<number | null> {
  const [row] = await db.select({ id: claimsTable.id }).from(claimsTable)
    .where(eq(claimsTable.invoiceGroupId, invoiceGroupId))
    .orderBy(claimsTable.id)
    .limit(1);
  return row?.id ?? null;
}
