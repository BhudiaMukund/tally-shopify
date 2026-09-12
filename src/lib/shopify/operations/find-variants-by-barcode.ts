import { z } from "zod";

import { barcodeCandidates } from "@/lib/barcode";
import type { CatalogProduct } from "@/lib/catalog/types";

import { shopifyRequest, type ShopifyEndpoint } from "../client";
import {
  CATALOG_FRAGMENTS,
  catalogProductFrom,
  catalogProductSchema,
  catalogVariantFrom,
  catalogVariantSchema,
} from "./catalog-fields";

/**
 * The live half of a scan: ask Shopify, not the mirror.
 *
 * `productVariants` supports a `barcode:` filter, and the answer comes back
 * grouped by product here because one printed code legitimately covers a whole
 * size run (CLAUDE.md §2). A `findOne`-shaped API would make the ambiguous case
 * unrepresentable, which is how it ends up being handled by accident.
 *
 * https://shopify.dev/docs/api/admin-graphql/2026-07/queries/productVariants
 */

/**
 * Enough for a size run plus the odd cross-product collision, without paying
 * for 50 nodes of product fields on the scan path's 400ms budget. A barcode
 * matching more than this is a catalogue problem the audit report will already
 * be shouting about.
 */
export const BARCODE_MATCH_LIMIT = 25;

const QUERY = `
  query TallyFindVariantsByBarcode($query: String!, $first: Int!, $locationId: ID!) {
    productVariants(first: $first, query: $query) {
      nodes {
        ...TallyCatalogVariant
        product { ...TallyCatalogProduct }
      }
    }
  }
  ${CATALOG_FRAGMENTS}
`;

export const findVariantsByBarcodeSchema = z.object({
  productVariants: z.object({
    nodes: z.array(catalogVariantSchema.extend({ product: catalogProductSchema })),
  }),
});

/**
 * The search term.
 *
 * Every zero-padded spelling of the code is ORed together: the catalogue holds
 * a UPC-A on one variant and the same item's EAN-13 on another, and §3 says
 * they are the same barcode. Values are quoted because Shopify's search syntax
 * treats a bare term as a prefix-ish match across indexed fields — quoting
 * keeps `barcode:0036000291452` from also answering for a longer code.
 */
export function barcodeQuery(barcode: string): string {
  const candidates = barcodeCandidates(barcode);
  if (candidates.length === 0) throw new Error("A barcode search needs at least one digit");
  return candidates.map((candidate) => `barcode:'${candidate}'`).join(" OR ");
}

export interface FindVariantsOptions {
  locationId: string;
  first?: number;
  endpoint?: ShopifyEndpoint;
  signal?: AbortSignal;
}

/**
 * Variants carrying this barcode, grouped by their parent product.
 *
 * `variants` on each result holds only the matching variants, while
 * `variantCount` is the product's real total — the scan screen needs both to
 * tell "this product has three sizes and you scanned one" from "this barcode is
 * on three products", which is a data error worth logging.
 */
export async function findVariantsByBarcode(
  barcode: string,
  { locationId, first = BARCODE_MATCH_LIMIT, endpoint, signal }: FindVariantsOptions,
): Promise<CatalogProduct[]> {
  const data = await shopifyRequest({
    operation: "TallyFindVariantsByBarcode",
    query: QUERY,
    variables: { query: barcodeQuery(barcode), first, locationId },
    schema: findVariantsByBarcodeSchema,
    endpoint,
    signal,
  });

  const byProduct = new Map<string, CatalogProduct>();

  for (const node of data.productVariants.nodes) {
    const existing = byProduct.get(node.product.id);
    if (existing === undefined) {
      byProduct.set(node.product.id, catalogProductFrom(node.product, [catalogVariantFrom(node)]));
      continue;
    }
    existing.variants.push(catalogVariantFrom(node));
  }

  return [...byProduct.values()];
}
