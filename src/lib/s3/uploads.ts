import { randomUUID } from "node:crypto";

import { PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { envVar } from "@/lib/env";

import { getS3Client } from "./client";

/**
 * Presigned uploads for the capture flow (BUILD_PLAN §9). Every photo is
 * re-encoded to WebP client-side before it is uploaded — see
 * `src/lib/capture/downscale.ts` — so the content type is fixed, not
 * negotiated per request.
 */

/** "Shoot 1–4 photos" — the capture UI's own limit, enforced again here. */
export const MAX_PHOTOS_PER_UPLOAD = 4;
export const UPLOAD_CONTENT_TYPE = "image/webp";
/** Long enough for a slow upload on store wifi; short enough that a leaked URL expires same-shift. */
export const PRESIGN_EXPIRY_SECONDS = 300;

export interface SignedUpload {
  /** The S3 object key — what a draft's `images[].key` will hold once one exists (commit 10). */
  key: string;
  /** PUT here, once, before it expires. */
  url: string;
  /** GET here after — `draftImageSchema.url`. */
  publicUrl: string;
}

/**
 * `intake/<uuid>.webp` — flat, because no draft exists yet at capture time.
 * Photos are taken before price and quantity are even entered; the draft that
 * eventually references this key is created at intake (commit 10).
 */
export function createUploadKey(): string {
  return `intake/${randomUUID()}.webp`;
}

export interface SignUploadsOptions {
  /** Test seam — a real client talks to whatever `S3_ENDPOINT` says. */
  s3?: S3Client;
  bucket?: string;
  publicUrlBase?: string;
}

/** One presigned PUT URL per requested photo, `count` of them. */
export async function signUploads(
  count: number,
  {
    s3 = getS3Client(),
    bucket = envVar("S3_BUCKET"),
    publicUrlBase = envVar("S3_PUBLIC_URL"),
  }: SignUploadsOptions = {},
): Promise<SignedUpload[]> {
  return Promise.all(
    Array.from({ length: count }, async () => {
      const key = createUploadKey();
      const url = await getSignedUrl(
        s3,
        new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: UPLOAD_CONTENT_TYPE }),
        { expiresIn: PRESIGN_EXPIRY_SECONDS },
      );
      return { key, url, publicUrl: `${publicUrlBase}/${key}` };
    }),
  );
}
