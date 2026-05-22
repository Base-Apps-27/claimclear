import { Router, type IRouter, type Request, type Response } from "express";
import { Readable } from "stream";
import { randomUUID } from "crypto";
import { eq, and } from "drizzle-orm";
import {
  MAX_UPLOAD_SIZE_BYTES,
  ALLOWED_UPLOAD_CONTENT_TYPES_SET,
  REPLY_ATTACHMENT_ALLOWED_MIME_SET,
  REPLY_ATTACHMENT_TOTAL_BYTES,
} from "@workspace/api-zod";
import { db, invoiceGroupsTable, replyAttachmentStagingTable } from "@workspace/db";
import { Readable as NodeReadable } from "stream";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";
import { ObjectPermission } from "../lib/objectAcl";
import { asyncHandler } from "../lib/asyncHandler";
import { collectGroupReplyEvidence } from "../lib/reply-evidence";

const SAFE_SERVE_CONTENT_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/bmp",
  "image/tiff",
  "application/pdf",
]);

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

/**
 * PUT /storage/uploads
 *
 * Server-mediated file upload. The client sends the raw file bytes directly
 * to this endpoint. The server validates Content-Type against the allowlist,
 * enforces the byte-size limit while streaming to object storage, and returns
 * the resulting object path. No presigned URLs are issued.
 *
 * Required headers:
 *   Content-Type: must be an allowed MIME type (image/png, image/jpeg, etc.)
 *   x-upload-name: original filename (informational)
 *
 * Optional headers:
 *   Content-Length: declared size; rejected immediately if > MAX_UPLOAD_SIZE_BYTES
 */
router.put("/storage/uploads", async (req: Request, res: Response) => {
  const rawContentType = (req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
  if (!ALLOWED_UPLOAD_CONTENT_TYPES_SET.has(rawContentType)) {
    res.status(415).json({
      error: "Unsupported media type. Allowed types: image/png, image/jpeg, image/gif, image/webp, image/heic, image/heif, image/tiff, image/bmp, application/pdf, text/csv, application/vnd.ms-excel, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    return;
  }

  const declaredLength = parseInt(req.headers["content-length"] || "0", 10);
  if (!isNaN(declaredLength) && declaredLength > MAX_UPLOAD_SIZE_BYTES) {
    res.status(413).json({ error: `File size exceeds maximum allowed size of ${MAX_UPLOAD_SIZE_BYTES} bytes` });
    return;
  }

  const name = String(req.headers["x-upload-name"] || "upload").slice(0, 255);

  try {
    const objectPath = await objectStorageService.uploadStream(req, rawContentType, MAX_UPLOAD_SIZE_BYTES);
    res.json({ objectPath, metadata: { name, contentType: rawContentType } });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "";
    if (msg.includes("exceeds maximum allowed size")) {
      res.status(413).json({ error: msg });
      return;
    }
    req.log.error({ err: error }, "Error uploading file");
    res.status(500).json({ error: "Failed to upload file" });
  }
});

/**
 * GET /storage/public-objects/*
 *
 * Serve public assets from PUBLIC_OBJECT_SEARCH_PATHS.
 * These are unconditionally public — no authentication or ACL checks.
 * IMPORTANT: Always provide this endpoint when object storage is set up.
 */
router.get("/storage/public-objects/*filePath", async (req: Request, res: Response) => {
  try {
    const raw = req.params.filePath;
    const filePath = Array.isArray(raw) ? raw.join("/") : raw;
    const file = await objectStorageService.searchPublicObject(filePath);
    if (!file) {
      res.status(404).json({ error: "File not found" });
      return;
    }

    const response = await objectStorageService.downloadObject(file);

    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));

    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as import("node:stream/web").ReadableStream);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    req.log.error({ err: error }, "Error serving public object");
    res.status(500).json({ error: "Failed to serve public object" });
  }
});

/**
 * GET /storage/objects/* — serve object entities from PRIVATE_OBJECT_DIR.
 * Also mounted at the top-level /objects/* in app.ts so links built from
 * the canonical evidence path (claim_evidence.imageUrl = `/objects/...`)
 * resolve directly without each renderer having to prefix /api/storage.
 */
export async function serveObjectEntity(req: Request, res: Response): Promise<void> {
  try {
    const raw = req.params.path;
    const wildcardPath = Array.isArray(raw) ? raw.join("/") : raw;
    const objectPath = `/objects/${wildcardPath}`;
    const objectFile = await objectStorageService.getObjectEntityFile(objectPath);

    // --- Protected route example (uncomment when using replit-auth) ---
    // if (!req.isAuthenticated()) {
    //   res.status(401).json({ error: "Unauthorized" });
    //   return;
    // }
    // const canAccess = await objectStorageService.canAccessObjectEntity({
    //   userId: req.user.id,
    //   objectFile,
    //   requestedPermission: ObjectPermission.READ,
    // });
    // if (!canAccess) {
    //   res.status(403).json({ error: "Forbidden" });
    //   return;
    // }

    const response = await objectStorageService.downloadObject(objectFile);

    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));

    const servedContentType = (response.headers.get("Content-Type") || "").split(";")[0].trim().toLowerCase();
    if (!SAFE_SERVE_CONTENT_TYPES.has(servedContentType)) {
      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("Content-Disposition", "attachment");
    }
    res.setHeader("X-Content-Type-Options", "nosniff");

    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as import("node:stream/web").ReadableStream);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      req.log.warn({ err: error }, "Object not found");
      res.status(404).json({ error: "Object not found" });
      return;
    }
    req.log.error({ err: error }, "Error serving object");
    res.status(500).json({ error: "Failed to serve object" });
  }
}

router.get("/storage/objects/*path", serveObjectEntity);

/**
 * PUT /storage/reply-attachments/stage
 *
 * Task #713 — staged-upload endpoint for the reply composer.
 *
 * Streams the file bytes into object storage AND records a
 * `reply_attachment_staging` row pinned to the calling user. Returns an
 * opaque `stagedId` the composer hands back on the reply request. The
 * server then resolves that id to the authoritative storage key and
 * server-recorded MIME / size — clients never get to choose which object
 * gets attached or what we say its content type is.
 *
 * Differs from `PUT /storage/uploads` (the SOP-evidence path) in two
 * important ways:
 *   1. Narrower MIME allowlist — only the reply-attachment subset
 *      (PNG/JPG/GIF/WebP + PDF + CSV/Excel), not the full evidence
 *      list (no HEIC/TIFF/BMP — payors can't reliably open those).
 *   2. Returns a `stagedId` token instead of the raw `objectPath`, so
 *      the reply-attachment trust boundary lives entirely server-side.
 *
 * Required headers:
 *   Content-Type: must be one of REPLY_ATTACHMENT_ALLOWED_MIME
 *   x-upload-name: original filename (informational; clamped to 255 chars)
 */
router.put(
  "/storage/reply-attachments/stage",
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const rawContentType = (req.headers["content-type"] || "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    if (!REPLY_ATTACHMENT_ALLOWED_MIME_SET.has(rawContentType)) {
      res.status(415).json({
        error:
          "Unsupported media type. Reply attachments must be PNG, JPG, GIF, WebP, PDF, CSV, or Excel (.xls/.xlsx).",
      });
      return;
    }

    const declaredLength = parseInt(
      req.headers["content-length"] || "0",
      10,
    );
    if (
      !Number.isNaN(declaredLength) &&
      declaredLength > REPLY_ATTACHMENT_TOTAL_BYTES
    ) {
      res.status(413).json({
        error: `File size exceeds maximum allowed size of ${REPLY_ATTACHMENT_TOTAL_BYTES} bytes`,
      });
      return;
    }

    const fileName = String(req.headers["x-upload-name"] || "upload").slice(0, 255);

    let storageKey: string;
    try {
      storageKey = await objectStorageService.uploadStream(
        req,
        rawContentType,
        REPLY_ATTACHMENT_TOTAL_BYTES,
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : "";
      if (msg.includes("exceeds maximum allowed size")) {
        res.status(413).json({ error: msg });
        return;
      }
      req.log.error({ err: error }, "Failed to stage reply attachment");
      res.status(500).json({ error: "Failed to upload file" });
      return;
    }

    // Re-stat the just-written object so the size we record matches what
    // ended up on disk (uploadStream's byte-guard caps but doesn't return
    // the final size).
    let actualSize = 0;
    try {
      const file = await objectStorageService.getObjectEntityFile(storageKey);
      const [meta] = await file.getMetadata();
      actualSize =
        typeof meta.size === "number" ? meta.size : Number(meta.size ?? 0);
    } catch (err) {
      req.log.error({ err, storageKey }, "Could not re-stat staged upload");
      await objectStorageService.tryDeleteObjectEntity(storageKey);
      res.status(500).json({ error: "Failed to record upload" });
      return;
    }

    const stagedId = randomUUID();
    try {
      await db.insert(replyAttachmentStagingTable).values({
        id: stagedId,
        userEmail: req.user?.email ?? null,
        storageKey,
        fileName,
        contentType: rawContentType,
        sizeBytes: actualSize,
      });
    } catch (err) {
      req.log.error({ err, storageKey }, "Failed to insert staging row");
      await objectStorageService.tryDeleteObjectEntity(storageKey);
      res.status(500).json({ error: "Failed to record upload" });
      return;
    }

    res.json({
      stagedId,
      name: fileName,
      contentType: rawContentType,
      size: actualSize,
    });
  }),
);

/**
 * DELETE /storage/reply-attachments/stage/:stagedId
 *
 * Best-effort: lets the composer drop a staged file when the operator
 * removes the chip before sending. Only the user that staged the file may
 * delete it. Idempotent — already-purged ids return 200 so the UI doesn't
 * have to track double-clicks. Errors are logged but the response stays
 * successful so the composer can clear its chip regardless.
 */
router.delete(
  "/storage/reply-attachments/stage/:stagedId",
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const stagedId = String(req.params.stagedId || "").trim();
    if (!stagedId) {
      res.status(400).json({ error: "stagedId is required" });
      return;
    }
    const userEmail = req.user?.email ?? null;

    const [row] = await db
      .select()
      .from(replyAttachmentStagingTable)
      .where(eq(replyAttachmentStagingTable.id, stagedId))
      .limit(1);

    if (!row) {
      res.json({ ok: true });
      return;
    }
    if (row.consumedAt) {
      // Already attached to a sent reply — refuse to delete the underlying
      // blob (the audit trail still references it).
      res.status(409).json({ error: "Attachment already sent" });
      return;
    }
    // Strict equality: a row owned by user A cannot be deleted by user B,
    // and a logged-in user cannot reach in to delete an anonymous row
    // (or vice versa). Mirrors the send-path ownership check in
    // `resolveReplyAttachments`.
    if (row.userEmail !== userEmail) {
      res.status(403).json({ error: "Not your attachment" });
      return;
    }

    try {
      await objectStorageService.tryDeleteObjectEntity(row.storageKey);
    } catch (err) {
      req.log.warn({ err, stagedId }, "Best-effort delete of staged blob failed");
    }
    await db
      .delete(replyAttachmentStagingTable)
      .where(
        and(
          eq(replyAttachmentStagingTable.id, stagedId),
          // Defensive — extra guard so a stale row created mid-flight by
          // a different user can't be deleted via this handler.
          row.userEmail
            ? eq(replyAttachmentStagingTable.userEmail, row.userEmail)
            : undefined,
        ),
      );

    res.json({ ok: true });
  }),
);

/**
 * POST /storage/reply-attachments/stage-from-evidence
 *
 * Companion to the upload-bytes staging endpoint above. The reply
 * composer's "Attach from this case" picker calls this with one of the
 * URLs returned by `GET /invoice-groups/:id/reply-evidence`. We re-run
 * the same membership check via `collectGroupReplyEvidence` (single
 * source of truth — never trust the client to tell us a URL belongs to
 * a group), copy the bytes into a fresh staging object, and insert a
 * `reply_attachment_staging` row pinned to the calling user. The
 * resulting `stagedId` is interchangeable with one returned by the
 * upload endpoint, so the send-reply path needs zero special-casing.
 */
router.post(
  "/storage/reply-attachments/stage-from-evidence",
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const body = (req.body ?? {}) as {
      groupId?: unknown;
      url?: unknown;
      name?: unknown;
    };
    const groupId =
      typeof body.groupId === "number" && Number.isFinite(body.groupId)
        ? body.groupId
        : NaN;
    const rawUrl = typeof body.url === "string" ? body.url.trim() : "";
    if (!Number.isInteger(groupId) || groupId <= 0) {
      res.status(400).json({ error: "groupId must be a positive integer" });
      return;
    }
    if (!rawUrl || !rawUrl.startsWith("/objects/")) {
      res
        .status(400)
        .json({ error: "url must be an object-storage path starting with /objects/" });
      return;
    }

    // Confirm the group exists first so a missing group surfaces as
    // 404 (matching `GET /invoice-groups/:id/reply-evidence`) instead
    // of getting swallowed into the empty-evidence 403 below.
    const [groupRow] = await db
      .select({ id: invoiceGroupsTable.id })
      .from(invoiceGroupsTable)
      .where(eq(invoiceGroupsTable.id, groupId))
      .limit(1);
    if (!groupRow) {
      res.status(404).json({ error: "Invoice group not found" });
      return;
    }

    // Membership check — same join the picker uses. If the URL isn't
    // in the group's evidence pool we 403 rather than silently copying
    // an arbitrary storage object the operator happened to know about.
    const evidence = await collectGroupReplyEvidence(groupId);
    const match = evidence.find((e) => e.url === rawUrl);
    if (!match) {
      res
        .status(403)
        .json({ error: "URL is not part of this group's evidence pool" });
      return;
    }

    // Open the source object. If it's gone (operator deleted it from
    // storage between the picker fetch and the click), surface a 404 —
    // the picker can refresh and try again.
    let sourceFile;
    try {
      sourceFile = await objectStorageService.getObjectEntityFile(rawUrl);
    } catch (err) {
      if (err instanceof ObjectNotFoundError) {
        res.status(404).json({ error: "Source attachment no longer exists" });
        return;
      }
      req.log.error({ err, rawUrl }, "Failed to open source attachment");
      res.status(500).json({ error: "Failed to read source attachment" });
      return;
    }

    // Trust storage's recorded content-type over the picker's filename
    // guess. Reject anything outside the reply-attachment allowlist
    // before we waste bytes copying it.
    const [sourceMeta] = await sourceFile.getMetadata();
    const sourceContentType = (
      (typeof sourceMeta.contentType === "string" ? sourceMeta.contentType : "") ||
      match.contentType ||
      ""
    )
      .split(";")[0]
      .trim()
      .toLowerCase();
    if (!REPLY_ATTACHMENT_ALLOWED_MIME_SET.has(sourceContentType)) {
      res.status(400).json({
        error:
          "Source attachment is not a supported reply-attachment type (PNG, JPG, GIF, WebP, PDF, CSV, or Excel).",
      });
      return;
    }
    const sourceSize =
      typeof sourceMeta.size === "number"
        ? sourceMeta.size
        : Number(sourceMeta.size ?? 0);
    if (
      Number.isFinite(sourceSize) &&
      sourceSize > REPLY_ATTACHMENT_TOTAL_BYTES
    ) {
      res.status(413).json({
        error: `File size exceeds maximum allowed size of ${REPLY_ATTACHMENT_TOTAL_BYTES} bytes`,
      });
      return;
    }

    // Stream-copy into a fresh staging blob via the existing helper —
    // re-uses the byte-cap guard so a corrupt content-length header on
    // the source can't bypass the reply cap.
    const sourceStream = sourceFile.createReadStream();
    let storageKey: string;
    try {
      storageKey = await objectStorageService.uploadStream(
        sourceStream as unknown as NodeReadable,
        sourceContentType,
        REPLY_ATTACHMENT_TOTAL_BYTES,
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : "";
      if (msg.includes("exceeds maximum allowed size")) {
        res.status(413).json({ error: msg });
        return;
      }
      req.log.error({ err: error, rawUrl }, "Failed to copy evidence into staging");
      res.status(500).json({ error: "Failed to copy attachment" });
      return;
    }

    // Re-stat the new object so we record the bytes actually written.
    let actualSize = 0;
    try {
      const file = await objectStorageService.getObjectEntityFile(storageKey);
      const [meta] = await file.getMetadata();
      actualSize =
        typeof meta.size === "number" ? meta.size : Number(meta.size ?? 0);
    } catch (err) {
      req.log.error({ err, storageKey }, "Could not re-stat copied staging object");
      await objectStorageService.tryDeleteObjectEntity(storageKey);
      res.status(500).json({ error: "Failed to record copied attachment" });
      return;
    }

    const rawName =
      typeof body.name === "string" && body.name.trim().length > 0
        ? body.name.trim()
        : match.name;
    const fileName = rawName.slice(0, 255);

    const stagedId = randomUUID();
    try {
      await db.insert(replyAttachmentStagingTable).values({
        id: stagedId,
        userEmail: req.user?.email ?? null,
        storageKey,
        fileName,
        contentType: sourceContentType,
        sizeBytes: actualSize,
      });
    } catch (err) {
      req.log.error({ err, storageKey }, "Failed to insert staging row for copy");
      await objectStorageService.tryDeleteObjectEntity(storageKey);
      res.status(500).json({ error: "Failed to record copied attachment" });
      return;
    }

    res.json({
      stagedId,
      name: fileName,
      contentType: sourceContentType,
      size: actualSize,
    });
  }),
);

export default router;
