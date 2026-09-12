import type { Collection } from "mongodb";

import type { ProductMirror } from "@/lib/db/schemas/products-mirror";

import { toMirrorDocuments, type MirrorContext } from "./mapping";
import type { CatalogProduct } from "./types";

/**
 * Writing the mirror.
 *
 * Two callers: the webhook route, one product at a time, and the bulk backfill,
 * the whole catalogue at once. Both go through `upsertCatalogProduct` so the
 * ordering guard below cannot be implemented in one and forgotten in the other —
 * a backfill that takes four minutes *will* overlap a webhook.
 */

/** Mongo's duplicate-key error. */
const DUPLICATE_KEY = 11000;

function isDuplicateKey(error: unknown): boolean {
  return (error as { code?: number } | null)?.code === DUPLICATE_KEY;
}

/**
 * Upserts one variant document, unless what is already there is newer.
 *
 * The filter carries `updatedAtShopify: { $lte: … }` as well as the variant id,
 * so a stale write matches nothing. Mongo then tries to *insert* — an upsert
 * whose filter misses always does — and the unique index on `shopifyVariantId`
 * rejects it with a duplicate key. Catching that is the whole mechanism: the
 * write is dropped, which is exactly what should happen to an out-of-order
 * update, and it costs one round trip rather than a read-then-write.
 */
async function upsertVariant(
  collection: Collection<ProductMirror>,
  document: ProductMirror,
): Promise<"written" | "stale"> {
  try {
    await collection.updateOne(
      {
        shopifyVariantId: document.shopifyVariantId,
        updatedAtShopify: { $lte: document.updatedAtShopify },
      },
      { $set: document },
      { upsert: true },
    );
    return "written";
  } catch (error) {
    if (isDuplicateKey(error)) return "stale";
    throw error;
  }
}

export interface MirrorWriteResult {
  productId: string;
  written: number;
  /** Dropped because the stored document was newer. */
  stale: number;
  /** Variants that no longer exist on the product. */
  removed: number;
}

/** How many variants are written concurrently. Small: Mongo here is one node. */
const WRITE_CONCURRENCY = 25;

async function inChunks<T, R>(
  items: readonly T[],
  size: number,
  run: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  for (let index = 0; index < items.length; index += size) {
    results.push(...(await Promise.all(items.slice(index, index + size).map(run))));
  }
  return results;
}

/**
 * Brings the mirror in line with one product as Shopify just described it.
 *
 * Variants that have gone are deleted rather than left behind: a variant
 * removed in the admin would otherwise keep answering scans for a barcode that
 * no longer sells anything, and the scan screen would offer a count against an
 * inventory item that does not exist.
 */
export async function upsertCatalogProduct(
  collection: Collection<ProductMirror>,
  product: CatalogProduct,
  context: MirrorContext,
  syncedAt: Date = new Date(),
): Promise<MirrorWriteResult> {
  const documents = toMirrorDocuments(product, context, syncedAt);

  const outcomes = await inChunks(documents, WRITE_CONCURRENCY, (document) =>
    upsertVariant(collection, document),
  );

  const removal = await collection.deleteMany({
    shopifyProductId: product.id,
    shopifyVariantId: { $nin: documents.map((document) => document.shopifyVariantId) },
  });

  return {
    productId: product.id,
    written: outcomes.filter((outcome) => outcome === "written").length,
    stale: outcomes.filter((outcome) => outcome === "stale").length,
    removed: removal.deletedCount,
  };
}

/** Every variant of a deleted product. `products/delete` carries only the id. */
export async function deleteMirrorProduct(
  collection: Collection<ProductMirror>,
  productId: string,
): Promise<number> {
  const result = await collection.deleteMany({ shopifyProductId: productId });
  return result.deletedCount;
}

/**
 * Records the new available quantity for an inventory item at our location.
 *
 * Matches nothing when the level is for another location, which is the common
 * case on a multi-location store and is not an error. `updatedAtShopify` is
 * deliberately left alone — it tracks the *product's* revision, and moving it
 * here would make a genuinely newer product update look stale.
 *
 * `tracked` is not touched either. A level event is not proof that Shopify is
 * managing quantities for the item, and the mirror's copy of that flag is for
 * reporting only — the write path re-reads it live before every count
 * (CLAUDE.md §7).
 */
export async function setMirrorInventory(
  collection: Collection<ProductMirror>,
  inventoryItemId: string,
  locationId: string,
  available: number | null,
  syncedAt: Date = new Date(),
): Promise<number> {
  const result = await collection.updateMany(
    { inventoryItemId, locationId },
    { $set: { inventoryQty: available, syncedAt } },
  );
  return result.modifiedCount;
}

/**
 * Drops documents the backfill did not touch.
 *
 * Only safe after a *complete* snapshot: anything older than the run's start is
 * a variant Shopify no longer returns. Called with the run's start time, never
 * with "now".
 */
export async function pruneMirror(
  collection: Collection<ProductMirror>,
  syncedBefore: Date,
): Promise<number> {
  const result = await collection.deleteMany({ syncedAt: { $lt: syncedBefore } });
  return result.deletedCount;
}
