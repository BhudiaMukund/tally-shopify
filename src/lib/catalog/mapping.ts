import { normaliseBarcode } from "@/lib/barcode";
import { productMirrorSchema, type ProductMirror } from "@/lib/db/schemas/products-mirror";

import type { CatalogProduct, CatalogVariant, ProductMatch, VariantMatch } from "./types";

/**
 * Catalogue product → mirror documents, and either → a scan result.
 *
 * Pure. Everything that touches Mongo or Shopify lives somewhere else, because
 * this is where the `posOnly` decision is made and that decision is what says
 * whether a new size gets its own variant or is pooled into an existing one
 * (§3). It is worth being able to test without a store.
 */

/** Shopify's own name for the channel. The GID is the real check; this is the fallback. */
const POS_PUBLICATION_NAME = "point of sale";

export interface MirrorContext {
  /** `SHOPIFY_LOCATION_ID` — the one stockroom. Never chosen in the UI. */
  locationId: string;
  /** `SHOPIFY_POS_PUBLICATION_ID`. Matching by GID beats matching by a name. */
  posPublicationId?: string;
}

/**
 * True when nothing but Point of Sale can see this product.
 *
 * A product published nowhere at all counts as POS-only: it is not visible to a
 * customer, which is the question §3 actually asks. Note that this is the
 * *permissive* side of the variant rule — a wrong `true` here pools stock that
 * should have been split — so the GID comparison is preferred and the name is
 * only reached when the caller has no publication id configured.
 */
export function isPosOnly(
  publications: readonly { id: string; name: string }[],
  posPublicationId?: string,
): boolean {
  return publications.every((publication) =>
    posPublicationId === undefined
      ? publication.name.trim().toLowerCase() === POS_PUBLICATION_NAME
      : publication.id === posPublicationId,
  );
}

/** `{ Size: 'Large' }`, ignoring the placeholder Shopify gives an optionless variant. */
export function optionValuesOf(variant: CatalogVariant): Record<string, string> {
  const values: Record<string, string> = {};
  for (const option of variant.selectedOptions) {
    if (option.name === "Title" && option.value === "Default Title") continue;
    values[option.name] = option.value;
  }
  return values;
}

/** `Large / Red`, or empty for a product that has no options yet. */
export function optionLabelOf(values: Record<string, string>): string {
  return Object.values(values).join(" / ");
}

/**
 * One mirror document per variant.
 *
 * `barcode` is omitted rather than stored empty when the variant has none: the
 * lookup index is on that field, and a run of empty strings would collect every
 * barcode-less variant in the catalogue under one key.
 *
 * Every document goes through the schema on the way out. That is not belt and
 * braces — it is what normalises `"12.5"` to `"12.50"`, and the variant rule in
 * §3 turns on whether a price *differs* from its siblings. Two spellings of the
 * same money would create a variant for nothing.
 */
export function toMirrorDocuments(
  product: CatalogProduct,
  context: MirrorContext,
  syncedAt: Date = new Date(),
): ProductMirror[] {
  const publications = product.publications.map((publication) => publication.name);
  const posOnly = isPosOnly(product.publications, context.posPublicationId);
  // A product always has at least the variant we are looking at, whatever the
  // count field claims — the schema requires a positive number.
  const variantCount = Math.max(product.variantCount, product.variants.length, 1);

  return product.variants.map((variant) => {
    const barcode = normaliseBarcode(variant.barcode);

    return productMirrorSchema.parse({
      shopifyProductId: product.id,
      shopifyVariantId: variant.id,
      ...(barcode.digits === "" ? {} : { barcode: barcode.digits }),
      ...(variant.barcode === null || variant.barcode === ""
        ? {}
        : { barcodeRaw: variant.barcode }),
      ...(variant.sku === null || variant.sku === "" ? {} : { sku: variant.sku }),
      title: product.title,
      ...(product.vendor === null || product.vendor === "" ? {} : { vendor: product.vendor }),
      ...(product.productType === null || product.productType === ""
        ? {}
        : { productType: product.productType }),
      optionNames: product.optionNames,
      optionValues: optionValuesOf(variant),
      variantCount,
      publications,
      posOnly,
      /**
       * Only the generator sets this, at commit 14. A backfill or a webhook
       * re-read has no way to tell a minted code from a printed one, so it
       * says false — and the in-store `021…` prefix is how we can still find
       * them if this is ever needed before then.
       */
      barcodeGenerated: false,
      price: variant.price,
      inventoryItemId: variant.inventoryItemId,
      tracked: variant.tracked,
      inventoryQty: variant.available,
      locationId: context.locationId,
      status: product.status,
      ...(product.imageUrl === null ? {} : { imageUrl: product.imageUrl }),
      updatedAtShopify: product.updatedAt,
      syncedAt,
    });
  });
}

function variantMatchOf(variant: CatalogVariant): VariantMatch {
  const optionValues = optionValuesOf(variant);
  return {
    variantId: variant.id,
    barcode: variant.barcode === null || variant.barcode === "" ? null : variant.barcode,
    sku: variant.sku === null || variant.sku === "" ? null : variant.sku,
    price: variant.price,
    optionValues,
    optionLabel: optionLabelOf(optionValues),
    inventoryItemId: variant.inventoryItemId,
    tracked: variant.tracked,
    available: variant.available,
  };
}

/** The live answer: a product and the variants on it that carried the barcode. */
export function toProductMatch(product: CatalogProduct, context: MirrorContext): ProductMatch {
  return {
    productId: product.id,
    title: product.title,
    status: product.status,
    vendor: product.vendor === null || product.vendor === "" ? null : product.vendor,
    productType:
      product.productType === null || product.productType === "" ? null : product.productType,
    optionNames: product.optionNames,
    publications: product.publications.map((publication) => publication.name),
    posOnly: isPosOnly(product.publications, context.posPublicationId),
    variantCount: Math.max(product.variantCount, product.variants.length, 1),
    imageUrl: product.imageUrl,
    variants: product.variants.map(variantMatchOf),
  };
}

/**
 * The cached answer: mirror rows, grouped back into products.
 *
 * Same type as the live path returns, so the scan screen paints from the mirror
 * and then replaces it with the live result without re-deriving anything. Rows
 * come from one `$in` query, so grouping happens here rather than as an
 * aggregation — the whole point is that the cached half is a single indexed
 * read and nothing more.
 */
export function groupMirrorRows(rows: readonly ProductMirror[]): ProductMatch[] {
  const byProduct = new Map<string, ProductMatch>();

  for (const row of rows) {
    let match = byProduct.get(row.shopifyProductId);
    if (match === undefined) {
      match = {
        productId: row.shopifyProductId,
        title: row.title,
        status: row.status,
        vendor: row.vendor ?? null,
        productType: row.productType ?? null,
        optionNames: row.optionNames,
        publications: row.publications,
        posOnly: row.posOnly,
        variantCount: row.variantCount,
        imageUrl: row.imageUrl ?? null,
        variants: [],
      };
      byProduct.set(row.shopifyProductId, match);
    }

    match.variants.push({
      variantId: row.shopifyVariantId,
      barcode: row.barcode ?? null,
      sku: row.sku ?? null,
      price: row.price,
      optionValues: row.optionValues,
      optionLabel: optionLabelOf(row.optionValues),
      inventoryItemId: row.inventoryItemId,
      tracked: row.tracked,
      available: row.inventoryQty,
    });
  }

  return [...byProduct.values()];
}
