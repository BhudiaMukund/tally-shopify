import {
  DeleteObjectsCommand,
  HeadBucketCommand,
  paginateListObjectsV2,
  type S3Client,
} from "@aws-sdk/client-s3";

import { envVar } from "@/lib/env";

import { getS3Client } from "./client";

/**
 * Listing and deleting objects — `src/lib/s3/uploads.ts` only signs uploads,
 * nothing before this reads the bucket back. Built for `sweep-orphans`
 * (BUILD_PLAN §11) and `/api/health`'s Garage reachability check.
 */

export interface BucketObject {
  key: string;
  lastModified: Date;
}

/** Every object in the bucket, paginated. Not filtered — the caller decides what's referenced. */
export async function listAllObjects({
  s3 = getS3Client(),
  bucket = envVar("S3_BUCKET"),
}: { s3?: S3Client; bucket?: string } = {}): Promise<BucketObject[]> {
  const objects: BucketObject[] = [];

  for await (const page of paginateListObjectsV2({ client: s3 }, { Bucket: bucket })) {
    for (const object of page.Contents ?? []) {
      if (object.Key === undefined || object.LastModified === undefined) continue;
      objects.push({ key: object.Key, lastModified: object.LastModified });
    }
  }

  return objects;
}

/** S3's own limit on one `DeleteObjects` call. */
const DELETE_BATCH_SIZE = 1000;

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

/** Deletes every key given, batched under S3's per-call limit. A no-op on an empty list. */
export async function deleteObjects(
  keys: readonly string[],
  { s3 = getS3Client(), bucket = envVar("S3_BUCKET") }: { s3?: S3Client; bucket?: string } = {},
): Promise<void> {
  for (const batch of chunk(keys, DELETE_BATCH_SIZE)) {
    if (batch.length === 0) continue;
    await s3.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: batch.map((key) => ({ Key: key })), Quiet: true },
      }),
    );
  }
}

/** Reachability only — `/api/health`'s Garage check. Throws if the bucket isn't reachable. */
export async function checkBucketReachable({
  s3 = getS3Client(),
  bucket = envVar("S3_BUCKET"),
}: { s3?: S3Client; bucket?: string } = {}): Promise<void> {
  await s3.send(new HeadBucketCommand({ Bucket: bucket }));
}
