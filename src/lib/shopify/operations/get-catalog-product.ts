import { z } from "zod";

import type { CatalogProduct } from "@/lib/catalog/types";

import { shopifyRequest, type ShopifyEndpoint } from "../client";
import {
  CATALOG_FRAGMENTS,
  catalogProductFrom,
  catalogProductSchema,
  catalogVariantFrom,
  catalogVariantSchema,
  VARIANT_PAGE_SIZE,
} from "./catalog-fields";

/**
 * One product and all of its variants, as the mirror needs them.
 *
 * This is what a `products/create` or `products/update` webhook actually
 * triggers. The webhook payload is treated as a notification and nothing more:
 * it carries no publication list, it truncates at 100 variants, and building
 * the mirror from it would mean a second mapping that could drift from this
 * one. Shopify is the source of truth (CLAUDE.md §1), so we ask it.
 *
 * https://shopify.dev/docs/api/admin-graphql/2026-07/queries/product
 */

const QUERY = `
  query TallyGetCatalogProduct($id: ID!, $locationId: ID!, $after: String) {
    product(id: $id) {
      ...TallyCatalogProduct
      variants(first: ${VARIANT_PAGE_SIZE}, after: $after) {
        nodes { ...TallyCatalogVariant }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
  ${CATALOG_FRAGMENTS}
`;

export const getCatalogProductSchema = z.object({
  product: catalogProductSchema
    .extend({
      variants: z.object({
        nodes: z.array(catalogVariantSchema),
        pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() }),
      }),
    })
    .nullable(),
});

export interface GetCatalogProductOptions {
  locationId: string;
  endpoint?: ShopifyEndpoint;
  signal?: AbortSignal;
}

/**
 * Returns null when the product is gone — a `products/update` can lose a race
 * with a delete, and that is not an error worth retrying.
 *
 * Variants are paged rather than truncated. A party-supplies product will never
 * have more than a handful, but a silently short variant list would leave the
 * mirror claiming a barcode does not exist, and the whole point of the mirror
 * is that a scan finds things.
 */
export async function getCatalogProduct(
  productId: string,
  { locationId, endpoint, signal }: GetCatalogProductOptions,
): Promise<CatalogProduct | null> {
  let after: string | null = null;
  let node: z.infer<typeof getCatalogProductSchema>["product"] = null;
  const variants = [];

  for (;;) {
    const data: z.infer<typeof getCatalogProductSchema> = await shopifyRequest({
      operation: "TallyGetCatalogProduct",
      query: QUERY,
      variables: { id: productId, locationId, after },
      schema: getCatalogProductSchema,
      endpoint,
      signal,
    });

    if (data.product === null) return null;
    node = data.product;
    variants.push(...node.variants.nodes.map(catalogVariantFrom));

    if (!node.variants.pageInfo.hasNextPage) break;
    after = node.variants.pageInfo.endCursor;
    if (after === null) break;
  }

  return catalogProductFrom(node, variants);
}
