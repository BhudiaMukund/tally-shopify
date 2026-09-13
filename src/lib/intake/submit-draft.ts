import type { CapturedPhoto } from "@/lib/capture/use-photo-capture";

import { saveQueuedDraft, type QueuedDraft, type QueuedPhoto } from "./offline-queue";
import type { IntakeImage, IntakeRequest } from "./request";

/**
 * The capture screen's "submit" button, minus any DOM: builds the request,
 * and if the network genuinely isn't there, queues the whole thing instead of
 * throwing. Kept apart from `intake-screen.tsx` so the online/offline branch
 * is testable without mounting a component.
 */

export interface SubmitDraftInput {
  scanId: string;
  kind: "new_product" | "new_variant";
  barcodeRaw: string;
  price: string;
  qty: number;
  deviceId: string;
  vendor?: string;
  productType?: string;
  /** Only meaningful for `kind: "new_product"` — see `offline-queue.ts`. */
  siblingOf?: string;
  /** Only meaningful for `kind: "new_variant"`. */
  parent?: { productId: string; productTitle: string; posOnly: boolean; optionName: string };
  photos: CapturedPhoto[];
}

export type SubmitDraftResult = { outcome: "submitted"; draftId: string } | { outcome: "queued" };

export class IntakeRequestError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "IntakeRequestError";
    this.status = status;
  }
}

function toQueuedPhoto(photo: CapturedPhoto): QueuedPhoto {
  return photo.status === "uploaded" &&
    photo.key !== null &&
    photo.publicUrl !== null &&
    photo.width !== null &&
    photo.height !== null &&
    photo.bytes !== null
    ? {
        status: "uploaded",
        key: photo.key,
        url: photo.publicUrl,
        width: photo.width,
        height: photo.height,
        bytes: photo.bytes,
      }
    : { status: "pending", localId: photo.id };
}

function isUploaded(photo: QueuedPhoto): photo is Extract<QueuedPhoto, { status: "uploaded" }> {
  return photo.status === "uploaded";
}

/** Builds the exact `POST /api/intake` body — shared with the offline-queue flush. */
export function buildIntakeRequest(
  input: Omit<SubmitDraftInput, "photos">,
  images: readonly IntakeImage[],
): IntakeRequest {
  const base = {
    scanId: input.scanId,
    barcodeRaw: input.barcodeRaw,
    price: input.price,
    qty: input.qty,
    images: [...images],
    deviceId: input.deviceId,
  };

  return input.kind === "new_product"
    ? {
        ...base,
        kind: "new_product",
        siblingOf: input.siblingOf,
        vendor: input.vendor,
        productType: input.productType,
      }
    : { ...base, kind: "new_variant", parent: input.parent! };
}

export async function postIntake(body: IntakeRequest): Promise<{ draftId: string }> {
  const response = await fetch("/api/intake", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new IntakeRequestError(
      response.status,
      payload?.message ?? "That product could not be saved.",
    );
  }

  return (await response.json()) as { draftId: string };
}

function toQueuedDraft(input: SubmitDraftInput, photos: QueuedPhoto[]): QueuedDraft {
  return {
    scanId: input.scanId,
    kind: input.kind,
    barcodeRaw: input.barcodeRaw,
    price: input.price,
    qty: input.qty,
    deviceId: input.deviceId,
    vendor: input.vendor,
    productType: input.productType,
    siblingOf: input.siblingOf,
    parent: input.parent,
    photos,
    queuedAt: Date.now(),
  };
}

/**
 * Online and every photo landed: post now. Anything else — no connection, a
 * photo still stuck in the commit-9 offline store, or a `fetch` that throws
 * mid-flight — queues the submission for `flush-offline-queue.ts` to finish
 * later. A genuine server rejection (a validation error, a 500) is not a
 * connectivity problem and is re-thrown for the screen to show.
 */
export async function submitDraft(input: SubmitDraftInput): Promise<SubmitDraftResult> {
  const queuedPhotos = input.photos.map(toQueuedPhoto);
  const uploaded = queuedPhotos.filter(isUploaded);
  const allUploaded = uploaded.length === queuedPhotos.length;

  if (navigator.onLine && allUploaded) {
    try {
      const { draftId } = await postIntake(buildIntakeRequest(input, uploaded));
      return { outcome: "submitted", draftId };
    } catch (error) {
      if (error instanceof IntakeRequestError) throw error;
      // A network error mid-request — fall through and queue it.
    }
  }

  await saveQueuedDraft(toQueuedDraft(input, queuedPhotos));
  return { outcome: "queued" };
}
