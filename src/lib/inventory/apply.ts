import type { ObjectId } from "mongodb";
import { z } from "zod";

import { normaliseBarcode } from "@/lib/barcode";
import { getCollections } from "@/lib/db/collections";
import { gid, scanId as scanIdSchema } from "@/lib/db/schemas/common";
import { inventoryMode, type InventoryEventStatus } from "@/lib/db/schemas/inventory-events";
import { envVar } from "@/lib/env";
import { errorMessage, log } from "@/lib/log";
import { activateInventoryAtLocation } from "@/lib/shopify/operations/activate-inventory";
import { ensureInventoryTracked } from "@/lib/shopify/operations/ensure-inventory-tracked";
import { getVariantForInventory } from "@/lib/shopify/operations/get-variant-for-inventory";
import {
  IDEMPOTENCY_RETRY_CODE,
  setInventoryQuantities,
  STALE_COMPARE_CODES,
} from "@/lib/shopify/operations/set-inventory-quantities";

/**
 * The stocktake write, straight to Shopify (BUILD_PLAN §3, "Inventory write —
 * the exact sequence"). Everything here runs synchronously inside
 * `POST /api/inventory` — no queue, no admin review (CLAUDE.md §6).
 *
 * The idempotency story has two layers. `inventory_events.scanId` (unique
 * index) is ours: a row already marked `applied` or `conflict` is returned
 * without touching Shopify again. `scanId` is *also* passed to
 * `inventorySetQuantities` as Shopify's own `@idempotent` key, which is what
 * makes it safe to re-attempt the Shopify call itself for a `pending` row —
 * one our process crashed while finishing — since Shopify deduplicates on
 * that key rather than applying the count twice.
 */

export const inventoryWriteRequestSchema = z.object({
  scanId: scanIdSchema,
  barcode: z.string().min(1),
  variantId: gid("ProductVariant"),
  mode: inventoryMode,
  value: z.number().int(),
  /** What the phone last saw as `available`. Null only when the item has never been stocked here. */
  compareQuantity: z.number().int().nullable(),
  ambiguousBarcode: z.boolean().default(false),
  chosenFrom: z.array(gid("ProductVariant")).default([]),
});
export type InventoryWriteRequest = z.infer<typeof inventoryWriteRequestSchema>;

export type InventoryWriteResult =
  | { status: "applied"; eventId: string; before: number | null; after: number; delta: number }
  | { status: "conflict"; message: string; current: number | null }
  | { status: "not_found"; message: string }
  | { status: "failed"; message: string };

/** Every code that means "the earlier attempt genuinely never landed, try once more." */
const RETRYABLE_IDEMPOTENCY_CODES = new Set([IDEMPOTENCY_RETRY_CODE]);

async function finalize(
  scanId: string,
  status: InventoryEventStatus,
  fields: { after?: number; delta?: number; error?: string },
): Promise<void> {
  const { inventoryEvents } = await getCollections();
  await inventoryEvents.updateOne(
    { scanId },
    {
      $set: {
        status,
        completedAt: new Date(),
        ...(fields.after !== undefined ? { after: fields.after } : {}),
        ...(fields.delta !== undefined ? { delta: fields.delta } : {}),
        ...(fields.error !== undefined ? { error: fields.error } : {}),
      },
    },
  );
}

/**
 * Runs `inventorySetQuantities`, retrying once with a suffixed idempotency key
 * if Shopify reports the first key's attempt failed outright — otherwise a
 * write could get permanently stuck retrying a key Shopify has already
 * discarded (CLAUDE.md §13 doc check on `inventorySetQuantities` surfaced this;
 * see the operation's module doc).
 */
async function setQuantitiesWithRetry(params: {
  inventoryItemId: string;
  locationId: string;
  quantity: number;
  compareQuantity: number;
  idempotencyKey: string;
}) {
  const first = await setInventoryQuantities(params);
  const needsRetry = first.userErrors.some((error) =>
    RETRYABLE_IDEMPOTENCY_CODES.has(error.code ?? ""),
  );
  if (!needsRetry) return first;

  return setInventoryQuantities({ ...params, idempotencyKey: `${params.idempotencyKey}:retry` });
}

/**
 * Applies one stocktake count. Never throws — every failure mode, expected or
 * not, comes back as a typed result so the route handler has one place to
 * decide the HTTP status.
 */
export async function applyInventoryWrite(
  request: InventoryWriteRequest,
  actor: ObjectId,
): Promise<InventoryWriteResult> {
  const { inventoryEvents } = await getCollections();
  const locationId = envVar("SHOPIFY_LOCATION_ID");
  const barcodeDigits = normaliseBarcode(request.barcode).digits;

  const existing = await inventoryEvents.findOne({ scanId: request.scanId });

  if (existing?.status === "applied") {
    return {
      status: "applied",
      eventId: existing._id.toHexString(),
      before: existing.before,
      after: existing.after ?? 0,
      delta: existing.delta ?? 0,
    };
  }
  if (existing?.status === "conflict") {
    return {
      status: "conflict",
      message: "This count was already flagged as changed while counting. Scan again to recount.",
      current: null,
    };
  }

  let variant;
  try {
    variant = await getVariantForInventory(request.variantId, { locationId });
  } catch (error) {
    log.error("inventory.pre_read_failed", {
      scanId: request.scanId,
      message: errorMessage(error),
    });
    return { status: "failed", message: "Could not read this item from Shopify. Try again." };
  }

  if (variant === null) {
    return { status: "not_found", message: "This item no longer exists in Shopify." };
  }

  const justActivated = variant.availableAtLocation === null;

  if (!justActivated && request.compareQuantity === null) {
    return {
      status: "failed",
      message:
        "This item is already tracked — rescan so the count has something to compare against.",
    };
  }

  // The row an earlier attempt left behind, if any: `before` and the other
  // intent fields must never change between attempts under the same scanId.
  const before = justActivated ? null : request.compareQuantity;

  if (existing === null) {
    await inventoryEvents.insertOne({
      scanId: request.scanId,
      barcode: barcodeDigits,
      variantId: request.variantId,
      inventoryItemId: variant.inventoryItemId,
      locationId,
      ambiguousBarcode: request.ambiguousBarcode,
      chosenFrom: request.chosenFrom,
      before,
      after: null,
      delta: null,
      mode: request.mode,
      actor,
      source: "scan",
      status: "pending",
      createdAt: new Date(),
    });
  }

  const effectiveCompare = justActivated ? 0 : (request.compareQuantity as number);
  const quantity = request.mode === "set" ? request.value : effectiveCompare + request.value;

  if (quantity < 0) {
    await finalize(request.scanId, "failed", {
      error: "The resulting quantity would be negative.",
    });
    return { status: "failed", message: "That count would take stock below zero." };
  }

  try {
    if (!variant.tracked) await ensureInventoryTracked(variant.inventoryItemId);
    if (justActivated) {
      await activateInventoryAtLocation({ inventoryItemId: variant.inventoryItemId, locationId });
    }

    const result = await setQuantitiesWithRetry({
      inventoryItemId: variant.inventoryItemId,
      locationId,
      quantity,
      compareQuantity: effectiveCompare,
      idempotencyKey: request.scanId,
    });

    const staleError = result.userErrors.find((error) => STALE_COMPARE_CODES.has(error.code ?? ""));
    if (staleError !== undefined) {
      const fresh = await getVariantForInventory(request.variantId, { locationId }).catch(
        () => null,
      );
      await finalize(request.scanId, "conflict", { error: staleError.message });
      return {
        status: "conflict",
        message: "Stock changed while you were counting.",
        current: fresh?.availableAtLocation ?? null,
      };
    }

    if (result.userErrors.length > 0) {
      const message = result.userErrors.map((error) => error.message).join("; ");
      // Unlike the exception path below, this is Shopify answering cleanly —
      // nothing throws, so without this the only trace of a 422 was the
      // route's own `status: "failed"` line, with no way to tell a rejected
      // quantity from a stale idempotency key from an item Shopify refuses to
      // adjust at all. That gap is exactly what made this hard to diagnose.
      log.warn("inventory.rejected", {
        scanId: request.scanId,
        variantId: request.variantId,
        codes: result.userErrors.map((error) => error.code ?? "(none)"),
        message,
      });
      await finalize(request.scanId, "failed", { error: message });
      return { status: "failed", message };
    }

    const after = result.quantityAfterChange ?? quantity;
    const delta = after - (before ?? 0);
    await finalize(request.scanId, "applied", { after, delta });

    const saved = await inventoryEvents.findOne({ scanId: request.scanId });
    return { status: "applied", eventId: saved?._id.toHexString() ?? "", before, after, delta };
  } catch (error) {
    log.error("inventory.write_failed", { scanId: request.scanId, message: errorMessage(error) });
    await finalize(request.scanId, "failed", { error: errorMessage(error) }).catch(() => {});
    return { status: "failed", message: "Updating Shopify failed. Try again." };
  }
}
