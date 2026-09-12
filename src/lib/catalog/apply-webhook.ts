import { productsMirror } from "@/lib/db/collections";
import { getDb } from "@/lib/db/client";
import { envVar } from "@/lib/env";
import { getCatalogProduct } from "@/lib/shopify/operations/get-catalog-product";
import {
  inventoryLevelWebhookSchema,
  productWebhookSchema,
  toGid,
  type WebhookTopic,
} from "@/lib/shopify/webhooks";

import {
  deleteMirrorProduct,
  setMirrorInventory,
  upsertCatalogProduct,
  type MirrorWriteResult,
} from "./mirror";

/**
 * What each verified webhook does to the mirror.
 *
 * Separated from the route so it can be driven directly by a script or a test:
 * everything above it is HTTP and signatures, everything below it is Mongo.
 */

export type WebhookOutcome =
  | ({ action: "upserted" } & MirrorWriteResult)
  | { action: "deleted"; productId: string; removed: number }
  | { action: "inventory"; inventoryItemId: string; available: number | null; updated: number }
  | { action: "ignored"; reason: string };

function context() {
  return {
    locationId: envVar("SHOPIFY_LOCATION_ID"),
    posPublicationId: envVar("SHOPIFY_POS_PUBLICATION_ID"),
  };
}

export async function applyWebhook(topic: WebhookTopic, payload: unknown): Promise<WebhookOutcome> {
  const collection = productsMirror(await getDb());

  if (topic === "inventory_levels/update") {
    const level = inventoryLevelWebhookSchema.parse(payload);
    const { locationId } = context();
    const inventoryItemId = toGid("InventoryItem", level.inventory_item_id);

    // A store with a second location sends these too. Tally has exactly one
    // location and never lets one be chosen in the UI, so the rest are noise.
    if (toGid("Location", level.location_id) !== locationId) {
      return { action: "ignored", reason: "other-location" };
    }

    const updated = await setMirrorInventory(
      collection,
      inventoryItemId,
      locationId,
      level.available ?? null,
    );
    return { action: "inventory", inventoryItemId, available: level.available ?? null, updated };
  }

  const product = productWebhookSchema.parse(payload);
  const productId = product.admin_graphql_api_id ?? toGid("Product", product.id);

  if (topic === "products/delete") {
    return {
      action: "deleted",
      productId,
      removed: await deleteMirrorProduct(collection, productId),
    };
  }

  // create and update are the same job: ask Shopify what the product is now and
  // write that. The payload is a notification, not a source (CLAUDE.md §1).
  const fresh = await getCatalogProduct(productId, { locationId: context().locationId });
  if (fresh === null) {
    // An update that lost a race with a delete. Leaving the rows would keep a
    // dead barcode answering scans.
    return {
      action: "deleted",
      productId,
      removed: await deleteMirrorProduct(collection, productId),
    };
  }

  return { action: "upserted", ...(await upsertCatalogProduct(collection, fresh, context())) };
}
