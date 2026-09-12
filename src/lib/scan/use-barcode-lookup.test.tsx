// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LookupProduct } from "./lookup-client";
import { distinctProductCount, distinctVariantCount } from "./reconcile-matches";
import { useBarcodeLookup } from "./use-barcode-lookup";

/**
 * Drives the real hook against mocked `fetch` responses shaped exactly like
 * `GET /api/lookup` sends — the cached-only phase and the full phase are two
 * genuinely separate HTTP round trips in production, and this is what
 * "scanned twice through both fetch phases" means concretely.
 */

const CONFETTI: LookupProduct = {
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

function responseBody(products: LookupProduct[], cachedOnly: boolean) {
  return {
    raw: "9312345678907",
    barcode: "9312345678907",
    wellFormed: true,
    checkDigitOk: true,
    state: products.length > 0 ? "match" : "new",
    products,
    pending: [],
    live: { ok: true },
    cachedOnly,
  };
}

function jsonResponse(body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useBarcodeLookup — both fetch phases of one scan", () => {
  it("a single-variant product scanned through both phases yields exactly one match", async () => {
    const fetchMock = vi.fn((input: string | URL) => {
      const url = new URL(String(input), "http://localhost");
      const cachedOnly = url.searchParams.get("cachedOnly") === "1";
      // The real route: the mirror already has this product, and Shopify
      // confirms the same thing a few hundred ms later.
      return jsonResponse(responseBody([CONFETTI], cachedOnly));
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useBarcodeLookup());

    act(() => result.current.lookup("9312345678907"));

    await waitFor(() => expect(result.current.state.phase).toBe("ready"));
    await waitFor(() => expect(result.current.state.reconciling).toBe(false));

    expect(fetchMock).toHaveBeenCalledTimes(2);

    const products = result.current.state.data?.products ?? [];
    expect(distinctProductCount(products)).toBe(1);
    expect(distinctVariantCount(products)).toBe(1);
    expect(products).toHaveLength(1);
  });

  it("does not let a slower cached-only reply overwrite the live answer that already landed", async () => {
    let resolveCachedOnly!: () => void;
    const fetchMock = vi.fn((input: string | URL) => {
      const url = new URL(String(input), "http://localhost");
      const cachedOnly = url.searchParams.get("cachedOnly") === "1";
      if (cachedOnly) {
        return new Promise<Response>((resolve) => {
          resolveCachedOnly = () =>
            resolve(new Response(JSON.stringify(responseBody([], true)), { status: 200 }));
        });
      }
      return jsonResponse(responseBody([CONFETTI], false));
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useBarcodeLookup());
    act(() => result.current.lookup("9312345678907"));

    // The full phase lands first. `reconciling` is `false` in the "loading"
    // phase too, so `phase` is what actually distinguishes "answered" here.
    await waitFor(() => expect(result.current.state.phase).toBe("ready"));
    expect(result.current.state.reconciling).toBe(false);
    expect(result.current.state.data?.products).toHaveLength(1);

    // The slow cached-only reply — carrying the wrong, empty answer — arrives late.
    await act(async () => {
      resolveCachedOnly();
      await Promise.resolve();
    });

    expect(result.current.state.data?.products).toHaveLength(1);
    expect(result.current.state.reconciling).toBe(false);
  });
});
