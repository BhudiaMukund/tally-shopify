import { z } from "zod";

import { shopifyRequest, type ShopifyEndpoint } from "../client";
import { assertNoUserErrors } from "../errors";

/**
 * Step 2 of the inventory write (BUILD_PLAN §3): create the inventory level at
 * our location. Only called when a fresh read says the item has none yet —
 * `inventoryActivate` on a location that already has a level for this item is
 * not the no-op `inventoryItemUpdate` is, so the caller must gate this one.
 *
 * `available` and `onHand` are both pinned to 0 rather than left unset: the
 * item had no level a moment ago, so 0 is the only quantity that is true right
 * now, and passing it explicitly gives the very next `inventorySetQuantities`
 * call a known, deterministic `compareQuantity` instead of one inferred from a
 * field Shopify might otherwise leave null.
 *
 * https://shopify.dev/docs/api/admin-graphql/2026-07/mutations/inventoryActivate
 */

const MUTATION = `
  mutation TallyInventoryActivate($inventoryItemId: ID!, $locationId: ID!, $available: Int, $onHand: Int) {
    inventoryActivate(
      inventoryItemId: $inventoryItemId
      locationId: $locationId
      available: $available
      onHand: $onHand
    ) {
      inventoryLevel { id }
      userErrors { field message }
    }
  }
`;

export const activateInventorySchema = z.object({
  inventoryActivate: z.object({
    inventoryLevel: z.object({ id: z.string() }).nullable(),
    userErrors: z.array(z.object({ field: z.array(z.string()).nullable(), message: z.string() })),
  }),
});

export interface ActivateInventoryOptions {
  inventoryItemId: string;
  locationId: string;
  endpoint?: ShopifyEndpoint;
}

export async function activateInventoryAtLocation({
  inventoryItemId,
  locationId,
  endpoint,
}: ActivateInventoryOptions): Promise<void> {
  const data = await shopifyRequest({
    operation: "TallyInventoryActivate",
    query: MUTATION,
    variables: { inventoryItemId, locationId, available: 0, onHand: 0 },
    schema: activateInventorySchema,
    endpoint,
  });

  assertNoUserErrors("inventoryActivate", data.inventoryActivate);
}
