import type { TaxonomyKey, TaxonomyValue } from "@/lib/db/schemas/taxonomy";

/**
 * Turning a bulk-operation JSONL stream into distinct value counts.
 *
 * Separated from the script so the counting can be tested against fixture
 * lines — this is where a miscount silently teaches the AI the wrong
 * vocabulary, and the whole point of the taxonomy is that it cannot invent one
 * (CLAUDE.md §12).
 */

/**
 * Two connections (`products`, `metafields`) and two levels — inside the bulk
 * limits of five connections and two levels of nesting.
 *
 * https://shopify.dev/docs/api/usage/bulk-operations/queries
 */
export const PRODUCT_TAXONOMY_BULK_QUERY = `
{
  products {
    edges {
      node {
        id
        productType
        vendor
        category { name }
        options { name }
        metafields(first: 25, namespace: "shopify") {
          edges { node { key value type } }
        }
      }
    }
  }
}
`;

/** Which `shopify.*` metafield feeds which taxonomy set. */
export const METAFIELD_TAXONOMY_KEYS: Readonly<Record<string, TaxonomyKey>> = {
  "color-pattern": "color",
  "celebration-type": "celebrationType",
  "package-type": "packageType",
  "product-form": "productForm",
  "recommended-age-group": "recommendedAgeGroup",
  "balloon-shape": "balloonShape",
};

/**
 * A metaobject reference, e.g. `gid://shopify/Metaobject/123`.
 *
 * Shopify's standard taxonomy metafields often store references rather than
 * labels. A GID is useless as an AI enum — "pick one of gid://…" — so these
 * are counted separately and reported, rather than written into the taxonomy
 * as if they were words.
 */
const GID = /^gid:\/\/shopify\//;

export interface AggregateResult {
  values: Partial<Record<TaxonomyKey, TaxonomyValue[]>>;
  /** Products seen. Sizes the run and catches a truncated download. */
  productCount: number;
  /** Metafield values skipped for being references, by taxonomy key. */
  referenceOnly: Partial<Record<TaxonomyKey, number>>;
}

interface ProductLine {
  id?: unknown;
  productType?: unknown;
  vendor?: unknown;
  category?: { name?: unknown } | null;
  options?: { name?: unknown }[];
}

interface MetafieldLine {
  __parentId?: unknown;
  key?: unknown;
  value?: unknown;
  type?: unknown;
}

function isProductLine(line: Record<string, unknown>): boolean {
  // Bulk output interleaves parents and children; a child carries __parentId.
  return typeof line.id === "string" && line.id.startsWith("gid://shopify/Product/");
}

/**
 * A metafield value may be a scalar or a JSON array (a `list.*` type).
 * Both shapes yield zero or more strings.
 */
function metafieldValues(raw: unknown): string[] {
  if (typeof raw !== "string" || raw === "") return [];
  if (raw.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter((value): value is string => typeof value === "string");
      }
    } catch {
      // Not JSON after all; fall through and treat it as a plain value.
    }
  }
  return [raw];
}

export function createTaxonomyAccumulator() {
  const counts = new Map<TaxonomyKey, Map<string, number>>();
  const references = new Map<TaxonomyKey, number>();
  let productCount = 0;

  const bump = (key: TaxonomyKey, value: unknown): void => {
    if (typeof value !== "string") return;
    const trimmed = value.trim();
    if (trimmed === "") return;

    let set = counts.get(key);
    if (set === undefined) {
      set = new Map<string, number>();
      counts.set(key, set);
    }
    // Case-insensitive key, first-seen spelling wins — the merge rules in
    // taxonomy-rules.ts decide the canonical form afterwards.
    const existing = [...set.keys()].find((seen) => seen.toLowerCase() === trimmed.toLowerCase());
    const canonical = existing ?? trimmed;
    set.set(canonical, (set.get(canonical) ?? 0) + 1);
  };

  return {
    add(line: unknown): void {
      if (typeof line !== "object" || line === null) return;
      const record = line as Record<string, unknown>;

      if (isProductLine(record)) {
        const product = record as ProductLine;
        productCount += 1;
        bump("productType", product.productType);
        bump("vendor", product.vendor);
        bump("category", product.category?.name);
        for (const option of product.options ?? []) bump("optionName", option?.name);
        return;
      }

      const metafield = record as MetafieldLine;
      if (typeof metafield.key !== "string") return;

      const taxonomyKey = METAFIELD_TAXONOMY_KEYS[metafield.key];
      if (taxonomyKey === undefined) return;

      for (const value of metafieldValues(metafield.value)) {
        if (GID.test(value)) {
          references.set(taxonomyKey, (references.get(taxonomyKey) ?? 0) + 1);
          continue;
        }
        bump(taxonomyKey, value);
      }
    },

    result(): AggregateResult {
      const values: Partial<Record<TaxonomyKey, TaxonomyValue[]>> = {};
      for (const [key, set] of counts) {
        values[key] = [...set.entries()].map(([value, count]) => ({ value, count }));
      }
      const referenceOnly: Partial<Record<TaxonomyKey, number>> = {};
      for (const [key, count] of references) referenceOnly[key] = count;

      return { values, productCount, referenceOnly };
    },
  };
}

/** Parses a JSONL chunk into lines, skipping blanks. Exported for the tests. */
export function parseJsonl(text: string): unknown[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as unknown);
}
