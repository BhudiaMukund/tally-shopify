import { z } from "zod";

import { shopifyRequest, type ShopifyEndpoint } from "../client";
import { assertNoUserErrors } from "../errors";

/**
 * Step 1 of the inventory write (BUILD_PLAN §3): almost nothing in this
 * catalogue has `inventoryItem.tracked = true` yet, and setting a quantity on
 * an untracked item fails outright. The caller only invokes this when a fresh
 * read (`get-variant-for-inventory.ts`) says `tracked` is still false — the
 * mutation itself is naturally idempotent (setting `tracked: true` on an
 * already-tracked item is a harmless no-op), but skipping the call entirely
 * when we already know the answer saves a round trip on the 600ms budget.
 *
 * https://shopify.dev/docs/api/admin-graphql/2026-07/mutations/inventoryItemUpdate
 */

const MUTATION = `
  mutation TallyEnsureInventoryTracked($id: ID!, $input: InventoryItemInput!) {
    inventoryItemUpdate(id: $id, input: $input) {
      inventoryItem { id tracked }
      userErrors { field message }
    }
  }
`;

export const ensureInventoryTrackedSchema = z.object({
  inventoryItemUpdate: z.object({
    inventoryItem: z.object({ id: z.string(), tracked: z.boolean() }).nullable(),
    userErrors: z.array(z.object({ field: z.array(z.string()).nullable(), message: z.string() })),
  }),
});

export async function ensureInventoryTracked(
  inventoryItemId: string,
  endpoint?: ShopifyEndpoint,
): Promise<void> {
  const data = await shopifyRequest({
    operation: "TallyEnsureInventoryTracked",
    query: MUTATION,
    variables: { id: inventoryItemId, input: { tracked: true } },
    schema: ensureInventoryTrackedSchema,
    endpoint,
  });

  assertNoUserErrors("inventoryItemUpdate", data.inventoryItemUpdate);
}
