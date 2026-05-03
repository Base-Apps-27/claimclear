import { useState, useCallback } from "react";

const ALLOWED_UPLOAD_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/heic",
  "image/heif",
  "image/tiff",
  "image/bmp",
  "application/pdf",
]);

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

interface UploadResponse {
  objectPath: string;
  metadata?: {
    name?: string;
    contentType?: string;
  };
}

interface UseUploadOptions {
  basePath?: string;
  onSuccess?: (response: UploadResponse) => void;
  onError?: (error: Error) => void;
}

/**
 * React hook for handling file uploads via the server-mediated PUT endpoint.
 *
 * File bytes are sent directly to the API server, which validates the content
 * type against an allowlist (image/png, image/jpeg, image/gif, image/webp,
 * image/heic, image/heif, image/tiff, image/bmp, application/pdf), enforces a
 * 50 MB size limit while streaming to object storage, and returns the resulting
 * object path. No presigned URLs are issued.
 *
 * @example
 * ```tsx
 * function FileUploader() {
 *   const { uploadFile, isUploading, error } = useUpload({
 *     onSuccess: (response) => {
 *       console.log("Uploaded to:", response.objectPath);
 *     },
 *   });
 *
 *   const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
 *     const file = e.target.files?.[0];
 *     if (file) await uploadFile(file);
 *   };
 *
 *   return (
 *     <div>
 *       <input type="file" onChange={handleFileChange} disabled={isUploading} />
 *       {isUploading && <p>Uploading...</p>}
 *       {error && <p>Error: {error.message}</p>}
 *     </div>
 *   );
 * }
 * ```
 */
export function useUpload(options: UseUploadOptions = {}) {
  const basePath = options.basePath ?? "/api/storage";
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [progress, setProgress] = useState(0);

  const uploadFile = useCallback(
    async (file: File): Promise<UploadResponse | null> => {
      if (!ALLOWED_UPLOAD_TYPES.has(file.type)) {
        const err = new Error(
          `Unsupported file type "${file.type}". Allowed types: ${[...ALLOWED_UPLOAD_TYPES].join(", ")}`
        );
        setError(err);
        options.onError?.(err);
        return null;
      }

      if (file.size > MAX_UPLOAD_BYTES) {
        const err = new Error(
          `File size ${file.size} bytes exceeds the maximum allowed size of ${MAX_UPLOAD_BYTES} bytes`
        );
        setError(err);
        options.onError?.(err);
        return null;
      }

      setIsUploading(true);
      setError(null);
      setProgress(0);

      try {
        setProgress(10);
        const response = await fetch(`${basePath}/uploads`, {
          method: "PUT",
          headers: {
            "Content-Type": file.type,
            "x-upload-name": file.name,
          },
          body: file,
          credentials: "include",
        });

        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(
            (data as { error?: string }).error ||
              `Upload failed with status ${response.status}`
          );
        }

        setProgress(100);
        const result = (await response.json()) as UploadResponse;
        options.onSuccess?.(result);
        return result;
      } catch (err) {
        const uploadError =
          err instanceof Error ? err : new Error("Upload failed");
        setError(uploadError);
        options.onError?.(uploadError);
        return null;
      } finally {
        setIsUploading(false);
      }
    },
    [basePath, options]
  );

  return {
    uploadFile,
    isUploading,
    error,
    progress,
  };
}
