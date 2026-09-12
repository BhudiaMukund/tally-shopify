import { describe, expect, it } from "vitest";

import type { LookupProduct } from "./lookup-client";
import { distinctProductCount, distinctVariantCount, reconcileProducts } from "./reconcile-matches";

/**
 * Real shapes: exactly the JSON `GET /api/lookup` puts in `products`, not a
 * simplified stand-in for it.
 */

const CONFETTI: LookupProduct = {
  productId: "gid://shopify/Product/9001",
  title: "Confetti 15gms (Pack of 2)",
  status: "ACTIVE",
  vendor: "Party Co",
  productType: "Confetti",
  optionNames: [],
  publications: ["Point of Sale"],
  posOnly: true,
  variantCount: 1,
  imageUrl: null,
  variants: [
    {
      variantId: "gid://shopify/ProductVariant/9101",
      barcode: "9312345678907",
      sku: "CONF-15G-2PK",
      price: "4.50",
      optionValues: {},
      optionLabel: "",
      inventoryItemId: "gid://shopify/InventoryItem/9201",
      tracked: true,
      available: 24,
    },
  ],
};

const GIFT_BOX_SMALL: LookupProduct = {
  productId: "gid://shopify/Product/1",
  title: "Gift Box",
  status: "ACTIVE",
  vendor: "Acme Party",
  productType: "Gift box",
  optionNames: ["Size"],
  publications: ["Point of Sale"],
  posOnly: true,
  variantCount: 2,
  imageUrl: null,
  variants: [
    {
      variantId: "gid://shopify/ProductVariant/1",
      barcode: "5012345678900",
      sku: null,
      price: "12.50",
      optionValues: { Size: "Small" },
      optionLabel: "Small",
      inventoryItemId: "gid://shopify/InventoryItem/1",
      tracked: true,
      available: 3,
    },
  ],
};

const GIFT_BOX_LARGE: LookupProduct = {
  ...GIFT_BOX_SMALL,
  variants: [
    {
      variantId: "gid://shopify/ProductVariant/2",
      barcode: "5012345678900",
      sku: null,
      price: "18.00",
      optionValues: { Size: "Large" },
      optionLabel: "Large",
      inventoryItemId: "gid://shopify/InventoryItem/2",
      tracked: true,
      available: 5,
    },
  ],
};

describe("reconcileProducts", () => {
  it("a single-variant product scanned through both fetch phases yields exactly one match", () => {
    const cachedPhase = [CONFETTI];
    const livePhase = [CONFETTI];

    const reconciled = reconcileProducts(cachedPhase, livePhase);

    expect(reconciled).toHaveLength(1);
    expect(reconciled[0]?.variants).toHaveLength(1);
    expect(distinctProductCount(reconciled)).toBe(1);
    expect(distinctVariantCount(reconciled)).toBe(1);
  });

  it("groups several variants of one product under one entry, not several", () => {
    const reconciled = reconcileProducts([GIFT_BOX_SMALL, GIFT_BOX_LARGE]);

    expect(distinctProductCount(reconciled)).toBe(1);
    expect(reconciled[0]?.variants.map((v) => v.optionLabel).sort()).toEqual(["Large", "Small"]);
  });

  it("keeps genuinely different products apart", () => {
    const reconciled = reconcileProducts([CONFETTI, GIFT_BOX_SMALL]);
    expect(distinctProductCount(reconciled)).toBe(2);
  });

  it("a later source replaces an earlier one for the same variant rather than duplicating it", () => {
    const staleAvailable = { ...CONFETTI, variants: [{ ...CONFETTI.variants[0]!, available: 99 }] };
    const freshAvailable = { ...CONFETTI, variants: [{ ...CONFETTI.variants[0]!, available: 24 }] };

    const reconciled = reconcileProducts([staleAvailable], [freshAvailable]);

    expect(reconciled).toHaveLength(1);
    expect(reconciled[0]?.variants).toHaveLength(1);
    expect(reconciled[0]?.variants[0]?.available).toBe(24);
  });

  it("an empty cached-only phase does not erase a product a later phase confirms", () => {
    const reconciled = reconcileProducts([], [CONFETTI]);
    expect(distinctProductCount(reconciled)).toBe(1);
  });
});

describe("distinctProductCount / distinctVariantCount", () => {
  it("count zero for no matches", () => {
    expect(distinctProductCount([])).toBe(0);
    expect(distinctVariantCount([])).toBe(0);
  });
});
