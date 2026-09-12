import { z } from "zod";

import type { CatalogProduct, CatalogVariant } from "@/lib/catalog/types";

import {
  catalogProductFrom,
  catalogProductSchema,
  catalogVariantFrom,
  catalogVariantSchema,
} from "./operations/catalog-fields";

/**
 * The whole catalogue, as one bulk query, reassembled from JSONL.
 *
 * The field list is deliberately the same one the live lookup and the webhook
 * re-read use (`operations/catalog-fields.ts`) — option names, publications,
 * option values, price and the inventory item, selected here rather than in
 * some later commit. A mirror filled in differently depending on which path
 * wrote it would make the cached half of a scan disagree with the live half for
 * reasons nobody could reproduce.
 *
 * It cannot literally share the fragments: a bulk query is a bare document with
 * no operation to declare `$locationId` on, so the location is interpolated and
 * the shape is asserted against the same Zod schemas at the other end.
 *
 * Three connections (products, resourcePublications, variants) against a limit
 * of five, and two levels of nesting against a limit of two.
 *
 * https://shopify.dev/docs/api/usage/bulk-operations/queries
 */

/** Guards the interpolation below — this is a GID from the environment, not user input. */
const LOCATION_GID = /^gid:\/\/shopify\/Location\/\d+$/;

export function catalogBulkQuery(locationId: string): string {
  if (!LOCATION_GID.test(locationId)) {
    throw new Error(`"${locationId}" is not a Location GID — run \`pnpm shopify:doctor\``);
  }

  return `
{
  products {
    edges {
      node {
        id
        title
        status
        vendor
        productType
        updatedAt
        options { name }
        variantsCount { count }
        featuredMedia { preview { image { url } } }
        resourcePublications {
          edges {
            node {
              isPublished
              publication { id name }
            }
          }
        }
        variants {
          edges {
            node {
              id
              barcode
              sku
              price
              selectedOptions { name value }
              inventoryItem {
                id
                tracked
                inventoryLevel(locationId: "${locationId}") {
                  quantities(names: ["available"]) { name quantity }
                }
              }
            }
          }
        }
      }
    }
  }
}
`;
}

/** A product line: the same fields as a live read, minus the nested connections. */
const bulkProductSchema = catalogProductSchema.omit({ resourcePublications: true });

const bulkVariantSchema = catalogVariantSchema.extend({ __parentId: z.string() });

const bulkPublicationSchema = z.object({
  __parentId: z.string(),
  isPublished: z.boolean(),
  publication: z.object({ id: z.string(), name: z.string() }),
});

export interface CatalogAccumulatorResult {
  products: CatalogProduct[];
  /** Lines that matched none of the three shapes. Any of these is a bug here. */
  unknownLines: number;
  /** Lines whose parent product was never seen. Shopify should not produce these. */
  orphanLines: number;
}

interface Pending {
  /** Absent until the product's own line arrives. */
  node?: z.infer<typeof bulkProductSchema>;
  variants: CatalogVariant[];
  publications: { id: string; name: string }[];
}

/**
 * Reassembles the flattened stream.
 *
 * Everything is held until the end rather than flushed per product: the JSONL
 * guarantees a child appears after its parent but not that a parent's children
 * are contiguous, and 1,900 products of this shape is a few megabytes. If this
 * store ever grows an order of magnitude, flush on `__parentId` change and
 * accept the ordering risk then, not now.
 */
export function createCatalogAccumulator() {
  const pending = new Map<string, Pending>();
  let unknownLines = 0;
  let orphanLines = 0;

  function add(line: unknown): void {
    if (typeof line !== "object" || line === null) {
      unknownLines += 1;
      return;
    }
    const record = line as Record<string, unknown>;

    if (record.__parentId === undefined) {
      const product = bulkProductSchema.safeParse(record);
      if (!product.success) {
        unknownLines += 1;
        return;
      }
      const existing = pending.get(product.data.id);
      // Children can arrive before their parent only if Shopify breaks its own
      // ordering rule, but merging rather than replacing costs nothing.
      pending.set(product.data.id, {
        node: product.data,
        variants: existing?.variants ?? [],
        publications: existing?.publications ?? [],
      });
      return;
    }

    if (record.publication !== undefined) {
      const entry = bulkPublicationSchema.safeParse(record);
      if (!entry.success) {
        unknownLines += 1;
        return;
      }
      if (!entry.data.isPublished) return;
      parentOf(entry.data.__parentId).publications.push(entry.data.publication);
      return;
    }

    const variant = bulkVariantSchema.safeParse(record);
    if (!variant.success) {
      unknownLines += 1;
      return;
    }
    parentOf(variant.data.__parentId).variants.push(catalogVariantFrom(variant.data));
  }

  /** A slot for a child whose parent has not been seen yet. */
  function parentOf(parentId: string): Pending {
    const existing = pending.get(parentId);
    if (existing !== undefined) return existing;

    const slot: Pending = { variants: [], publications: [] };
    pending.set(parentId, slot);
    return slot;
  }

  function result(): CatalogAccumulatorResult {
    const products: CatalogProduct[] = [];

    for (const entry of pending.values()) {
      // A parent that never arrived. Writing its variants to the mirror would
      // mean a row with no title and no publication list.
      if (entry.node === undefined) {
        orphanLines += 1;
        continue;
      }

      products.push(
        catalogProductFrom(
          {
            ...entry.node,
            resourcePublications: {
              nodes: entry.publications.map((publication) => ({ isPublished: true, publication })),
            },
          },
          entry.variants,
        ),
      );
    }

    return { products, unknownLines, orphanLines };
  }

  return { add, result };
}
