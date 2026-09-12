/**
 * The browser's-eye view of `GET /api/lookup`.
 *
 * Deliberately its own types rather than `import type` from
 * `src/lib/catalog/lookup.ts` or `src/lib/catalog/types.ts` — those modules
 * (transitively) reach the `mongodb` driver, and the scan route's whole own-code
 * budget is 40KB gzipped. A type-only import is supposed to erase at build
 * time, but a JSON contract this small is cheaper to restate than to audit
 * every consuming file for a stray value import that would defeat that.
 */

export interface LookupVariant {
  variantId: string;
  barcode: string | null;
  sku: string | null;
  price: string;
  optionValues: Record<string, string>;
  optionLabel: string;
  inventoryItemId: string;
  tracked: boolean;
  available: number | null;
}

export interface LookupProduct {
  productId: string;
  title: string;
  status: string;
  vendor: string | null;
  productType: string | null;
  optionNames: string[];
  publications: string[];
  posOnly: boolean;
  variantCount: number;
  imageUrl: string | null;
  variants: LookupVariant[];
}

export interface LookupPendingParent {
  productId: string;
  productTitle: string;
  optionName: string;
  optionValue: string;
}

export interface LookupPending {
  draftId: string;
  kind: "new_product" | "new_variant";
  status: string;
  barcode: string;
  price: string;
  imageUrl: string | null;
  imageCount: number;
  countedQty: number;
  capturedAt: string;
  capturedBy: string;
  siblingOf: string | null;
  parent: LookupPendingParent | null;
  error: { message: string; step: string | null; at: string } | null;
}

export type LookupState = "invalid" | "match" | "pending" | "new";

export interface LookupResponse {
  raw: string;
  barcode: string;
  wellFormed: boolean;
  checkDigitOk: boolean;
  state: LookupState;
  products: LookupProduct[];
  pending: LookupPending[];
  live: { ok: true } | { ok: false; error: string };
  cachedOnly: boolean;
}

export class LookupRequestError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "LookupRequestError";
    this.status = status;
  }
}

export async function fetchLookup(
  barcode: string,
  options: { cachedOnly?: boolean; signal?: AbortSignal } = {},
): Promise<LookupResponse> {
  const params = new URLSearchParams({ barcode });
  if (options.cachedOnly === true) params.set("cachedOnly", "1");

  const response = await fetch(`/api/lookup?${params.toString()}`, { signal: options.signal });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new LookupRequestError(response.status, body?.message ?? "Lookup failed");
  }
  return (await response.json()) as LookupResponse;
}

/** Every variant across every matched product, flattened — for "is this ambiguous" checks. */
export function allVariants(products: readonly LookupProduct[]): LookupVariant[] {
  return products.flatMap((product) => product.variants);
}
