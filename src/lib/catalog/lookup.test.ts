import { describe, expect, it } from "vitest";

import { settleLookup, type BarcodeLookup, type LiveResult } from "./lookup";
import type { ProductMatch } from "./types";

/**
 * Reproduces the bug reported from `/scan`: a single-variant product
 * ("Confetti 15gms (Pack of 2)") showed the product chooser with exactly one
 * entry and never reached the count screen.
 *
 * Root cause: `cachedOnly` mode resolves `live` to a placeholder
 * `{ ok: true, products: [] }` so the caller doesn't wait on Shopify — but
 * `settleLookup` read `live.ok` alone to decide which answer to act on, and
 * `ok: true` there means "we didn't ask", not "Shopify confirmed zero
 * matches". Every cached-only answer came back as an empty catalogue
 * regardless of what the mirror actually held. `ScanResult`'s branch decision
 * is computed once, on mount, from whichever answer lands first — so the
 * empty cached-only answer froze the screen on "more than one product" (zero
 * is not one) before the correct, single-product live answer ever had a
 * chance to matter.
 */

const CONFETTI: ProductMatch = {
  productId: "gid://shopify/Product/9001",
  title: "Confetti 15gms (Pack of 2)",
  status: "ACTIVE",
  vendor: "Party Co",
  productType: "Confetti",
  optionNames: [],
  publications: ["Point of Sale"],
  posOnly: true,
  variantCount: 1,
  imageUrl: null,
  variants: [
    {
      variantId: "gid://shopify/ProductVariant/9101",
      barcode: "9312345678907",
      sku: "CONF-15G-2PK",
      price: "4.50",
      optionValues: {},
      optionLabel: "",
      inventoryItemId: "gid://shopify/InventoryItem/9201",
      tracked: true,
      available: 24,
    },
  ],
};

function cachedOnlyLookup(cached: ProductMatch[]): BarcodeLookup {
  return {
    raw: "9312345678907",
    barcode: "9312345678907",
    wellFormed: true,
    checkDigitOk: true,
    cached,
    pending: [],
    // The literal placeholder `lookupByBarcode` resolves to when it skips
    // Shopify — this is the real shape the cached-only phase produces, not a
    // simplified stand-in for it.
    live: Promise.resolve<LiveResult>({ ok: true, products: [], ms: 0 }),
    cachedOnly: true,
    cachedMs: 2,
  };
}

function fullLookup(cached: ProductMatch[], live: ProductMatch[]): BarcodeLookup {
  return {
    raw: "9312345678907",
    barcode: "9312345678907",
    wellFormed: true,
    checkDigitOk: true,
    cached,
    pending: [],
    live: Promise.resolve<LiveResult>({ ok: true, products: live, ms: 430 }),
    cachedOnly: false,
    cachedMs: 2,
  };
}

describe("settleLookup — cached-only phase", () => {
  it("answers from the mirror rather than an unconsulted Shopify", async () => {
    const settled = await settleLookup(cachedOnlyLookup([CONFETTI]));
    expect(settled.products).toEqual([CONFETTI]);
    expect(settled.state).toBe("match");
  });

  it("still answers 'new' when the mirror genuinely has nothing", async () => {
    const settled = await settleLookup(cachedOnlyLookup([]));
    expect(settled.products).toEqual([]);
    expect(settled.state).toBe("new");
  });
});

describe("settleLookup — full phase", () => {
  it("prefers the live answer over the mirror when Shopify confirms it", async () => {
    const settled = await settleLookup(fullLookup([CONFETTI], [CONFETTI]));
    expect(settled.products).toEqual([CONFETTI]);
  });

  it("falls back to the mirror when the live call itself failed", async () => {
    const lookup = fullLookup([CONFETTI], []);
    lookup.live = Promise.resolve({ ok: false, error: "timeout", ms: 900 });
    const settled = await settleLookup(lookup);
    expect(settled.products).toEqual([CONFETTI]);
  });
});

describe("settleLookup — both phases of one scan, reconciled", () => {
  it("a single-variant product scanned through both fetch phases yields exactly one match", async () => {
    const cachedPhase = await settleLookup(cachedOnlyLookup([CONFETTI]));
    const fullPhase = await settleLookup(fullLookup([CONFETTI], [CONFETTI]));

    for (const settled of [cachedPhase, fullPhase]) {
      expect(settled.products).toHaveLength(1);
      expect(settled.products[0]?.variants).toHaveLength(1);
      expect(settled.state).toBe("match");
    }
  });
});
