import { z } from "zod";

import { shopifyRequest, type ShopifyEndpoint } from "../client";

/**
 * A fresh, narrow read of one variant immediately before an inventory write.
 *
 * The scan screen's own state is moments old by the time someone taps "Update
 * stock" — CLAUDE.md §1 says never write based on the mirror, and that applies
 * here too: whether the item is tracked and whether it already has a level at
 * our location must come from Shopify right now, not from what `/api/lookup`
 * answered a few seconds ago. This is deliberately narrower than
 * `catalog-fields.ts` — no product, no options, no publications — because it
 * runs on the 600ms inventory-write budget, not the lookup's.
 *
 * https://shopify.dev/docs/api/admin-graphql/2026-07/queries/productVariant
 * https://shopify.dev/docs/api/admin-graphql/2026-07/objects/InventoryItem
 */

const QUERY = `
  query TallyGetVariantForInventory($id: ID!, $locationId: ID!) {
    productVariant(id: $id) {
      id
      inventoryItem {
        id
        tracked
        inventoryLevel(locationId: $locationId) {
          quantities(names: ["available"]) { name quantity }
        }
      }
    }
  }
`;

const quantitySchema = z.object({ name: z.string(), quantity: z.number().int() });

export const getVariantForInventorySchema = z.object({
  productVariant: z
    .object({
      id: z.string(),
      inventoryItem: z.object({
        id: z.string(),
        tracked: z.boolean(),
        inventoryLevel: z
          .object({ quantities: z.array(quantitySchema) })
          .nullable()
          .optional(),
      }),
    })
    .nullable(),
});

export interface VariantInventoryState {
  variantId: string;
  inventoryItemId: string;
  tracked: boolean;
  /** `null` means no inventory level at our location at all — not activated yet. */
  availableAtLocation: number | null;
}

export interface GetVariantForInventoryOptions {
  locationId: string;
  endpoint?: ShopifyEndpoint;
  signal?: AbortSignal;
}

/** Returns `null` when the variant has been deleted since the scan screen read it. */
export async function getVariantForInventory(
  variantId: string,
  { locationId, endpoint, signal }: GetVariantForInventoryOptions,
): Promise<VariantInventoryState | null> {
  const data = await shopifyRequest({
    operation: "TallyGetVariantForInventory",
    query: QUERY,
    variables: { id: variantId, locationId },
    schema: getVariantForInventorySchema,
    endpoint,
    signal,
  });

  const node = data.productVariant;
  if (node === null) return null;

  const level = node.inventoryItem.inventoryLevel;
  const availableAtLocation =
    level === null || level === undefined
      ? null
      : (level.quantities.find((entry) => entry.name === "available")?.quantity ?? null);

  return {
    variantId: node.id,
    inventoryItemId: node.inventoryItem.id,
    tracked: node.inventoryItem.tracked,
    availableAtLocation,
  };
}
