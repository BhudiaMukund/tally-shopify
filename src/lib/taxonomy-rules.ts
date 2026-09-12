import type { TaxonomyKey, TaxonomyValue } from "@/lib/db/schemas/taxonomy";

/**
 * Local corrections to the store's own vocabulary.
 *
 * The catalogue has near-duplicates — `Candle` and `Candles` are both live —
 * and fixing them in Shopify means touching products. This file lets the two
 * be merged for the AI's purposes without editing the store, and it is rules,
 * not data: no product, price or barcode appears here, so it is safe in a
 * public repo (§11).
 *
 * Aliases are matched case-insensitively and the canonical spelling on the
 * right is what gets written.
 */

export interface TaxonomyRuleSet {
  /** Written as `wrong: right`. Both sides are values, not ids. */
  aliases?: Record<string, string>;
  /** Values to drop entirely — junk that is not worth offering the AI. */
  drop?: readonly string[];
}

export const taxonomyRules: Partial<Record<TaxonomyKey, TaxonomyRuleSet>> = {
  productType: {
    aliases: {
      Candles: "Candle",
    },
  },
};

/**
 * Applies the rules for one set, summing the counts of anything merged.
 *
 * Merging has to add the counts rather than keep the larger: the whole point
 * of the frequency number is to separate a real category from a typo, and
 * `Candle` 40 + `Candles` 2 is one category used 42 times, not one used 40 and
 * a mistake used twice.
 */
export function applyTaxonomyRules(
  key: TaxonomyKey,
  values: readonly TaxonomyValue[],
): TaxonomyValue[] {
  const rules = taxonomyRules[key];
  const dropped = new Set((rules?.drop ?? []).map((value) => value.toLowerCase()));
  const aliases = new Map(
    Object.entries(rules?.aliases ?? {}).map(([from, to]) => [from.toLowerCase(), to]),
  );

  const merged = new Map<string, TaxonomyValue>();

  for (const entry of values) {
    const trimmed = entry.value.trim();
    if (trimmed === "") continue;
    if (dropped.has(trimmed.toLowerCase())) continue;

    const canonical = aliases.get(trimmed.toLowerCase()) ?? trimmed;
    const existing = merged.get(canonical.toLowerCase());

    if (existing === undefined)
      merged.set(canonical.toLowerCase(), { value: canonical, count: entry.count });
    else existing.count += entry.count;
  }

  // Most-used first: the sync report reads top-down, and the tail is where the
  // typos are.
  return [...merged.values()].sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

/** A value this rare is more likely a typo than a category (BUILD_PLAN §2). */
export const RARE_VALUE_THRESHOLD = 3;

export function rareValues(values: readonly TaxonomyValue[]): TaxonomyValue[] {
  return values.filter((entry) => entry.count < RARE_VALUE_THRESHOLD);
}
