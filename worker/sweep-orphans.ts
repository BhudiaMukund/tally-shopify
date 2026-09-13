import { referencedImageKeys } from "@/lib/intake/referenced-image-keys";
import { log } from "@/lib/log";
import { deleteObjects, listAllObjects, type BucketObject } from "@/lib/s3/objects";

/**
 * "Objects in the bucket referenced by no draft after 7 days are deleted"
 * (BUILD_PLAN §11). Photos removed from the capture strip leave their bytes
 * behind by design — deleting on removal would race a draft that still
 * references the key mid-edit — so this sweep is the safe, delayed version.
 */
const ORPHAN_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Pure — no S3 or Mongo calls — so the age/reference logic is testable without either. */
export function findOrphanedKeys(
  objects: readonly BucketObject[],
  referencedKeys: ReadonlySet<string>,
  now: Date = new Date(),
): string[] {
  return objects
    .filter((object) => !referencedKeys.has(object.key))
    .filter((object) => now.getTime() - object.lastModified.getTime() > ORPHAN_AGE_MS)
    .map((object) => object.key);
}

export async function processSweepOrphans(): Promise<void> {
  const [objects, referenced] = await Promise.all([listAllObjects(), referencedImageKeys()]);
  const orphaned = findOrphanedKeys(objects, referenced);

  if (orphaned.length > 0) await deleteObjects(orphaned);

  log.info("sweep_orphans.completed", {
    scanned: objects.length,
    referenced: referenced.size,
    deleted: orphaned.length,
    // A few keys for a spot-check — thousands on one log line helps no one.
    sample: orphaned.slice(0, 10),
  });
}
