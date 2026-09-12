import { z } from "zod";

import { shopifyRequest, type ShopifyEndpoint } from "../client";

/**
 * Step 3 of the inventory write (BUILD_PLAN §3), and the one CLAUDE.md §8 is
 * about: `compareQuantity` on every call, never `ignoreCompareQuantity`. A POS
 * sale landing between the phone's last read and this call must fail loudly,
 * not overwrite silently.
 *
 * As of API version 2026-04 this mutation requires an idempotency key via the
 * `@idempotent` directive — not an input field, a directive argument on the
 * field itself. `scanId` is already the client-generated idempotency key for
 * the whole inventory path (CLAUDE.md §6, `inventory_events.scanId`), so it is
 * reused here rather than minting a second one: a retry that reaches Shopify
 * with the same `scanId` is deduplicated by Shopify itself, which is what
 * makes it safe for `src/lib/inventory/apply.ts` to re-attempt this call after
 * a crash between the mutation succeeding and our own event being finalised.
 *
 * userErrors carry a `code` here (unlike the plain `UserError` on the other two
 * steps) — `COMPARE_QUANTITY_STALE` / `CHANGE_FROM_QUANTITY_STALE` is the
 * conflict apply.ts turns into a 409, and is not treated as a hard failure the
 * way every other code is.
 *
 * https://shopify.dev/docs/api/admin-graphql/2026-07/mutations/inventorySetQuantities
 */

const QUANTITY_NAME = "available";
const REASON = "correction";

const MUTATION = `
  mutation TallyInventorySetQuantities($input: InventorySetQuantitiesInput!, $idempotencyKey: String!) {
    inventorySetQuantities(input: $input) @idempotent(key: $idempotencyKey) {
      inventoryAdjustmentGroup {
        changes { name delta quantityAfterChange }
      }
      userErrors { code field message }
    }
  }
`;

export const inventorySetQuantitiesUserErrorSchema = z.object({
  code: z.string().nullable(),
  field: z.array(z.string()).nullable(),
  message: z.string(),
});
export type InventorySetQuantitiesUserError = z.infer<typeof inventorySetQuantitiesUserErrorSchema>;

export const setInventoryQuantitiesSchema = z.object({
  inventorySetQuantities: z.object({
    inventoryAdjustmentGroup: z
      .object({
        changes: z.array(
          z.object({
            name: z.string(),
            delta: z.number().int(),
            quantityAfterChange: z.number().int().nullable(),
          }),
        ),
      })
      .nullable(),
    userErrors: z.array(inventorySetQuantitiesUserErrorSchema),
  }),
});

export interface SetInventoryQuantitiesParams {
  inventoryItemId: string;
  locationId: string;
  /** The absolute value to land on — §3's decision tree already resolved "set" vs "add" into this. */
  quantity: number;
  /** What we believe `available` is right now. Shopify rejects the write if it disagrees. */
  compareQuantity: number;
  /** Reused as Shopify's own idempotency key — see the module doc above. */
  idempotencyKey: string;
  endpoint?: ShopifyEndpoint;
  signal?: AbortSignal;
}

export interface SetInventoryQuantitiesResult {
  /** `null` only if Shopify returned no adjustment group at all — treat as unknown, not zero. */
  quantityAfterChange: number | null;
  userErrors: InventorySetQuantitiesUserError[];
}

/** The compare-and-set failed because `available` moved since it was read. Not a hard failure. */
export const STALE_COMPARE_CODES = new Set([
  "COMPARE_QUANTITY_STALE",
  "CHANGE_FROM_QUANTITY_STALE",
]);

/** Shopify says this idempotency key's first attempt did not complete cleanly; retry with a new one. */
export const IDEMPOTENCY_RETRY_CODE = "IDEMPOTENCY_PREVIOUS_ATTEMPT_FAILED";

export async function setInventoryQuantities({
  inventoryItemId,
  locationId,
  quantity,
  compareQuantity,
  idempotencyKey,
  endpoint,
  signal,
}: SetInventoryQuantitiesParams): Promise<SetInventoryQuantitiesResult> {
  const data = await shopifyRequest({
    operation: "TallyInventorySetQuantities",
    query: MUTATION,
    variables: {
      input: {
        name: QUANTITY_NAME,
        reason: REASON,
        quantities: [{ inventoryItemId, locationId, quantity, compareQuantity }],
      },
      idempotencyKey,
    },
    schema: setInventoryQuantitiesSchema,
    endpoint,
    signal,
  });

  const payload = data.inventorySetQuantities;
  const change = payload.inventoryAdjustmentGroup?.changes.find(
    (entry) => entry.name === QUANTITY_NAME,
  );

  return {
    quantityAfterChange: change?.quantityAfterChange ?? null,
    userErrors: payload.userErrors,
  };
}
