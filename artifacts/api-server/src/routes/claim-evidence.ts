import { Router, type Request, type Response } from "express";
import { db, claimEvidenceTable, claimsTable, invoiceGroupsTable, auditLogsTable, CLAIM_EVIDENCE_CLOSURE_SCOPES, CLOSURE_REASONS } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { ObjectStorageService } from "../lib/objectStorage";

const router = Router();
const objectStorageService = new ObjectStorageService();

/**
 * Task #411 T003 — atomic evidence upload.
 *
 * Upload is a two-step flow: PUT /storage/uploads finalizes the blob,
 * then POST /claims/:id/evidence (or /claim-evidence/closure) inserts
 * the `claim_evidence` row pointing at it. If the second step throws,
 * the blob would otherwise be orphaned — paying GCS rent forever
 * with no UI surface that references it. This helper reverses the
 * blob-finalize step IF and ONLY IF no other `claim_evidence` row
 * already references the same `imageUrl` (so we don't accidentally
 * delete a blob another claim still uses, e.g. an attached evidence
 * file the operator is re-attaching to a different leg).
 */
async function bestEffortCleanupOrphanBlob(imageUrl: string | null | undefined): Promise<boolean> {
  if (!imageUrl || typeof imageUrl !== "string" || !imageUrl.startsWith("/objects/")) {
    return false;
  }
  const refs = await db
    .select({ id: claimEvidenceTable.id })
    .from(claimEvidenceTable)
    .where(eq(claimEvidenceTable.imageUrl, imageUrl))
    .limit(1);
  if (refs.length > 0) return false;
  return objectStorageService.tryDeleteObjectEntity(imageUrl);
}

function isValidImageUrl(url: unknown): url is string {
  return typeof url === "string" && url.startsWith("/objects/");
}

router.get("/claims/:claimId/evidence", async (req: Request, res: Response) => {
  const claimId = parseInt(String(req.params.claimId), 10);
  if (isNaN(claimId)) {
    res.status(400).json({ error: "Invalid claim ID" });
    return;
  }
  try {
    const evidence = await db.select().from(claimEvidenceTable)
      .where(eq(claimEvidenceTable.claimId, claimId))
      .orderBy(claimEvidenceTable.collectedAt);
    res.json({ evidence });
  } catch (error) {
    req.log.error({ err: error }, "Error listing claim evidence");
    res.status(500).json({ error: "Failed to list claim evidence" });
  }
});

router.post("/claims/:claimId/evidence", async (req: Request, res: Response) => {
  const claimId = parseInt(String(req.params.claimId), 10);
  if (isNaN(claimId)) {
    res.status(400).json({ error: "Invalid claim ID" });
    return;
  }
  const { evidenceTypeId, evidenceTypeName, treeNodeId, imageUrl, notes } = req.body;
  if (!evidenceTypeName) {
    res.status(400).json({ error: "evidenceTypeName is required" });
    return;
  }
  if (imageUrl != null && imageUrl !== "" && !isValidImageUrl(imageUrl)) {
    res.status(400).json({ error: "imageUrl must be an application storage path beginning with /objects/" });
    return;
  }
  try {
    const user = (req as any).user;
    const [created] = await db.insert(claimEvidenceTable).values({
      claimId,
      evidenceTypeId: evidenceTypeId || null,
      evidenceTypeName,
      treeNodeId: treeNodeId || null,
      imageUrl: imageUrl || null,
      notes: notes || null,
      collectedBy: user?.displayName || user?.email || null,
    }).returning();
    res.status(201).json(created);
  } catch (error) {
    // Task #411 T003: row insert failed AFTER the blob upload — best
    // effort delete the blob so we don't leak an orphan to GCS.
    const cleaned = await bestEffortCleanupOrphanBlob(imageUrl);
    req.log.error({ err: error, imageUrl, blobCleanedUp: cleaned }, "Error adding claim evidence (orphan blob cleanup attempted)");
    res.status(500).json({ error: "Failed to add claim evidence" });
  }
});

/**
 * POST /claim-evidence/closure
 *
 * Attach an evidence item that was uploaded as part of a structured closure
 * rather than the standard evidence tree. The row is always written with
 * `closureScope = "closure"`; tree-scoped evidence belongs on the regular
 * `POST /claim-evidence` endpoint.
 *
 * Accepts either a `claimId` or an `invoiceGroupId`, never both.
 */
router.post("/claim-evidence/closure", async (req: Request, res: Response) => {
  const {
    claimId: claimIdRaw,
    invoiceGroupId: invoiceGroupIdRaw,
    evidenceTypeId,
    evidenceTypeName,
    treeNodeId,
    imageUrl,
    notes,
    closureReasonAtAttach,
  } = req.body ?? {};

  const claimId = claimIdRaw == null ? null : Number(claimIdRaw);
  const invoiceGroupId = invoiceGroupIdRaw == null ? null : Number(invoiceGroupIdRaw);

  if ((claimId == null && invoiceGroupId == null) ||
      (claimId != null && invoiceGroupId != null)) {
    res.status(400).json({ error: "Provide exactly one of claimId or invoiceGroupId." });
    return;
  }
  if (claimId != null && (Number.isNaN(claimId) || !Number.isFinite(claimId))) {
    res.status(400).json({ error: "claimId must be an integer." });
    return;
  }
  if (invoiceGroupId != null && (Number.isNaN(invoiceGroupId) || !Number.isFinite(invoiceGroupId))) {
    res.status(400).json({ error: "invoiceGroupId must be an integer." });
    return;
  }
  if (typeof evidenceTypeName !== "string" || evidenceTypeName.trim().length === 0) {
    res.status(400).json({ error: "evidenceTypeName is required." });
    return;
  }
  if (typeof imageUrl !== "string" || imageUrl.trim().length === 0) {
    res.status(400).json({ error: "imageUrl is required: closure evidence must reference an uploaded file." });
    return;
  }
  if (!isValidImageUrl(imageUrl)) {
    res.status(400).json({ error: "imageUrl must be an application storage path beginning with /objects/" });
    return;
  }
  if (req.body && Object.prototype.hasOwnProperty.call(req.body, "closureScope") && req.body.closureScope !== "closure") {
    res.status(400).json({ error: 'closureScope on /claim-evidence/closure must be "closure"; use POST /claim-evidence for tree-scoped evidence.' });
    return;
  }
  const scope = "closure";
  if (closureReasonAtAttach != null && !(CLOSURE_REASONS as readonly string[]).includes(closureReasonAtAttach)) {
    res.status(400).json({ error: `closureReasonAtAttach must be one of: ${CLOSURE_REASONS.join(", ")}` });
    return;
  }

  // Validate the parent row exists before inserting.
  if (claimId != null) {
    const [claim] = await db.select({ id: claimsTable.id }).from(claimsTable).where(eq(claimsTable.id, claimId)).limit(1);
    if (!claim) { res.status(404).json({ error: "Claim not found" }); return; }
  } else if (invoiceGroupId != null) {
    const [group] = await db.select({ id: invoiceGroupsTable.id }).from(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, invoiceGroupId)).limit(1);
    if (!group) { res.status(404).json({ error: "Invoice group not found" }); return; }
  }

  try {
    const user = (req as any).user;
    const [created] = await db.insert(claimEvidenceTable).values({
      claimId,
      invoiceGroupId,
      evidenceTypeId: evidenceTypeId ?? null,
      evidenceTypeName: evidenceTypeName.trim(),
      treeNodeId: treeNodeId ?? null,
      imageUrl: imageUrl ?? null,
      notes: notes ?? null,
      collectedBy: user?.displayName || user?.email || null,
      closureScope: scope,
      closureReasonAtAttach: closureReasonAtAttach ?? null,
    }).returning();

    await db.insert(auditLogsTable).values({
      claimId,
      invoiceGroupId,
      action: "closure_evidence_attached",
      details: `Evidence "${created.evidenceTypeName}" attached at closure (${scope})`,
      metadata: {
        evidenceId: created.id,
        evidenceTypeId: created.evidenceTypeId,
        evidenceTypeName: created.evidenceTypeName,
        closureScope: scope,
        closureReasonAtAttach: closureReasonAtAttach ?? null,
      },
      userEmail: user?.email ?? null,
      userName: user?.displayName ?? null,
    });

    res.status(201).json(created);
  } catch (error) {
    // Task #411 T003: same orphan-blob cleanup contract as the
    // tree-scoped insert above.
    const cleaned = await bestEffortCleanupOrphanBlob(imageUrl);
    req.log.error({ err: error, imageUrl, blobCleanedUp: cleaned }, "Error attaching closure evidence (orphan blob cleanup attempted)");
    res.status(500).json({ error: "Failed to attach closure evidence" });
  }
});

router.delete("/claims/:claimId/evidence/:evidenceId", async (req: Request, res: Response) => {
  const claimId = parseInt(String(req.params.claimId), 10);
  const evidenceId = parseInt(String(req.params.evidenceId), 10);
  if (isNaN(claimId) || isNaN(evidenceId)) {
    res.status(400).json({ error: "Invalid claim or evidence ID" });
    return;
  }
  try {
    await db.delete(claimEvidenceTable)
      .where(and(eq(claimEvidenceTable.id, evidenceId), eq(claimEvidenceTable.claimId, claimId)));
    res.json({ success: true });
  } catch (error) {
    req.log.error({ err: error }, "Error deleting claim evidence");
    res.status(500).json({ error: "Failed to delete claim evidence" });
  }
});

export default router;
