import { Router, type IRouter, type Request, type Response } from "express";
import { Readable } from "stream";
import {
  MAX_UPLOAD_SIZE_BYTES,
  ALLOWED_UPLOAD_CONTENT_TYPES_SET,
} from "@workspace/api-zod";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";
import { ObjectPermission } from "../lib/objectAcl";

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
      error: "Unsupported media type. Allowed types: image/png, image/jpeg, image/gif, image/webp, image/heic, image/heif, image/tiff, image/bmp, application/pdf",
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
 * GET /storage/objects/*
 *
 * Serve object entities from PRIVATE_OBJECT_DIR.
 * These are served from a separate path from /public-objects and can optionally
 * be protected with authentication or ACL checks based on the use case.
 */
router.get("/storage/objects/*path", async (req: Request, res: Response) => {
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
});

export default router;
