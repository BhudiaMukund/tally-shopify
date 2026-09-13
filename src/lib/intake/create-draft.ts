import { ObjectId, type WithId } from "mongodb";

import { normaliseBarcode } from "@/lib/barcode";
import { getCollections } from "@/lib/db/collections";
import type { Draft } from "@/lib/db/schemas/drafts";
import { errorMessage, log } from "@/lib/log";
import { enqueueEnrichment } from "@/lib/queue/enrich-queue";

import type { IntakeRequest } from "./request";

/**
 * Turns a validated intake request into a `drafts` document.
 *
 * Idempotent on `scanId` (the unique index in `src/lib/db/indexes.ts` is what
 * makes this safe): a resubmitted capture — the offline queue retrying after
 * a partial success, or a double-tap — returns the draft that already exists
 * rather than creating a second one or throwing.
 */

export interface CreateDraftResult {
  draft: WithId<Draft>;
  /** False on an idempotent replay — the caller should not re-toast "captured". */
  created: boolean;
}

/**
 * Whether the parent's only variant is still `Default Title` — §3's "fiddly
 * case", which has to rename that variant rather than silently leaving it
 * behind. Read from the mirror rather than trusted from the client: the
 * client's own `parentOptionNames` reflects what the scan screen last saw,
 * and this is a live-product mutation waiting to happen, worth one more read
 * to get right.
 */
async function existingVariantNeedsValue(productId: string): Promise<boolean> {
  const { productsMirror } = await getCollections();
  const row = await productsMirror.findOne({ shopifyProductId: productId });
  return row !== null && row.optionNames.length === 0;
}

export async function createDraft(
  input: IntakeRequest,
  userId: ObjectId,
): Promise<CreateDraftResult> {
  const { drafts } = await getCollections();

  const existing = await drafts.findOne({ scanId: input.scanId });
  if (existing !== null) return { draft: existing, created: false };

  const normalised = normaliseBarcode(input.barcodeRaw);
  const now = new Date();

  const images = input.images.map((image, order) => ({ ...image, order }));
  const counts = [{ scanId: input.scanId, qty: input.qty, by: userId, at: now }];

  const doc: Draft =
    input.kind === "new_product"
      ? {
          kind: "new_product",
          scanId: input.scanId,
          barcode: normalised.digits,
          barcodeRaw: normalised.raw,
          labelPrinted: false,
          price: input.price,
          images,
          counts,
          siblingOf: input.siblingOf !== undefined ? new ObjectId(input.siblingOf) : undefined,
          capturedBy: userId,
          capturedAt: now,
          deviceId: input.deviceId,
          status: "queued",
          // A staff quick-pick is an edit, not an AI finding — it goes to
          // `edits.*` even before `ai.*` exists, so the publish-time merge
          // has nothing extra to reconcile later.
          edits:
            input.vendor !== undefined || input.productType !== undefined
              ? { vendor: input.vendor, productType: input.productType }
              : undefined,
          attempts: 0,
          updatedAt: now,
        }
      : {
          kind: "new_variant",
          parent: {
            productId: input.parent.productId,
            productTitle: input.parent.productTitle,
            posOnly: input.parent.posOnly,
            optionName: input.parent.optionName,
            optionValue: null,
            existingVariantNeedsValue: await existingVariantNeedsValue(input.parent.productId),
          },
          scanId: input.scanId,
          barcode: normalised.digits,
          barcodeRaw: normalised.raw,
          labelPrinted: false,
          price: input.price,
          images,
          counts,
          capturedBy: userId,
          capturedAt: now,
          deviceId: input.deviceId,
          status: "queued",
          attempts: 0,
          updatedAt: now,
        };

  const { insertedId } = await drafts.insertOne(doc);

  // The draft already exists in Mongo at this point — a Redis blip must not
  // turn into a failed `POST /api/intake` and a phone that thinks nothing was
  // captured. Log loudly instead: a `queued` draft with no job behind it is
  // exactly what commit 11's dead-letter handling and commit 13's "flag
  // anything over three days" exist to catch, not something this route
  // should retry itself.
  try {
    await enqueueEnrichment(insertedId.toHexString());
  } catch (error) {
    log.error("intake.enqueue_failed", {
      draftId: insertedId.toHexString(),
      scanId: input.scanId,
      message: errorMessage(error),
    });
  }

  return { draft: { ...doc, _id: insertedId }, created: true };
}
