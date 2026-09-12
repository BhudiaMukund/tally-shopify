// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { LookupProduct, LookupResponse } from "@/lib/scan/lookup-client";

import { ScanResultSheet } from "./scan-result-sheet";

/**
 * The end-to-end reproduction of the reported bug: `/scan` showed the product
 * chooser with exactly one product listed and never reached the count screen
 * for a genuinely single-match barcode. This renders the real component tree
 * `ScanScreen` mounts — `ScanResultSheet` → `ScanResult` → `CountScreen` —
 * through the same prop transitions the hook produces (cached-only, empty,
 * `reconciling: true`, then the confirmed single match with
 * `reconciling: false`) and asserts the count screen, not the chooser, is
 * what's on screen at the end.
 */

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

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

function response(products: LookupProduct[], cachedOnly: boolean): LookupResponse {
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

describe("ScanResultSheet — a single-match scan across both fetch phases", () => {
  it("reaches the count screen rather than freezing on the product chooser", () => {
    const cachedOnlyAnswer = response([], true); // the exact bug: cached-only came back empty

    const { rerender } = render(
      <ScanResultSheet
        open
        onOpenChange={() => {}}
        lookup={cachedOnlyAnswer}
        error={null}
        reconciling
        onDone={() => {}}
      />,
    );

    // Still confirming — must not have committed to any branch yet.
    expect(screen.queryByText(/which one is this/i)).toBeNull();
    expect(screen.queryByText(/update stock/i)).toBeNull();

    rerender(
      <ScanResultSheet
        open
        onOpenChange={() => {}}
        lookup={response([CONFETTI], false)}
        error={null}
        reconciling={false}
        onDone={() => {}}
      />,
    );

    expect(screen.getByText("Confetti 15gms (Pack of 2)")).not.toBeNull();
    expect(screen.getByRole("button", { name: /update stock/i })).not.toBeNull();
    expect(screen.queryByText(/which one is this/i)).toBeNull();
  });
});
