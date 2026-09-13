import { deletePendingPhoto, listPendingPhotos } from "@/lib/capture/offline-store";
import { uploadPhoto } from "@/lib/capture/upload-photo";

import {
  deleteQueuedDraft,
  listQueuedDrafts,
  saveQueuedDraft,
  type QueuedPhoto,
} from "./offline-queue";
import { buildIntakeRequest, IntakeRequestError, postIntake } from "./submit-draft";
import type { IntakeImage } from "./request";

/**
 * Drains `offline-queue.ts` on reconnect. This is where the two offline
 * stores meet: a queued draft may still be carrying `{ status: "pending" }`
 * photos whose bytes live in `capture/offline-store.ts` — captured in
 * airplane mode, never uploaded — so every draft gets its photos resolved
 * (retrying the upload) before the draft itself is posted.
 */

export interface FlushResult {
  /** Draft ids that reached Shopify's queue this run. */
  submitted: string[];
  /** Genuine rejections (validation, server error) — not a connectivity problem, won't be retried. */
  failed: { scanId: string; message: string }[];
  /** Still queued after this run — no connection yet, or a photo still won't upload. */
  remaining: number;
}

async function resolvePhoto(photo: QueuedPhoto): Promise<QueuedPhoto> {
  if (photo.status === "uploaded") return photo;

  const pending = await listPendingPhotos();
  const stored = pending.find((entry) => entry.id === photo.localId);
  if (stored === undefined) return photo;

  try {
    const { key, publicUrl } = await uploadPhoto(stored.blob);
    await deletePendingPhoto(photo.localId).catch(() => {});
    return {
      status: "uploaded",
      key,
      url: publicUrl,
      width: stored.width,
      height: stored.height,
      bytes: stored.blob.size,
    };
  } catch {
    return photo;
  }
}

function isUploaded(photo: QueuedPhoto): photo is Extract<QueuedPhoto, { status: "uploaded" }> {
  return photo.status === "uploaded";
}

let flushing = false;

/** Safe to call repeatedly (an `online` listener, a mount effect) — only one run happens at a time. */
export async function flushOfflineQueue(): Promise<FlushResult> {
  if (flushing) return { submitted: [], failed: [], remaining: (await listQueuedDrafts()).length };
  flushing = true;

  const submitted: string[] = [];
  const failed: { scanId: string; message: string }[] = [];

  try {
    for (const draft of await listQueuedDrafts()) {
      const resolvedPhotos = await Promise.all(draft.photos.map(resolvePhoto));
      const uploaded = resolvedPhotos.filter(isUploaded);

      if (uploaded.length !== resolvedPhotos.length) {
        // At least one photo still won't upload — save progress and try the
        // rest again on the next flush rather than losing what did land.
        await saveQueuedDraft({ ...draft, photos: resolvedPhotos });
        continue;
      }

      const images: IntakeImage[] = uploaded.map(({ key, url, width, height, bytes }) => ({
        key,
        url,
        width,
        height,
        bytes,
      }));

      try {
        const { draftId } = await postIntake(buildIntakeRequest(draft, images));
        await deleteQueuedDraft(draft.scanId);
        submitted.push(draftId);
      } catch (error) {
        if (error instanceof IntakeRequestError) {
          await deleteQueuedDraft(draft.scanId);
          failed.push({ scanId: draft.scanId, message: error.message });
        }
        // A network error here means still offline — leave it queued.
      }
    }
  } finally {
    flushing = false;
  }

  return { submitted, failed, remaining: (await listQueuedDrafts()).length };
}
