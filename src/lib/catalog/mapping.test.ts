import { describe, expect, it } from "vitest";

import type { ProductMirror } from "@/lib/db/schemas/products-mirror";

import {
  groupMirrorRows,
  isPosOnly,
  optionValuesOf,
  toMirrorDocuments,
  toProductMatch,
} from "./mapping";
import type { CatalogProduct, CatalogVariant } from "./types";

/**
 * Synthetic throughout — GIDs, barcodes and titles are invented here, not taken
 * from the catalogue (CLAUDE.md, "this repo is public").
 */
const LOCATION = "gid://shopify/Location/111";
const POS = "gid://shopify/Publication/222";
const ONLINE = "gid://shopify/Publication/333";

const context = { locationId: LOCATION, posPublicationId: POS };

function variant(overrides: Partial<CatalogVariant> = {}): CatalogVariant {
  return {
    id: "gid://shopify/ProductVariant/1",
    barcode: "5012345678900",
    sku: "PS-001",
    price: "12.50",
    selectedOptions: [{ name: "Title", value: "Default Title" }],
    inventoryItemId: "gid://shopify/InventoryItem/1",
    tracked: false,
    available: null,
    ...overrides,
  };
}

function product(overrides: Partial<CatalogProduct> = {}): CatalogProduct {
  return {
    id: "gid://shopify/Product/1",
    title: "Foil Balloon 45cm",
    status: "ACTIVE",
    vendor: "Acme Party",
    productType: "Balloon",
    optionNames: [],
    publications: [{ id: POS, name: "Point of Sale" }],
    variantCount: 1,
    variants: [variant()],
    imageUrl: null,
    updatedAt: new Date("2026-09-01T10:00:00Z"),
    ...overrides,
  };
}

describe("isPosOnly", () => {
  it("is true for Point of Sale alone", () => {
    expect(isPosOnly([{ id: POS, name: "Point of Sale" }], POS)).toBe(true);
  });

  it("is true for a product published nowhere — nobody can see it either", () => {
    expect(isPosOnly([], POS)).toBe(true);
  });

  it("is false as soon as anything else can see it", () => {
    expect(
      isPosOnly(
        [
          { id: POS, name: "Point of Sale" },
          { id: ONLINE, name: "Online Store" },
        ],
        POS,
      ),
    ).toBe(false);
  });

  it("falls back to the channel name when no publication id is configured", () => {
    expect(isPosOnly([{ id: POS, name: "Point of Sale" }])).toBe(true);
    expect(isPosOnly([{ id: ONLINE, name: "Online Store" }])).toBe(false);
  });

  it("trusts the id over the name — a renamed channel is still the POS channel", () => {
    expect(isPosOnly([{ id: POS, name: "Shopfront till" }], POS)).toBe(true);
  });
});

describe("optionValuesOf", () => {
  it("drops Shopify's Default Title placeholder", () => {
    expect(optionValuesOf(variant())).toEqual({});
  });

  it("keeps real option values", () => {
    expect(
      optionValuesOf(
        variant({
          selectedOptions: [
            { name: "Size", value: "Large" },
            { name: "Colour", value: "Red" },
          ],
        }),
      ),
    ).toEqual({ Size: "Large", Colour: "Red" });
  });

  it("keeps a genuine Title option whose value is not the placeholder", () => {
    expect(
      optionValuesOf(variant({ selectedOptions: [{ name: "Title", value: "Gold" }] })),
    ).toEqual({ Title: "Gold" });
  });
});

describe("toMirrorDocuments", () => {
  it("writes one document per variant with the product's fields on each", () => {
    const documents = toMirrorDocuments(
      product({
        optionNames: ["Size"],
        variantCount: 2,
        variants: [
          variant({
            id: "gid://shopify/ProductVariant/1",
            selectedOptions: [{ name: "Size", value: "Small" }],
          }),
          variant({
            id: "gid://shopify/ProductVariant/2",
            inventoryItemId: "gid://shopify/InventoryItem/2",
            price: "18.00",
            selectedOptions: [{ name: "Size", value: "Large" }],
          }),
        ],
      }),
      context,
    );

    expect(documents).toHaveLength(2);
    expect(documents[0]).toMatchObject({
      shopifyProductId: "gid://shopify/Product/1",
      shopifyVariantId: "gid://shopify/ProductVariant/1",
      barcode: "5012345678900",
      optionNames: ["Size"],
      optionValues: { Size: "Small" },
      variantCount: 2,
      publications: ["Point of Sale"],
      posOnly: true,
      locationId: LOCATION,
    });
    expect(documents[1]?.price).toBe("18.00");
  });

  it("normalises the barcode and keeps the raw value for the audit", () => {
    const [document] = toMirrorDocuments(
      product({ variants: [variant({ barcode: "'5012345678900" })] }),
      context,
    );
    expect(document?.barcode).toBe("5012345678900");
    expect(document?.barcodeRaw).toBe("'5012345678900");
  });

  it("omits the barcode field entirely when there is none", () => {
    const [document] = toMirrorDocuments(
      product({ variants: [variant({ barcode: null })] }),
      context,
    );
    // Not an empty string: the lookup index is on this field and a run of empty
    // strings would collect every barcode-less variant under one key.
    expect(document).not.toHaveProperty("barcode");
    expect(document).not.toHaveProperty("barcodeRaw");
  });

  it("normalises money so two spellings of the same price compare equal", () => {
    const [document] = toMirrorDocuments(
      product({ variants: [variant({ price: "12.5" })] }),
      context,
    );
    expect(document?.price).toBe("12.50");
  });

  it("records the available quantity and the tracked flag as they came", () => {
    const [document] = toMirrorDocuments(
      product({ variants: [variant({ tracked: true, available: 7 })] }),
      context,
    );
    expect(document).toMatchObject({ tracked: true, inventoryQty: 7 });
  });

  it("never claims a backfilled barcode was generated by Tally", () => {
    const [document] = toMirrorDocuments(product(), context);
    expect(document?.barcodeGenerated).toBe(false);
  });

  it("refuses a document the schema does not accept", () => {
    expect(() =>
      toMirrorDocuments(product({ variants: [variant({ price: "twelve fifty" })] }), context),
    ).toThrow();
  });
});

describe("toProductMatch", () => {
  it("carries the option label and the POS flag the scan screen decides on", () => {
    const match = toProductMatch(
      product({
        optionNames: ["Size", "Colour"],
        variantCount: 6,
        publications: [
          { id: POS, name: "Point of Sale" },
          { id: ONLINE, name: "Online Store" },
        ],
        variants: [
          variant({
            selectedOptions: [
              { name: "Size", value: "Large" },
              { name: "Colour", value: "Red" },
            ],
          }),
        ],
      }),
      context,
    );

    expect(match.posOnly).toBe(false);
    expect(match.publications).toEqual(["Point of Sale", "Online Store"]);
    expect(match.variantCount).toBe(6);
    expect(match.variants[0]?.optionLabel).toBe("Large / Red");
  });

  it("leaves optionLabel empty for a product that has no options yet", () => {
    expect(toProductMatch(product(), context).variants[0]?.optionLabel).toBe("");
  });
});

describe("groupMirrorRows", () => {
  const row = (overrides: Partial<ProductMirror>): ProductMirror => ({
    shopifyProductId: "gid://shopify/Product/1",
    shopifyVariantId: "gid://shopify/ProductVariant/1",
    barcode: "5012345678900",
    title: "Foil Balloon 45cm",
    optionNames: ["Size"],
    optionValues: { Size: "Small" },
    variantCount: 2,
    publications: ["Point of Sale"],
    posOnly: true,
    barcodeGenerated: false,
    price: "12.50",
    inventoryItemId: "gid://shopify/InventoryItem/1",
    tracked: false,
    inventoryQty: null,
    locationId: LOCATION,
    status: "ACTIVE",
    updatedAtShopify: new Date("2026-09-01T10:00:00Z"),
    syncedAt: new Date("2026-09-01T10:00:01Z"),
    ...overrides,
  });

  it("groups a size run under one product", () => {
    const grouped = groupMirrorRows([
      row({}),
      row({
        shopifyVariantId: "gid://shopify/ProductVariant/2",
        optionValues: { Size: "Large" },
        price: "18.00",
      }),
    ]);

    expect(grouped).toHaveLength(1);
    expect(grouped[0]?.variants).toHaveLength(2);
    expect(grouped[0]?.variants.map((entry) => entry.optionLabel)).toEqual(["Small", "Large"]);
  });

  it("keeps two products apart — one barcode on two products is a data error, not a merge", () => {
    const grouped = groupMirrorRows([
      row({}),
      row({
        shopifyProductId: "gid://shopify/Product/2",
        shopifyVariantId: "gid://shopify/ProductVariant/9",
        title: "Paper Plates 20pk",
      }),
    ]);

    expect(grouped).toHaveLength(2);
    expect(grouped.map((match) => match.title)).toEqual(["Foil Balloon 45cm", "Paper Plates 20pk"]);
  });

  it("produces the same shape the live path does", () => {
    const cached = groupMirrorRows([row({})])[0];
    const live = toProductMatch(product(), context);
    expect(Object.keys(cached ?? {}).sort()).toEqual(Object.keys(live).sort());
  });
});
