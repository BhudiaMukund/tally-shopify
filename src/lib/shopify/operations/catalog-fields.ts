import { z } from "zod";

import type { CatalogProduct, CatalogVariant } from "@/lib/catalog/types";
import { productStatus } from "@/lib/db/schemas/products-mirror";

/**
 * The one field selection the catalogue is read with.
 *
 * The live barcode lookup and the webhook re-read share it so the mirror can
 * never be filled in differently depending on which path wrote it. The bulk
 * backfill can't use a fragment — a bulk query is a bare document with no
 * operation to declare `$locationId` on — so it repeats the same fields in
 * `catalog-bulk.ts`, and `catalogProductFrom` below is what both ends map
 * through.
 *
 * Publications come from `resourcePublications`, **not** `publications`, which
 * is deprecated in 2026-07 along with `publicationCount` and
 * `publishedOnChannel`. `onlyPublished` defaults to true and `isPublished` is
 * selected anyway, because `posOnly` is derived from this list and a product
 * wrongly believed to be POS-only gets its sizes pooled into one variant
 * instead of split (§3).
 *
 * https://shopify.dev/docs/api/admin-graphql/2026-07/objects/Product
 * https://shopify.dev/docs/api/admin-graphql/2026-07/objects/ResourcePublication
 * https://shopify.dev/docs/api/admin-graphql/2026-07/objects/InventoryItem
 */

/** How many publications and variants a single product read pulls back. */
export const PUBLICATION_PAGE_SIZE = 25;
export const VARIANT_PAGE_SIZE = 100;

export const CATALOG_FRAGMENTS = `
  fragment TallyCatalogVariant on ProductVariant {
    id
    barcode
    sku
    price
    selectedOptions { name value }
    inventoryItem {
      id
      tracked
      inventoryLevel(locationId: $locationId) {
        quantities(names: ["available"]) { name quantity }
      }
    }
  }

  fragment TallyCatalogProduct on Product {
    id
    title
    status
    vendor
    productType
    updatedAt
    options { name }
    variantsCount { count }
    featuredMedia { preview { image { url } } }
    resourcePublications(first: ${PUBLICATION_PAGE_SIZE}) {
      nodes {
        isPublished
        publication { id name }
      }
    }
  }
`;

const quantitySchema = z.object({ name: z.string(), quantity: z.number().int() });

export const catalogVariantSchema = z.object({
  id: z.string(),
  barcode: z.string().nullable(),
  sku: z.string().nullable(),
  price: z.string(),
  selectedOptions: z.array(z.object({ name: z.string(), value: z.string() })),
  inventoryItem: z.object({
    id: z.string(),
    tracked: z.boolean(),
    inventoryLevel: z
      .object({ quantities: z.array(quantitySchema) })
      .nullable()
      .optional(),
  }),
});
export type CatalogVariantNode = z.infer<typeof catalogVariantSchema>;

export const catalogProductSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: productStatus,
  vendor: z.string().nullable(),
  productType: z.string().nullable(),
  updatedAt: z.string(),
  options: z.array(z.object({ name: z.string() })),
  variantsCount: z.object({ count: z.number().int().nonnegative() }).nullable(),
  featuredMedia: z
    .object({ preview: z.object({ image: z.object({ url: z.string() }).nullable() }).nullable() })
    .nullable(),
  resourcePublications: z.object({
    nodes: z.array(
      z.object({
        isPublished: z.boolean(),
        publication: z.object({ id: z.string(), name: z.string() }),
      }),
    ),
  }),
});
export type CatalogProductNode = z.infer<typeof catalogProductSchema>;

/** `available` at our location, or null when the item is untracked or not stocked. */
export function availableFrom(node: CatalogVariantNode): number | null {
  const level = node.inventoryItem.inventoryLevel;
  if (level === null || level === undefined) return null;
  return level.quantities.find((entry) => entry.name === "available")?.quantity ?? null;
}

export function catalogVariantFrom(node: CatalogVariantNode): CatalogVariant {
  return {
    id: node.id,
    barcode: node.barcode,
    sku: node.sku,
    price: node.price,
    selectedOptions: node.selectedOptions,
    inventoryItemId: node.inventoryItem.id,
    tracked: node.inventoryItem.tracked,
    available: availableFrom(node),
  };
}

export function catalogProductFrom(
  node: CatalogProductNode,
  variants: readonly CatalogVariant[],
): CatalogProduct {
  return {
    id: node.id,
    title: node.title,
    status: node.status,
    vendor: node.vendor,
    productType: node.productType,
    optionNames: node.options.map((option) => option.name),
    publications: node.resourcePublications.nodes
      .filter((entry) => entry.isPublished)
      .map((entry) => entry.publication),
    variantCount: node.variantsCount?.count ?? variants.length,
    variants: [...variants],
    imageUrl: node.featuredMedia?.preview?.image?.url ?? null,
    updatedAt: new Date(node.updatedAt),
  };
}
