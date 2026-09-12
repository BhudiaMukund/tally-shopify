import { describe, expect, it } from "vitest";

import { catalogBulkQuery, createCatalogAccumulator } from "./catalog-bulk";

/**
 * The JSONL shapes are the ones the dev store actually produced — a product
 * line with no `__parentId`, then its publications and variants carrying one.
 * The values are synthetic.
 */
const LOCATION = "gid://shopify/Location/111";
const PRODUCT = "gid://shopify/Product/1";

const productLine = {
  id: PRODUCT,
  title: "Foil Balloon 45cm",
  status: "ACTIVE",
  vendor: "Acme Party",
  productType: "Balloon",
  updatedAt: "2026-09-01T10:00:00Z",
  options: [{ name: "Size" }],
  variantsCount: { count: 2 },
  featuredMedia: { preview: { image: { url: "https://cdn.example.com/a.jpg" } } },
};

const publicationLine = (name: string, id: string, isPublished = true) => ({
  isPublished,
  publication: { id, name },
  __parentId: PRODUCT,
});

const variantLine = (id: string, barcode: string | null, price: string, size: string) => ({
  id,
  barcode,
  sku: null,
  price,
  selectedOptions: [{ name: "Size", value: size }],
  inventoryItem: {
    id: `gid://shopify/InventoryItem/${id.split("/").pop()}`,
    tracked: false,
    inventoryLevel: { quantities: [{ name: "available", quantity: 4 }] },
  },
  __parentId: PRODUCT,
});

describe("catalogBulkQuery", () => {
  it("interpolates the location into the inventory level", () => {
    expect(catalogBulkQuery(LOCATION)).toContain(`inventoryLevel(locationId: "${LOCATION}")`);
  });

  it("selects the option names and publications this commit is responsible for", () => {
    const query = catalogBulkQuery(LOCATION);
    expect(query).toContain("options { name }");
    expect(query).toContain("resourcePublications");
    expect(query).toContain("selectedOptions { name value }");
    // publications, publicationCount and publishedOnChannel are all deprecated
    // in 2026-07; resourcePublications is the one that is not.
    expect(query).not.toMatch(/\bpublications\s*{/);
  });

  it("stays inside the bulk limits: five connections, two levels deep", () => {
    const query = catalogBulkQuery(LOCATION);
    expect(query.match(/edges\s*{/g)).toHaveLength(3);
  });

  it("refuses anything that is not a Location GID", () => {
    expect(() => catalogBulkQuery("12345")).toThrow(/Location GID/);
    expect(() => catalogBulkQuery('gid://shopify/Location/1" } malicious {')).toThrow();
  });
});

describe("createCatalogAccumulator", () => {
  it("reassembles a product from its flattened lines", () => {
    const accumulator = createCatalogAccumulator();
    accumulator.add(productLine);
    accumulator.add(publicationLine("Point of Sale", "gid://shopify/Publication/222"));
    accumulator.add(
      variantLine("gid://shopify/ProductVariant/1", "5012345678900", "12.50", "Small"),
    );
    accumulator.add(
      variantLine("gid://shopify/ProductVariant/2", "5012345678900", "18.00", "Large"),
    );

    const { products, unknownLines, orphanLines } = accumulator.result();
    expect(unknownLines).toBe(0);
    expect(orphanLines).toBe(0);
    expect(products).toHaveLength(1);

    const product = products[0];
    expect(product?.optionNames).toEqual(["Size"]);
    expect(product?.publications).toEqual([
      { id: "gid://shopify/Publication/222", name: "Point of Sale" },
    ]);
    expect(product?.variantCount).toBe(2);
    expect(product?.variants.map((variant) => variant.price)).toEqual(["12.50", "18.00"]);
    expect(product?.variants[0]?.available).toBe(4);
    expect(product?.imageUrl).toBe("https://cdn.example.com/a.jpg");
    expect(product?.updatedAt).toEqual(new Date("2026-09-01T10:00:00Z"));
  });

  it("keeps only the publications the product is actually published to", () => {
    const accumulator = createCatalogAccumulator();
    accumulator.add(productLine);
    accumulator.add(publicationLine("Point of Sale", "gid://shopify/Publication/222"));
    accumulator.add(publicationLine("Online Store", "gid://shopify/Publication/333", false));

    expect(accumulator.result().products[0]?.publications).toEqual([
      { id: "gid://shopify/Publication/222", name: "Point of Sale" },
    ]);
  });

  it("tolerates a child arriving before its parent", () => {
    const accumulator = createCatalogAccumulator();
    accumulator.add(variantLine("gid://shopify/ProductVariant/1", null, "12.50", "Small"));
    accumulator.add(productLine);

    const { products, orphanLines } = accumulator.result();
    expect(orphanLines).toBe(0);
    expect(products[0]?.variants).toHaveLength(1);
  });

  it("counts a variant whose product line never arrived instead of inventing one", () => {
    const accumulator = createCatalogAccumulator();
    accumulator.add(variantLine("gid://shopify/ProductVariant/1", null, "12.50", "Small"));

    const { products, orphanLines } = accumulator.result();
    expect(products).toEqual([]);
    expect(orphanLines).toBe(1);
  });

  it("counts a line it cannot read rather than dropping it silently", () => {
    const accumulator = createCatalogAccumulator();
    accumulator.add({ something: "else" });
    accumulator.add("not an object");
    accumulator.add(null);

    expect(accumulator.result().unknownLines).toBe(3);
  });

  it("keeps two products apart", () => {
    const accumulator = createCatalogAccumulator();
    accumulator.add(productLine);
    accumulator.add({ ...productLine, id: "gid://shopify/Product/2", title: "Paper Plates 20pk" });
    accumulator.add(
      variantLine("gid://shopify/ProductVariant/1", "5012345678900", "12.50", "Small"),
    );

    const { products } = accumulator.result();
    expect(products).toHaveLength(2);
    expect(products[0]?.variants).toHaveLength(1);
    expect(products[1]?.variants).toHaveLength(0);
  });
});
