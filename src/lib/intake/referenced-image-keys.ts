import { getCollections } from "@/lib/db/collections";

/**
 * Every S3 key any draft still references, regardless of status. A published
 * or rejected draft's document is never deleted, so its `images[]` stay a
 * live reference forever — `sweep-orphans` (BUILD_PLAN §11) has to check
 * against all of them, not just the ones still in review.
 *
 * No index covers `images.key` (`src/lib/db/indexes.ts`) — this is a
 * projection-only scan, acceptable for a maintenance job that isn't the hot
 * path and runs once a day.
 */
export async function referencedImageKeys(): Promise<Set<string>> {
  const { drafts } = await getCollections();
  const cursor = drafts.find({}, { projection: { images: 1 } });

  const keys = new Set<string>();
  for await (const doc of cursor) {
    for (const image of doc.images) keys.add(image.key);
  }
  return keys;
}
