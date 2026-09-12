import { z } from "zod";

import { barcodeDigits, gid, money } from "./common";

/**
 * `products_mirror` — a local copy of Shopify, one document per **variant**,
 * kept fresh by webhooks.
 *
 * It is a cache and nothing else. Never write to Shopify from it, and never
 * read a quantity from it to compute a new one (CLAUDE.md §1). It exists so the
 * scan screen can paint in single-digit milliseconds while the live
 * `productVariants(query: "barcode:…")` call is still in flight.
 */

export const productStatus = z.enum(["ACTIVE", "ARCHIVED", "DRAFT"]);
export type ProductStatus = z.infer<typeof productStatus>;

export const productMirrorSchema = z.object({
  shopifyProductId: gid("Product"),
  shopifyVariantId: gid("ProductVariant"),

  /**
   * Digits only. **Not unique** — one printed code legitimately covers a whole
   * size run, so lookup returns a set (CLAUDE.md §2). Optional because the
   * catalogue still contains variants with no barcode at all.
   */
  barcode: barcodeDigits.optional(),
  /** Exactly what Shopify holds, apostrophes and all, for the audit report. */
  barcodeRaw: z.string().optional(),

  sku: z.string().optional(),
  /** The product title. Variant identity lives in `optionValues`. */
  title: z.string(),
  vendor: z.string().optional(),
  productType: z.string().optional(),

  /** Product-level option names, e.g. `['Size']`, or `[]` for a single-variant product. */
  optionNames: z.array(z.string()),
  /** This variant's values, e.g. `{ Size: 'Large' }`. Empty while it is still `Default Title`. */
  optionValues: z.record(z.string(), z.string()),
  /** How many variants the parent product has, including this one. */
  variantCount: z.number().int().positive(),

  /** Publication names the parent is published to, e.g. `['Point of Sale']`. */
  publications: z.array(z.string()),
  /** Derived from `publications`. Drives the create-a-variant decision in §3. */
  posOnly: z.boolean(),
  /** True when Tally minted this barcode itself, so the label still has to be printed. */
  barcodeGenerated: z.boolean(),

  price: money,
  inventoryItemId: gid("InventoryItem"),
  /**
   * Whether Shopify is tracking this item. Almost nothing in this catalogue is,
   * which is why every inventory write ensures it first (CLAUDE.md §7). Cached
   * for reporting only — the write path re-reads it live.
   */
  tracked: z.boolean(),
  /** Available at `locationId`. Null when the item is untracked or not stocked there. */
  inventoryQty: z.number().int().nullable(),
  locationId: gid("Location"),

  status: productStatus,
  imageUrl: z.url().optional(),

  /** Shopify's own `updatedAt`, used to drop a webhook that arrives out of order. */
  updatedAtShopify: z.date(),
  /** When Tally last wrote this document. */
  syncedAt: z.date(),
});

export type ProductMirror = z.infer<typeof productMirrorSchema>;
