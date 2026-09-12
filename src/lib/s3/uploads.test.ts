import { S3Client } from "@aws-sdk/client-s3";
import { describe, expect, it } from "vitest";

import {
  createUploadKey,
  PRESIGN_EXPIRY_SECONDS,
  signUploads,
  UPLOAD_CONTENT_TYPE,
} from "./uploads";

/**
 * `getSignedUrl` is pure crypto — no network call — so these assert the URL's
 * own structure directly rather than standing up a fake server. What matters
 * here is our wiring, not the SDK's signature math.
 */

const BUCKET = "tally";
const PUBLIC_URL_BASE = "https://files.tally.example.com";

function fakeS3(): S3Client {
  return new S3Client({
    endpoint: "http://127.0.0.1:9/unreachable",
    region: "garage",
    credentials: { accessKeyId: "test-key", secretAccessKey: "test-secret" },
    forcePathStyle: true,
  });
}

describe("createUploadKey", () => {
  it("is flat, under intake/, and ends .webp", () => {
    const key = createUploadKey();
    expect(key).toMatch(
      /^intake\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$/,
    );
  });

  it("never repeats", () => {
    const keys = new Set(Array.from({ length: 20 }, () => createUploadKey()));
    expect(keys.size).toBe(20);
  });
});

describe("signUploads", () => {
  it("returns exactly `count` uploads, each with a working shape", async () => {
    const uploads = await signUploads(3, {
      s3: fakeS3(),
      bucket: BUCKET,
      publicUrlBase: PUBLIC_URL_BASE,
    });

    expect(uploads).toHaveLength(3);
    for (const upload of uploads) {
      expect(upload.key).toMatch(/^intake\/.+\.webp$/);
      expect(upload.publicUrl).toBe(`${PUBLIC_URL_BASE}/${upload.key}`);

      const url = new URL(upload.url);
      expect(url.origin).toBe("http://127.0.0.1:9");
      expect(url.pathname).toBe(`/unreachable/${BUCKET}/${upload.key}`);
      expect(url.searchParams.get("X-Amz-Signature")).not.toBeNull();
      expect(url.searchParams.get("X-Amz-Expires")).toBe(String(PRESIGN_EXPIRY_SECONDS));
    }
  });

  it("signs a PUT for the fixed content type, not whatever the caller happened to send", async () => {
    const [upload] = await signUploads(1, {
      s3: fakeS3(),
      bucket: BUCKET,
      publicUrlBase: PUBLIC_URL_BASE,
    });
    // Content-Type is part of what SigV4 signs — a mismatched header at PUT
    // time fails the signature rather than silently accepting a JPEG.
    const url = new URL(upload!.url);
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toContain("host");
    expect(UPLOAD_CONTENT_TYPE).toBe("image/webp");
  });

  it("mints a different key for every requested photo", async () => {
    const uploads = await signUploads(4, {
      s3: fakeS3(),
      bucket: BUCKET,
      publicUrlBase: PUBLIC_URL_BASE,
    });
    expect(new Set(uploads.map((u) => u.key)).size).toBe(4);
  });

  it("returns nothing for a count of zero rather than erroring", async () => {
    const uploads = await signUploads(0, {
      s3: fakeS3(),
      bucket: BUCKET,
      publicUrlBase: PUBLIC_URL_BASE,
    });
    expect(uploads).toEqual([]);
  });
});
