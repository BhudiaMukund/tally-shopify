import { describe, expect, it } from "vitest";

import { intakeRequestSchema } from "./request";

/**
 * The discriminated union *is* the "re-validate kind on the server" step
 * (BUILD_PLAN §10) — these tests are about the shape being unforgeable, not
 * about barcode or price parsing, which already have their own coverage.
 */

const SCAN_ID = "3f1a9c4e-0b22-4f4a-9d6b-1c5e2a7d8f90";
const SYNTHETIC_PRODUCT = "gid://shopify/Product/1";

function image(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    key: "intake/abc.webp",
    url: "https://files.tally.example.com/intake/abc.webp",
    width: 1200,
    height: 1200,
    bytes: 204800,
    ...overrides,
  };
}

function base() {
  return {
    scanId: SCAN_ID,
    barcodeRaw: "9310720073156",
    price: "12.50",
    qty: 4,
    images: [image()],
    deviceId: "pixel-7a",
  };
}

describe("intakeRequestSchema", () => {
  it("accepts a well-formed new_product capture", () => {
    const parsed = intakeRequestSchema.safeParse({ ...base(), kind: "new_product" });
    expect(parsed.success).toBe(true);
  });

  it("accepts a well-formed new_variant capture", () => {
    const parsed = intakeRequestSchema.safeParse({
      ...base(),
      kind: "new_variant",
      parent: {
        productId: SYNTHETIC_PRODUCT,
        productTitle: "Gift Box",
        posOnly: true,
        optionName: "Size",
      },
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a new_variant capture with no parent to attach to", () => {
    const parsed = intakeRequestSchema.safeParse({ ...base(), kind: "new_variant" });
    expect(parsed.success).toBe(false);
  });

  it("rejects a malformed price", () => {
    const parsed = intakeRequestSchema.safeParse({
      ...base(),
      kind: "new_product",
      price: "twelve",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a capture with no photos — the hero has to exist", () => {
    const parsed = intakeRequestSchema.safeParse({ ...base(), kind: "new_product", images: [] });
    expect(parsed.success).toBe(false);
  });

  it("rejects an unknown kind rather than guessing one", () => {
    const parsed = intakeRequestSchema.safeParse({ ...base(), kind: "restock" });
    expect(parsed.success).toBe(false);
  });

  it("only accepts siblingOf on a new_product capture", () => {
    const parsed = intakeRequestSchema.safeParse({
      ...base(),
      kind: "new_product",
      siblingOf: "507f1f77bcf86cd799439011",
    });
    expect(parsed.success).toBe(true);
  });
});
