import type { ProductStatus } from "@/lib/db/schemas/products-mirror";

/**
 * One shape for a catalogue product, whatever it came from.
 *
 * Three sources feed the mirror and the scan screen — the live barcode query,
 * a `product(id:)` re-read after a webhook, and the bulk backfill's JSONL — and
 * they arrive in three different shapes. They are all mapped to `CatalogProduct`
 * on the way in, so `toMirrorDocuments` and `toProductMatch` exist once each
 * instead of three times, and so a field added to the mirror cannot be filled
 * in by one path and forgotten by another.
 */

export interface CatalogOptionValue {
  name: string;
  value: string;
}

export interface CatalogVariant {
  id: string;
  /** As Shopify holds it, apostrophes and all. Normalised at the boundary. */
  barcode: string | null;
  sku: string | null;
  price: string;
  selectedOptions: CatalogOptionValue[];
  inventoryItemId: string;
  tracked: boolean;
  /** Available at our location. Null when untracked or not stocked there. */
  available: number | null;
}

export interface CatalogPublication {
  id: string;
  name: string;
}

export interface CatalogProduct {
  id: string;
  title: string;
  status: ProductStatus;
  vendor: string | null;
  productType: string | null;
  optionNames: string[];
  /** Publications the product is actually published to. */
  publications: CatalogPublication[];
  /** Every variant the product has, not just the ones that matched a barcode. */
  variantCount: number;
  variants: CatalogVariant[];
  imageUrl: string | null;
  updatedAt: Date;
}

/**
 * What a scan resolves to.
 *
 * Grouped by product because one barcode legitimately covers a size run
 * (CLAUDE.md §2) — the scan screen shows a variant chooser under one product
 * heading, and a *second* product on the same barcode is the data error worth
 * logging.
 */
export interface VariantMatch {
  variantId: string;
  barcode: string | null;
  sku: string | null;
  price: string;
  /** `{ Size: 'Large' }`. Empty while the variant is still `Default Title`. */
  optionValues: Record<string, string>;
  /** `Large`, or `Large / Red`. Empty string for a single-variant product. */
  optionLabel: string;
  inventoryItemId: string;
  tracked: boolean;
  available: number | null;
}

export interface ProductMatch {
  productId: string;
  title: string;
  status: ProductStatus;
  vendor: string | null;
  productType: string | null;
  optionNames: string[];
  publications: string[];
  /** Not published beyond Point of Sale. Drives the create-a-variant rule in §3. */
  posOnly: boolean;
  /** Variants on the product, which may be more than matched this barcode. */
  variantCount: number;
  imageUrl: string | null;
  /** Only the variants carrying the scanned barcode, in catalogue order. */
  variants: VariantMatch[];
}
