/**
 * One photo, from a downscaled WebP blob to a landed object in Garage.
 * "Retry twice then keep the blob in IndexedDB" (BUILD_PLAN §9) — the retry
 * lives here; the IndexedDB fallback is the caller's job (`use-photo-capture.ts`),
 * since only the caller knows the photo's place in the capture queue.
 */

export interface UploadedPhoto {
  key: string;
  publicUrl: string;
}

export class UploadFailedError extends Error {}

/** One attempt, then two retries. */
export const MAX_UPLOAD_ATTEMPTS = 3;
const RETRY_DELAY_MS = 500;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function requestSignedUpload(
  signal?: AbortSignal,
): Promise<{ key: string; url: string; publicUrl: string }> {
  const response = await fetch("/api/uploads/sign", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ count: 1 }),
    signal,
  });
  if (!response.ok) throw new UploadFailedError(`Could not prepare an upload (${response.status})`);

  const body = (await response.json()) as {
    uploads: { key: string; url: string; publicUrl: string }[];
  };
  const upload = body.uploads[0];
  if (upload === undefined) throw new UploadFailedError("No upload URL was returned");
  return upload;
}

async function putBlob(url: string, blob: Blob, signal?: AbortSignal): Promise<void> {
  const response = await fetch(url, {
    method: "PUT",
    headers: { "content-type": "image/webp" },
    body: blob,
    signal,
  });
  if (!response.ok) throw new UploadFailedError(`Upload failed (${response.status})`);
}

export interface UploadPhotoOptions {
  signal?: AbortSignal;
  maxAttempts?: number;
}

/**
 * Signs a fresh URL on every attempt rather than reusing one across retries —
 * simpler to reason about than tracking whether a failed PUT partially landed,
 * and a presigned URL costs nothing to mint again.
 */
export async function uploadPhoto(
  blob: Blob,
  { signal, maxAttempts = MAX_UPLOAD_ATTEMPTS }: UploadPhotoOptions = {},
): Promise<UploadedPhoto> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const signed = await requestSignedUpload(signal);
      await putBlob(signed.url, blob, signal);
      return { key: signed.key, publicUrl: signed.publicUrl };
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) await sleep(RETRY_DELAY_MS);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
