import { eq } from "drizzle-orm";
import { db, invoiceGroupsTable, claimsTable } from "@workspace/db";
import type { Response } from "express";

// Helpers backing the global "tour sample" invoice group + claim that
// the in-app guided tour navigates to (steps 18 & 20). The pair is
// hidden from every normal list/aggregate query and treated as
// read-only at the API layer — these helpers are how every mutation
// handler enforces that contract. See migration 0029_tour_sample.sql
// for the singleton seed.

const TOUR_SAMPLE_FORBIDDEN = "This row is the in-app tour sample and is read-only.";

export async function isTourSampleGroup(groupId: number): Promise<boolean> {
  const [row] = await db
    .select({ flag: invoiceGroupsTable.isTourSample })
    .from(invoiceGroupsTable)
    .where(eq(invoiceGroupsTable.id, groupId))
    .limit(1);
  return !!row?.flag;
}

export async function isTourSampleClaim(claimId: number): Promise<boolean> {
  const [row] = await db
    .select({ flag: claimsTable.isTourSample })
    .from(claimsTable)
    .where(eq(claimsTable.id, claimId))
    .limit(1);
  return !!row?.flag;
}

// Convenience guards for mutation handlers. Return `true` when the
// caller should bail (the response has already been sent), `false`
// when the row is mutable and the caller may proceed.
export async function blockMutationOnTourSampleGroup(groupId: number, res: Response): Promise<boolean> {
  if (await isTourSampleGroup(groupId)) {
    res.status(403).json({ error: TOUR_SAMPLE_FORBIDDEN, code: "tour_sample_readonly" });
    return true;
  }
  return false;
}

export async function blockMutationOnTourSampleClaim(claimId: number, res: Response): Promise<boolean> {
  if (await isTourSampleClaim(claimId)) {
    res.status(403).json({ error: TOUR_SAMPLE_FORBIDDEN, code: "tour_sample_readonly" });
    return true;
  }
  return false;
}

// Fetch the {groupId, claimId} pair for the tour controller. Returns
// `null` ids if the seed has not run yet (development DB without
// migration 0029 applied).
export async function getTourSampleIds(): Promise<{ groupId: number | null; claimId: number | null }> {
  const [groupRow] = await db
    .select({ id: invoiceGroupsTable.id })
    .from(invoiceGroupsTable)
    .where(eq(invoiceGroupsTable.isTourSample, true))
    .limit(1);
  const [claimRow] = await db
    .select({ id: claimsTable.id })
    .from(claimsTable)
    .where(eq(claimsTable.isTourSample, true))
    .limit(1);
  return {
    groupId: groupRow?.id ?? null,
    claimId: claimRow?.id ?? null,
  };
}
