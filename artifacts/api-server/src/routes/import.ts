import { Router, type IRouter } from "express";
import { eq, inArray } from "drizzle-orm";
import { db } from "@workspace/db";
import { claimsTable, invoiceGroupsTable, auditLogsTable } from "@workspace/db";
import { deriveDispositionFromLegacy, type LegacyClaimShape } from "@workspace/invoice-state";
import { asyncHandler } from "../lib/asyncHandler";
import { parseInvoiceNumber } from "../lib/parseInvoiceNumber";
import { normalizeServiceDate } from "../lib/dates";
import { recomputeGroupServiceDate } from "../lib/group-service-date";
import { denyClerk } from "../middlewares/denyClerk";

// Importer disposition stamp. Newly-imported claims always land in a
// just-created group at phase='triage'. The deriver's triage branch
// reads (includedInDispute, errorTypeId, sopOutcome, dropReason,
// duplicateOfClaimId) — the importer sets the first two and leaves
// the rest at their defaults (null). Stamping `disposition` here keeps
// the new canonical column in lockstep with the legacy mirrors the
// importer already writes (status, outcome, includedInDispute), so
// the conformance audit returns 0 for fresh imports. Without this,
// every import wrote `disposition='unclassified'` (the DB default),
// which the deriver wants as `classifying` (hasErrorType) or
// `disposed_nonissue` (excluded). 2026-05-08 prod incident.
function importedClaimDisposition(opts: {
  errorTypeId: number | null;
  includedInDispute: boolean;
  status: "New" | "Needs Review";
}) {
  const legacy: LegacyClaimShape = {
    status: opts.status,
    outcome: "Pending",
    sopOutcome: null,
    attestationState: "not_required",
    includedInDispute: opts.includedInDispute,
    duplicateOfClaimId: null,
    dropReason: null,
    // LegacyClaimShape.errorTypeId is `string | null` (mirrors the
    // legacy text column shape used by the deriver) — only its
    // presence matters here, so coerce.
    errorTypeId: opts.errorTypeId != null ? String(opts.errorTypeId) : null,
    closureReason: null,
  };
  return deriveDispositionFromLegacy(legacy, "triage");
}

const router: IRouter = Router();

// Bulk CSV import is a many-record operation — clerks are denied.
router.use(denyClerk);

// Per-row reason for an import rejection. Surfaced verbatim in the
// import response so the operator can fix the source CSV without
// guessing which row went wrong. Task #351 added the
// `invalid_service_date` reason — the typed `claims.date` column would
// reject the row at INSERT time anyway, so we filter it out up front
// and report it explicitly instead of letting a 500 abort the whole
// batch.
type RejectedRow = {
  confNumber: string | null;
  reason: "invalid_service_date";
  rawDate: string;
};

router.post("/import", asyncHandler(async (req, res): Promise<void> => {
  const { rows, duplicateAction } = req.body;
  const dupAction = duplicateAction || "skip";

  if (!Array.isArray(rows) || rows.length === 0) {
    res.status(400).json({ error: "rows array is required" });
    return;
  }

  const batchId = `import_${Date.now()}`;
  let created = 0;
  let skipped = 0;
  let updated = 0;
  let groupsCreated = 0;
  let excludedCount = 0;
  const duplicates: string[] = [];
  const rejected: RejectedRow[] = [];

  const seenConfNumbers = new Set<string>();
  const validRows = rows
    .filter(row => {
      if (!row.confNumber) return false;
      const confStr = String(row.confNumber).trim();
      if (confStr.length === 0 || isNaN(Number(confStr))) return false;
      if (seenConfNumbers.has(confStr)) return false;
      seenConfNumbers.add(confStr);
      return true;
    })
    .map(row => ({ ...row, confNumber: String(row.confNumber).trim() }));

  // Second-pass row filter: any row whose `date` is non-empty but
  // doesn't normalize to ISO is rejected with a structured reason.
  // Empty / missing dates remain allowed (they land as NULL — the
  // dashboard renders "—" for those rows). Doing this BEFORE we hit
  // any insert/update path means a single bad row can no longer 500
  // the entire batch on the typed `claims.date` column.
  const acceptedRows: typeof validRows = [];
  for (const row of validRows) {
    const rawDate = typeof row.date === "string" ? row.date : (row.date == null ? "" : String(row.date));
    const trimmed = rawDate.trim();
    if (trimmed.length === 0) {
      acceptedRows.push({ ...row, date: null });
      continue;
    }
    const normalized = normalizeServiceDate(trimmed);
    if (!normalized) {
      rejected.push({
        confNumber: row.confNumber,
        reason: "invalid_service_date",
        rawDate: trimmed,
      });
      continue;
    }
    acceptedRows.push({ ...row, date: normalized });
  }

  const skippedCount = rows.length - validRows.length;
  skipped += skippedCount + rejected.length;

  if (acceptedRows.length === 0) {
    res.json({
      success: true,
      created: 0,
      skipped,
      updated: 0,
      excludedCount: 0,
      duplicates: [],
      total: rows.length,
      batchId,
      groupsCreated: 0,
      rejected,
    });
    return;
  }

  const confNumbers = acceptedRows.map(r => r.confNumber);
  const existingClaims = await db.select({ id: claimsTable.id, confNumber: claimsTable.confNumber })
    .from(claimsTable)
    .where(inArray(claimsTable.confNumber, confNumbers));

  const existingMap = new Map(existingClaims.map(c => [c.confNumber, c.id]));

  const invoiceMap = new Map<string, typeof acceptedRows>();
  const noInvoiceRows: typeof acceptedRows = [];

  for (const row of acceptedRows) {
    const invoiceNum = parseInvoiceNumber(row.refNumber);
    if (invoiceNum) {
      if (!invoiceMap.has(invoiceNum)) {
        invoiceMap.set(invoiceNum, []);
      }
      invoiceMap.get(invoiceNum)!.push(row);
    } else {
      noInvoiceRows.push(row);
    }
  }

  const existingInvoiceNumbers = Array.from(invoiceMap.keys());
  let existingGroupMap = new Map<string, number>();
  if (existingInvoiceNumbers.length > 0) {
    const existingGroups = await db.select({ id: invoiceGroupsTable.id, invoiceNumber: invoiceGroupsTable.invoiceNumber })
      .from(invoiceGroupsTable)
      .where(inArray(invoiceGroupsTable.invoiceNumber, existingInvoiceNumbers));
    existingGroupMap = new Map(existingGroups.map(g => [g.invoiceNumber, g.id]));
  }

  for (const [invoiceNumber, groupRows] of invoiceMap.entries()) {
    let groupId = existingGroupMap.get(invoiceNumber);

    const errorDetailsSet = new Set<string>();
    let groupClientNumber: string | null = null;
    let totalAmount = 0;
    let groupErrorTypeId: string | null = null;
    let groupErrorTypeName: string | null = null;

    for (const row of groupRows) {
      if (row.errorDetails && row.errorDetails.trim()) {
        errorDetailsSet.add(row.errorDetails.trim());
      }
      if (row.clientNumber && !groupClientNumber) {
        groupClientNumber = row.clientNumber;
      }
      if (row.claimAmount != null) {
        const amt = typeof row.claimAmount === "number" ? row.claimAmount : parseFloat(row.claimAmount) || 0;
        totalAmount += amt;
      }
      if (row.errorTypeId && !groupErrorTypeId) {
        groupErrorTypeId = row.errorTypeId;
        groupErrorTypeName = row.errorTypeName || null;
      }
    }

    const groupErrorDetails = Array.from(errorDetailsSet).join("; ") || null;
    const hasErrorDetails = !!groupErrorDetails;

    if (!groupId) {
      const [newGroup] = await db.insert(invoiceGroupsTable).values({
        invoiceNumber,
        clientNumber: groupClientNumber,
        errorDetails: groupErrorDetails,
        errorTypeId: groupErrorTypeId,
        errorTypeName: groupErrorTypeName,
        status: hasErrorDetails ? "New" : "Needs Review",
        outcome: "Pending",
        rideCount: groupRows.length,
        totalAmount: String(totalAmount),
        importBatch: batchId,
      }).returning({ id: invoiceGroupsTable.id });
      groupId = newGroup.id;
      groupsCreated++;
    } else {
      await db.update(invoiceGroupsTable).set({
        rideCount: groupRows.length,
        totalAmount: String(totalAmount),
        ...(groupErrorDetails ? { errorDetails: groupErrorDetails } : {}),
        ...(groupErrorTypeId ? { errorTypeId: groupErrorTypeId, errorTypeName: groupErrorTypeName } : {}),
      }).where(eq(invoiceGroupsTable.id, groupId));
    }

    for (const row of groupRows) {
      const existingId = existingMap.get(row.confNumber);

      if (existingId != null) {
        if (dupAction === "update") {
          // `row.date` is already normalized to ISO `YYYY-MM-DD` (or
          // null) by the up-front rejection pass; no per-row guard
          // needed here. The typed column would reject anything else.
          const updateData: Partial<typeof claimsTable.$inferInsert> = { invoiceGroupId: groupId };
          if (row.date !== null) updateData.date = row.date;
          if (row.refNumber) updateData.refNumber = row.refNumber;
          if (row.clientNumber) updateData.clientNumber = row.clientNumber;
          if (row.carNumber) updateData.carNumber = String(row.carNumber);
          if (row.errorDetails) updateData.errorDetails = row.errorDetails;
          if (row.claimAmount != null) {
            updateData.claimAmount = String(typeof row.claimAmount === "number" ? row.claimAmount : parseFloat(row.claimAmount) || 0);
          }
          await db.update(claimsTable).set(updateData).where(eq(claimsTable.id, existingId));
          updated++;
        } else {
          duplicates.push(row.confNumber);
          skipped++;
        }
      } else {
        const hasErrorType = row.errorTypeId != null;
        await db.insert(claimsTable).values({
          invoiceGroupId: groupId,
          confNumber: row.confNumber,
          // Already-normalized ISO date (or null) — see up-front
          // rejection pass for the contract.
          date: row.date,
          refNumber: row.refNumber || "",
          clientNumber: row.clientNumber || groupClientNumber || "",
          carNumber: String(row.carNumber || ""),
          errorDetails: row.errorDetails || "",
          errorTypeId: row.errorTypeId || null,
          errorTypeName: row.errorTypeName || null,
          claimAmount: row.claimAmount != null ? String(typeof row.claimAmount === "number" ? row.claimAmount : parseFloat(row.claimAmount) || 0) : null,
          status: "New",
          outcome: "Pending",
          disposition: importedClaimDisposition({
            errorTypeId: row.errorTypeId ?? null,
            includedInDispute: hasErrorType,
            status: "New",
          }),
          importBatch: batchId,
          invoiceNumbers: invoiceNumber,
          includedInDispute: hasErrorType,
        });
        created++;
        if (!hasErrorType) excludedCount++;
      }
    }

    // Refresh the group's denormalized earliest-service-date column now
    // that every child claim for this invoice has been inserted /
    // updated. The helper is the single canonical write path so the
    // dashboard, queue, and groups list always read the same value
    // — see lib/group-service-date.ts. No-op when the MIN didn't move.
    if (groupId != null) {
      await recomputeGroupServiceDate(groupId);
    }
  }

  for (const row of noInvoiceRows) {
    const existingId = existingMap.get(row.confNumber);

    if (existingId != null) {
      if (dupAction === "update") {
        const updateData: Partial<typeof claimsTable.$inferInsert> = {};
        if (row.date !== null) updateData.date = row.date;
        if (row.refNumber) updateData.refNumber = row.refNumber;
        if (row.clientNumber) updateData.clientNumber = row.clientNumber;
        if (row.carNumber) updateData.carNumber = String(row.carNumber);
        if (row.errorDetails) updateData.errorDetails = row.errorDetails;
        if (row.claimAmount != null) {
          updateData.claimAmount = String(typeof row.claimAmount === "number" ? row.claimAmount : parseFloat(row.claimAmount) || 0);
        }
        if (Object.keys(updateData).length > 0) {
          await db.update(claimsTable).set(updateData).where(eq(claimsTable.id, existingId));
          updated++;
        } else {
          skipped++;
        }
      } else {
        duplicates.push(row.confNumber);
        skipped++;
      }
    } else {
      const hasErrorType = row.errorTypeId != null;
      const stampedStatus: "New" | "Needs Review" =
        (!row.errorDetails || !row.errorDetails.trim()) ? "Needs Review" : "New";
      await db.insert(claimsTable).values({
        confNumber: row.confNumber,
        date: row.date,
        refNumber: row.refNumber || "",
        clientNumber: row.clientNumber || "",
        carNumber: String(row.carNumber || ""),
        errorDetails: row.errorDetails || "",
        errorTypeId: row.errorTypeId || null,
        errorTypeName: row.errorTypeName || null,
        claimAmount: row.claimAmount != null ? String(typeof row.claimAmount === "number" ? row.claimAmount : parseFloat(row.claimAmount) || 0) : null,
        status: stampedStatus,
        outcome: "Pending",
        disposition: importedClaimDisposition({
          errorTypeId: row.errorTypeId ?? null,
          includedInDispute: hasErrorType,
          status: stampedStatus,
        }),
        importBatch: batchId,
        includedInDispute: hasErrorType,
      });
      created++;
      if (!hasErrorType) excludedCount++;
    }
  }

  // Record a single human-readable activity row so the dashboard activity
  // feed can show "X imported N claims from job-status report".
  if (created > 0 || updated > 0 || groupsCreated > 0 || rejected.length > 0) {
    await db.insert(auditLogsTable).values({
      claimId: null,
      invoiceGroupId: null,
      action: "claims_imported",
      details: `Imported ${created} claim${created === 1 ? "" : "s"} (${updated} updated, ${skipped} skipped${rejected.length > 0 ? `, ${rejected.length} rejected` : ""}) across ${groupsCreated} new invoice group${groupsCreated === 1 ? "" : "s"}`,
      metadata: {
        batchId,
        created,
        updated,
        skipped,
        excludedCount,
        groupsCreated,
        invoiceGroupCount: invoiceMap.size,
        total: rows.length,
        rejectedCount: rejected.length,
        // Cap embedded sample so the audit row stays small even if the
        // operator uploads a CSV where every row has a busted date.
        rejectedSample: rejected.slice(0, 25),
      },
      userEmail: req.user?.email ?? null,
      userName: req.user?.displayName ?? null,
    });
  }

  res.json({
    success: true,
    created,
    skipped,
    updated,
    excludedCount,
    duplicates,
    total: rows.length,
    batchId,
    groupsCreated,
    invoiceGroupCount: invoiceMap.size,
    rejected,
  });
}));

export default router;
