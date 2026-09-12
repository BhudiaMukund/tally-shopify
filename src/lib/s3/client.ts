import { S3Client } from "@aws-sdk/client-s3";

import { envVar } from "@/lib/env";

/**
 * One S3 client per process, matching `src/lib/shopify/client.ts`'s pattern.
 *
 * `requestChecksumCalculation: "WHEN_REQUIRED"` matters more than it looks:
 * the AWS SDK v3 default computes a CRC32 checksum and bakes it into a
 * presigned URL's query string at *presign* time. A presigned PUT is
 * generated before the phone has taken the photo, so the SDK would checksum
 * zero bytes and every real upload would then fail `InvalidDigest` — found
 * and fixed spiking Garage as the object store before this commit.
 */
let client: S3Client | undefined;

export function getS3Client(): S3Client {
  client ??= new S3Client({
    endpoint: envVar("S3_ENDPOINT"),
    region: envVar("S3_REGION"),
    credentials: {
      accessKeyId: envVar("S3_ACCESS_KEY"),
      secretAccessKey: envVar("S3_SECRET_KEY"),
    },
    forcePathStyle: true,
    requestChecksumCalculation: "WHEN_REQUIRED",
  });
  return client;
}

/** Where an uploaded object is reachable once it lands — `draftImageSchema.url`. */
export function publicUrlFor(key: string): string {
  return `${envVar("S3_PUBLIC_URL")}/${key}`;
}
