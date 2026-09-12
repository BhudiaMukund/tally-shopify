import type { LookupProduct, LookupVariant } from "./lookup-client";

/**
 * The canonical shape a scan resolves to, made explicit and enforced rather
 * than assumed.
 *
 * `/api/lookup` already returns `products` grouped by product — this exists
 * so the branch decision in `ScanResult` is made off a *checked invariant*
 * (dedupe every variant by `variantId`, regroup by `productId`) instead of
 * trusting a response's `.length` at face value. That distinction mattered in
 * practice: a bug in the cached-only phase once answered with an empty
 * product list, and the branch decision froze on that wrong snapshot before
 * the correct one arrived (see `lookup.test.ts` for the reproduction).
 *
 * When the same `variantId` appears more than once across the inputs, later
 * arguments win — pass the cached answer first and the live one last so a
 * fresher read for the same variant replaces the stale one rather than
 * sitting beside it.
 */
export function reconcileProducts(
  ...sources: readonly (readonly LookupProduct[])[]
): LookupProduct[] {
  const byVariant = new Map<
    string,
    { productId: string; product: Omit<LookupProduct, "variants">; variant: LookupVariant }
  >();

  for (const products of sources) {
    for (const product of products) {
      const { variants, ...rest } = product;
      for (const variant of variants) {
        byVariant.set(variant.variantId, { productId: product.productId, product: rest, variant });
      }
    }
  }

  const byProduct = new Map<string, LookupProduct>();
  for (const { productId, product, variant } of byVariant.values()) {
    const existing = byProduct.get(productId);
    if (existing === undefined) {
      byProduct.set(productId, { ...product, productId, variants: [variant] });
    } else {
      existing.variants.push(variant);
    }
  }

  return [...byProduct.values()];
}

/** Distinct products — never a raw response's `.length`, which duplicate rows would inflate. */
export function distinctProductCount(products: readonly LookupProduct[]): number {
  return new Set(products.map((product) => product.productId)).size;
}

/** Every matched variant across every product, deduped by `variantId`. */
export function distinctVariantCount(products: readonly LookupProduct[]): number {
  return new Set(
    products.flatMap((product) => product.variants.map((variant) => variant.variantId)),
  ).size;
}
