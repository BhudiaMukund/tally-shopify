import { z } from "zod";

/**
 * `taxonomy` — the enum lists the AI is allowed to pick from, derived live from
 * Shopify by `pnpm taxonomy:sync` (commit 5). This is what stops the model
 * inventing a category label (CLAUDE.md §12): it can only choose values the
 * store already uses.
 *
 * One document per set, keyed by `_id`, replaced atomically on every sync —
 * never appended to, or a product type you deleted in Shopify would live on
 * here forever.
 */

/**
 * §2 names the first six. The remaining four are the `shopify.*` metafields the
 * enrichment prompt fills (§7.1): they need allowed values for the same reason
 * `productType` does, and the same `metafieldDefinitions` query already returns
 * them.
 */
export const taxonomyKey = z.enum([
  "productType",
  "vendor",
  "category",
  "color",
  "celebrationType",
  "optionName",
  "packageType",
  "productForm",
  "recommendedAgeGroup",
  "balloonShape",
]);
export type TaxonomyKey = z.infer<typeof taxonomyKey>;

export const taxonomyValueSchema = z.object({
  value: z.string().min(1),
  /**
   * How many products use it. Ranking by frequency is what separates a real
   * category from a typo — the sync flags anything under three uses.
   */
  count: z.number().int().nonnegative(),
});
export type TaxonomyValue = z.infer<typeof taxonomyValueSchema>;

export const taxonomySchema = z.object({
  /** The set name, not an ObjectId — there is exactly one document per key. */
  _id: taxonomyKey,
  values: z.array(taxonomyValueSchema),
  /** When this set was last derived from the live catalogue. */
  sourcedAt: z.date(),
  /** Products scanned to produce it, so a truncated bulk run is visible. */
  productCount: z.number().int().nonnegative(),
});

export type Taxonomy = z.infer<typeof taxonomySchema>;
