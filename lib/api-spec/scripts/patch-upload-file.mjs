#!/usr/bin/env node
/**
 * Post-codegen patch for the generated `uploadFile` client.
 *
 * Why this exists:
 *   The OpenAPI spec for PUT /storage/uploads declares multiple binary
 *   request-body content types (image/png, image/jpeg, image/gif, image/webp,
 *   image/heic, image/heif, image/tiff, image/bmp, application/pdf). Orval's
 *   default generator does not know how to handle a Blob body across multiple
 *   binary content types and emits a broken implementation that
 *   JSON.stringify()s the Blob and hard-codes Content-Type to "image/png".
 *   That uploads the literal 2-byte string "{}" instead of the file.
 *
 *   This script rewrites the generated `uploadFile` function in-place so it
 *   sends the raw Blob bytes and uses the Blob's actual MIME type as the
 *   Content-Type. The fix has to live as a post-codegen patch (not in the
 *   spec) because the server validates the real HTTP Content-Type against an
 *   allowlist, so the client must send the file's actual type — which Orval's
 *   spec-driven generator can't express across this multi-content-type body.
 *
 *   If you ever upgrade Orval and confirm it handles this case correctly,
 *   you can delete this script and the codegen step that runs it.
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TARGET = path.resolve(
  __dirname,
  "..",
  "..",
  "api-client-react",
  "src",
  "generated",
  "api.ts",
);

const BROKEN_BODY_RE =
  /export const uploadFile = async \(\s*uploadFileBody: Blob,\s*options\?: RequestInit,\s*\): Promise<UploadResponse> => \{\s*return customFetch<UploadResponse>\(getUploadFileUrl\(\), \{\s*\.\.\.options,\s*method: "PUT",\s*headers: \{ "Content-Type": "image\/png", \.\.\.options\?\.headers \},\s*body: JSON\.stringify\(uploadFileBody\),\s*\}\);\s*\};/;

const FIXED_BODY = `export const uploadFile = async (
  uploadFileBody: Blob,
  options?: RequestInit,
): Promise<UploadResponse> => {
  return customFetch<UploadResponse>(getUploadFileUrl(), {
    ...options,
    method: "PUT",
    headers: {
      "Content-Type": uploadFileBody.type || "application/octet-stream",
      ...options?.headers,
    },
    body: uploadFileBody,
  });
};`;

const src = await readFile(TARGET, "utf8");

if (!BROKEN_BODY_RE.test(src)) {
  if (src.includes("body: uploadFileBody,")) {
    console.log(
      "[patch-upload-file] uploadFile already patched, nothing to do.",
    );
    process.exit(0);
  }
  console.error(
    "[patch-upload-file] ERROR: could not locate the broken uploadFile body in",
    TARGET,
    "\nThe generator output may have changed. Inspect api.ts and update this script.",
  );
  process.exit(1);
}

const patched = src.replace(BROKEN_BODY_RE, FIXED_BODY);
await writeFile(TARGET, patched, "utf8");
console.log("[patch-upload-file] uploadFile patched to send raw Blob bytes.");
