import { describe, expect, it } from "vitest";

import { COLLECTIONS } from "./collections";
import { indexes, type TallyIndex } from "./indexes";

/**
 * The indexes in BUILD_PLAN §2 are not tuning — three of them are the only
 * thing making a retry safe. This asserts they are still declared, and still
 * declared the way the write paths assume, because losing one is invisible
 * until the day a phone submits the same scan twice.
 */

function find(collection: string, name: string): TallyIndex | undefined {
  return indexes.find((index) => index.collection === collection && index.name === name);
}

describe("index declarations", () => {
  it("declares every index BUILD_PLAN section 2 calls for", () => {
    const declared = indexes.map((index) => `${index.collection}.${JSON.stringify(index.key)}`);
    expect(declared).toEqual(
      expect.arrayContaining([
        `${COLLECTIONS.productsMirror}.{"barcode":1}`,
        `${COLLECTIONS.productsMirror}.{"shopifyVariantId":1}`,
        `${COLLECTIONS.productsMirror}.{"shopifyProductId":1}`,
        `${COLLECTIONS.productsMirror}.{"updatedAtShopify":-1}`,
        `${COLLECTIONS.drafts}.{"scanId":1}`,
        `${COLLECTIONS.drafts}.{"status":1,"capturedAt":-1}`,
        `${COLLECTIONS.drafts}.{"barcode":1}`,
        `${COLLECTIONS.inventoryEvents}.{"scanId":1}`,
      ]),
    );
  });

  it("keeps the idempotency keys unique", () => {
    // Without these an inventory retry applies the count twice and a resubmitted
    // capture becomes a second draft.
    expect(find(COLLECTIONS.inventoryEvents, "scanId_unique")?.unique).toBe(true);
    expect(find(COLLECTIONS.drafts, "scanId_unique")?.unique).toBe(true);
    expect(find(COLLECTIONS.productsMirror, "shopifyVariantId_unique")?.unique).toBe(true);
    expect(find(COLLECTIONS.users, "email_unique")?.unique).toBe(true);
  });

  it("leaves barcode lookups non-unique, in both collections", () => {
    // One printed code legitimately covers a size run (CLAUDE.md §2). A unique
    // index here would reject the second variant of a gift box.
    expect(find(COLLECTIONS.productsMirror, "barcode")?.unique).toBeUndefined();
    expect(find(COLLECTIONS.drafts, "barcode")?.unique).toBeUndefined();
  });

  it("names every index explicitly, and names each one once per collection", () => {
    const seen = new Set<string>();
    for (const index of indexes) {
      const key = `${index.collection}.${index.name}`;
      expect(index.name).not.toBe("");
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it("explains itself, so the next person knows what dropping one costs", () => {
    for (const index of indexes) expect(index.why.length).toBeGreaterThan(20);
  });
});
