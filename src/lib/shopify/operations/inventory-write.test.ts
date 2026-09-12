import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeShopifyClient, type ShopifyEndpoint } from "../client";
import { ShopifyUserError } from "../errors";
import { activateInventoryAtLocation } from "./activate-inventory";
import { ensureInventoryTracked } from "./ensure-inventory-tracked";
import { getVariantForInventory } from "./get-variant-for-inventory";
import { setInventoryQuantities, STALE_COMPARE_CODES } from "./set-inventory-quantities";

/**
 * The three-step write from BUILD_PLAN §3, against a fake Shopify — the one
 * thing worth locking in here is that a stale `compareQuantity` comes back
 * distinguishable from every other userError, since that is the difference
 * between a 409 conflict and a hard failure in `src/lib/inventory/apply.ts`.
 */

const LOCATION = "gid://shopify/Location/111";
const ITEM = "gid://shopify/InventoryItem/1";
const VARIANT = "gid://shopify/ProductVariant/1";

let server: Server;
let endpoint: ShopifyEndpoint;
let nextBody: unknown = { data: {} };
let lastVariables: Record<string, unknown> = {};
let lastQuery = "";

beforeAll(async () => {
  server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
        query: string;
        variables: Record<string, unknown>;
      };
      lastVariables = body.variables;
      lastQuery = body.query;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(nextBody));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  endpoint = {
    storeDomain: "example-store.myshopify.com",
    apiVersion: "2026-07",
    adminToken: "shpat_not-a-real-token",
    baseUrl: `http://127.0.0.1:${port}`,
  };
});

afterAll(async () => {
  await closeShopifyClient();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("getVariantForInventory", () => {
  it("reports no level at our location as null, not zero", async () => {
    nextBody = {
      data: {
        productVariant: {
          id: VARIANT,
          inventoryItem: { id: ITEM, tracked: false, inventoryLevel: null },
        },
      },
    };

    const state = await getVariantForInventory(VARIANT, { locationId: LOCATION, endpoint });
    expect(state).toEqual({
      variantId: VARIANT,
      inventoryItemId: ITEM,
      tracked: false,
      availableAtLocation: null,
    });
    expect(lastVariables.locationId).toBe(LOCATION);
  });

  it("reads the available quantity when a level exists", async () => {
    nextBody = {
      data: {
        productVariant: {
          id: VARIANT,
          inventoryItem: {
            id: ITEM,
            tracked: true,
            inventoryLevel: { quantities: [{ name: "available", quantity: 24 }] },
          },
        },
      },
    };

    const state = await getVariantForInventory(VARIANT, { locationId: LOCATION, endpoint });
    expect(state?.availableAtLocation).toBe(24);
    expect(state?.tracked).toBe(true);
  });

  it("returns null for a variant Shopify no longer has", async () => {
    nextBody = { data: { productVariant: null } };
    await expect(
      getVariantForInventory(VARIANT, { locationId: LOCATION, endpoint }),
    ).resolves.toBeNull();
  });
});

describe("ensureInventoryTracked", () => {
  it("sends tracked: true and resolves on success", async () => {
    nextBody = {
      data: {
        inventoryItemUpdate: {
          inventoryItem: { id: ITEM, tracked: true },
          userErrors: [],
        },
      },
    };

    await expect(ensureInventoryTracked(ITEM, endpoint)).resolves.toBeUndefined();
    expect(lastVariables.id).toBe(ITEM);
    expect(lastVariables.input).toEqual({ tracked: true });
  });

  it("throws ShopifyUserError on a userError rather than swallowing it", async () => {
    nextBody = {
      data: {
        inventoryItemUpdate: {
          inventoryItem: null,
          userErrors: [{ field: ["id"], message: "Inventory item not found" }],
        },
      },
    };

    await expect(ensureInventoryTracked(ITEM, endpoint)).rejects.toBeInstanceOf(ShopifyUserError);
  });
});

describe("activateInventoryAtLocation", () => {
  it("activates at available: 0, onHand: 0 for a deterministic baseline", async () => {
    nextBody = {
      data: {
        inventoryActivate: {
          inventoryLevel: { id: "gid://shopify/InventoryLevel/1" },
          userErrors: [],
        },
      },
    };

    await activateInventoryAtLocation({ inventoryItemId: ITEM, locationId: LOCATION, endpoint });
    expect(lastVariables).toMatchObject({
      inventoryItemId: ITEM,
      locationId: LOCATION,
      available: 0,
      onHand: 0,
    });
  });

  it("throws ShopifyUserError on a userError", async () => {
    nextBody = {
      data: {
        inventoryActivate: {
          inventoryLevel: null,
          userErrors: [{ field: null, message: "Already active at this location" }],
        },
      },
    };

    await expect(
      activateInventoryAtLocation({ inventoryItemId: ITEM, locationId: LOCATION, endpoint }),
    ).rejects.toBeInstanceOf(ShopifyUserError);
  });
});

describe("setInventoryQuantities", () => {
  it("sends compareQuantity on every call and never ignoreCompareQuantity", async () => {
    nextBody = {
      data: {
        inventorySetQuantities: {
          inventoryAdjustmentGroup: {
            changes: [{ name: "available", delta: 6, quantityAfterChange: 30 }],
          },
          userErrors: [],
        },
      },
    };

    const result = await setInventoryQuantities({
      inventoryItemId: ITEM,
      locationId: LOCATION,
      quantity: 30,
      compareQuantity: 24,
      idempotencyKey: "11111111-1111-1111-1111-111111111111",
      endpoint,
    });

    expect(result).toEqual({ quantityAfterChange: 30, userErrors: [] });
    const input = lastVariables.input as Record<string, unknown>;
    expect(input.quantities).toEqual([
      { inventoryItemId: ITEM, locationId: LOCATION, quantity: 30, compareQuantity: 24 },
    ]);
    expect(input).not.toHaveProperty("ignoreCompareQuantity");
    expect(lastVariables.idempotencyKey).toBe("11111111-1111-1111-1111-111111111111");
    // The idempotency key is a directive argument on the field, not an input field.
    expect(lastQuery).toContain("@idempotent(key: $idempotencyKey)");
  });

  it("carries the scanId through as Shopify's own idempotency key", async () => {
    nextBody = {
      data: {
        inventorySetQuantities: { inventoryAdjustmentGroup: null, userErrors: [] },
      },
    };

    await setInventoryQuantities({
      inventoryItemId: ITEM,
      locationId: LOCATION,
      quantity: 5,
      compareQuantity: 0,
      idempotencyKey: "22222222-2222-2222-2222-222222222222",
      endpoint,
    });

    expect(lastVariables.idempotencyKey).toBe("22222222-2222-2222-2222-222222222222");
  });

  it("marks a stale compareQuantity distinctly from every other userError", async () => {
    nextBody = {
      data: {
        inventorySetQuantities: {
          inventoryAdjustmentGroup: null,
          userErrors: [
            {
              code: "COMPARE_QUANTITY_STALE",
              field: ["quantities", "0", "compareQuantity"],
              message: "The compareQuantity value does not match persisted value.",
            },
          ],
        },
      },
    };

    const result = await setInventoryQuantities({
      inventoryItemId: ITEM,
      locationId: LOCATION,
      quantity: 30,
      compareQuantity: 24,
      idempotencyKey: "33333333-3333-3333-3333-333333333333",
      endpoint,
    });

    expect(result.userErrors).toHaveLength(1);
    expect(STALE_COMPARE_CODES.has(result.userErrors[0]?.code ?? "")).toBe(true);
  });

  it("does not confuse a stale compare with an unrelated userError", async () => {
    nextBody = {
      data: {
        inventorySetQuantities: {
          inventoryAdjustmentGroup: null,
          userErrors: [
            {
              code: "INVALID_QUANTITY_NEGATIVE",
              field: null,
              message: "The quantity can't be negative.",
            },
          ],
        },
      },
    };

    const result = await setInventoryQuantities({
      inventoryItemId: ITEM,
      locationId: LOCATION,
      quantity: -1,
      compareQuantity: 0,
      idempotencyKey: "44444444-4444-4444-4444-444444444444",
      endpoint,
    });

    expect(STALE_COMPARE_CODES.has(result.userErrors[0]?.code ?? "")).toBe(false);
  });
});
