import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeShopifyClient, type ShopifyEndpoint } from "../client";
import { barcodeQuery, findVariantsByBarcode } from "./find-variants-by-barcode";

/**
 * The live lookup against a fake Shopify, for the one thing that cannot be
 * tested any other way: that a barcode matching several variants comes back
 * grouped by product (CLAUDE.md §2) rather than as a flat list somebody will
 * eventually call `[0]` on.
 */

const LOCATION = "gid://shopify/Location/111";
const POS = "gid://shopify/Publication/222";

let server: Server;
let endpoint: ShopifyEndpoint;
let nextBody: unknown = { data: {} };
let lastVariables: Record<string, unknown> = {};

function variantNode(options: {
  id: string;
  price: string;
  size: string;
  productId: string;
  productTitle: string;
  variantCount: number;
  publications?: { id: string; name: string }[];
}) {
  return {
    id: options.id,
    barcode: "5012345678900",
    sku: null,
    price: options.price,
    selectedOptions: [{ name: "Size", value: options.size }],
    inventoryItem: {
      id: `gid://shopify/InventoryItem/${options.id.split("/").pop()}`,
      tracked: true,
      inventoryLevel: { quantities: [{ name: "available", quantity: 3 }] },
    },
    product: {
      id: options.productId,
      title: options.productTitle,
      status: "ACTIVE",
      vendor: "Acme Party",
      productType: "Gift box",
      updatedAt: "2026-09-01T10:00:00Z",
      options: [{ name: "Size" }],
      variantsCount: { count: options.variantCount },
      featuredMedia: null,
      resourcePublications: {
        nodes: (options.publications ?? [{ id: POS, name: "Point of Sale" }]).map(
          (publication) => ({ isPublished: true, publication }),
        ),
      },
    },
  };
}

beforeAll(async () => {
  server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
        variables: Record<string, unknown>;
      };
      lastVariables = body.variables;
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

describe("barcodeQuery", () => {
  it("ORs every zero-padded spelling of the code", () => {
    expect(barcodeQuery("036000291452")).toBe(
      "barcode:'036000291452' OR barcode:'0036000291452' OR barcode:'00036000291452'",
    );
  });

  it("refuses a value with no digits rather than searching for everything", () => {
    expect(() => barcodeQuery("n/a")).toThrow(/at least one digit/);
  });
});

describe("findVariantsByBarcode", () => {
  it("groups a size run under one product and keeps the real variant count", async () => {
    nextBody = {
      data: {
        productVariants: {
          nodes: [
            variantNode({
              id: "gid://shopify/ProductVariant/1",
              price: "12.50",
              size: "Small",
              productId: "gid://shopify/Product/1",
              productTitle: "Gift Box",
              variantCount: 4,
            }),
            variantNode({
              id: "gid://shopify/ProductVariant/2",
              price: "18.00",
              size: "Large",
              productId: "gid://shopify/Product/1",
              productTitle: "Gift Box",
              variantCount: 4,
            }),
          ],
        },
      },
    };

    const products = await findVariantsByBarcode("5012345678900", {
      locationId: LOCATION,
      endpoint,
    });

    expect(products).toHaveLength(1);
    expect(products[0]?.variants).toHaveLength(2);
    // Two matched, four exist — the scan screen needs both numbers.
    expect(products[0]?.variantCount).toBe(4);
    expect(products[0]?.variants.map((variant) => variant.price)).toEqual(["12.50", "18.00"]);
    expect(products[0]?.variants[0]?.available).toBe(3);
  });

  it("keeps genuinely different products apart", async () => {
    nextBody = {
      data: {
        productVariants: {
          nodes: [
            variantNode({
              id: "gid://shopify/ProductVariant/1",
              price: "12.50",
              size: "Small",
              productId: "gid://shopify/Product/1",
              productTitle: "Gift Box",
              variantCount: 1,
            }),
            variantNode({
              id: "gid://shopify/ProductVariant/9",
              price: "4.00",
              size: "Small",
              productId: "gid://shopify/Product/2",
              productTitle: "Paper Plates 20pk",
              variantCount: 1,
            }),
          ],
        },
      },
    };

    const products = await findVariantsByBarcode("5012345678900", {
      locationId: LOCATION,
      endpoint,
    });

    expect(products.map((product) => product.title)).toEqual(["Gift Box", "Paper Plates 20pk"]);
  });

  it("sends the location so the inventory level is the one we stock at", async () => {
    nextBody = { data: { productVariants: { nodes: [] } } };
    await findVariantsByBarcode("5012345678900", { locationId: LOCATION, endpoint });
    expect(lastVariables.locationId).toBe(LOCATION);
    expect(lastVariables.query).toBe("barcode:'5012345678900' OR barcode:'05012345678900'");
  });

  it("returns nothing for a barcode Shopify does not know", async () => {
    nextBody = { data: { productVariants: { nodes: [] } } };
    await expect(
      findVariantsByBarcode("5012345678900", { locationId: LOCATION, endpoint }),
    ).resolves.toEqual([]);
  });
});
