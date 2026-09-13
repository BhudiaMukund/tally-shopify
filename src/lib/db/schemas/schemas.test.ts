import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";

import { barcodeDigits, gtin, money, objectId } from "./common";
import {
  draftSchema,
  pendingDraftStatuses,
  productEditsSchema,
  writablePendingDraftStatuses,
} from "./drafts";
import { inventoryEventSchema } from "./inventory-events";
import { productMirrorSchema } from "./products-mirror";
import { userSchema } from "./users";

/**
 * These cover the shapes that corrupt data silently rather than loudly: a price
 * that compares unequal to itself, a barcode that isn't digits, a variant draft
 * with nothing to attach to.
 *
 * Barcodes here are synthetic (CLAUDE.md — this repo is public).
 */

const SYNTHETIC_EAN13 = "0123456789012";
const SYNTHETIC_VARIANT = "gid://shopify/ProductVariant/1";
const SYNTHETIC_PRODUCT = "gid://shopify/Product/1";
const SYNTHETIC_ITEM = "gid://shopify/InventoryItem/1";
const SYNTHETIC_LOCATION = "gid://shopify/Location/1";
const SCAN_ID = "3f1a9c4e-0b22-4f4a-9d6b-1c5e2a7d8f90";

describe("money", () => {
  it("normalises to two places so the same price compares equal", () => {
    // §3 creates a variant when the price *differs* from its siblings. These
    // three are the same money; a raw string comparison says otherwise.
    expect(money.parse("12.5")).toBe("12.50");
    expect(money.parse("12.50")).toBe("12.50");
    expect(money.parse("12")).toBe("12.00");
  });

  it("rejects anything that isn't a plain decimal amount", () => {
    for (const value of ["$12.50", "12.505", "-1.00", "1,200.00", "", "12.5e1"]) {
      expect(money.safeParse(value).success).toBe(false);
    }
  });
});

describe("barcodeDigits", () => {
  it("takes digits of any length, because the catalogue contains junk to audit", () => {
    expect(barcodeDigits.parse(SYNTHETIC_EAN13)).toBe(SYNTHETIC_EAN13);
    expect(barcodeDigits.safeParse("123456").success).toBe(true);
  });

  it("rejects an un-normalised barcode rather than storing one", () => {
    // The leading apostrophe is what a spreadsheet round-trip leaves behind.
    expect(barcodeDigits.safeParse(`'${SYNTHETIC_EAN13}`).success).toBe(false);
    expect(barcodeDigits.safeParse(" 0123456789012 ").success).toBe(false);
  });
});

describe("gtin", () => {
  it("holds a code Tally assigns to a legal GTIN length", () => {
    expect(gtin.safeParse("0210000000017").success).toBe(true); // 13
    expect(gtin.safeParse("12345678").success).toBe(true);
    // 9 and 11 digits are the malformed lengths already in the catalogue.
    expect(gtin.safeParse("123456789").success).toBe(false);
    expect(gtin.safeParse("12345678901").success).toBe(false);
  });
});

describe("objectId", () => {
  it("accepts an ObjectId without the schema importing the driver", () => {
    expect(objectId.safeParse(new ObjectId()).success).toBe(true);
    expect(objectId.safeParse(new ObjectId().toHexString()).success).toBe(false);
  });
});

describe("productMirrorSchema", () => {
  function mirror(): Record<string, unknown> {
    return {
      shopifyProductId: SYNTHETIC_PRODUCT,
      shopifyVariantId: SYNTHETIC_VARIANT,
      barcode: SYNTHETIC_EAN13,
      barcodeRaw: `'${SYNTHETIC_EAN13}`,
      title: "Balloon Weight",
      optionNames: ["Size"],
      optionValues: { Size: "Large" },
      variantCount: 2,
      publications: ["Point of Sale"],
      posOnly: true,
      barcodeGenerated: false,
      price: "4.5",
      inventoryItemId: SYNTHETIC_ITEM,
      tracked: false,
      inventoryQty: null,
      locationId: SYNTHETIC_LOCATION,
      status: "ACTIVE",
      updatedAtShopify: new Date(),
      syncedAt: new Date(),
    };
  }

  it("accepts a variant that is untracked and unbarcoded — most of them are", () => {
    const parsed = productMirrorSchema.parse({
      ...mirror(),
      barcode: undefined,
      barcodeRaw: undefined,
    });
    expect(parsed.inventoryQty).toBeNull();
    expect(parsed.price).toBe("4.50");
  });

  it("rejects an id that isn't a GID for the right resource", () => {
    expect(productMirrorSchema.safeParse({ ...mirror(), shopifyVariantId: "12345" }).success).toBe(
      false,
    );
    expect(
      productMirrorSchema.safeParse({ ...mirror(), shopifyVariantId: SYNTHETIC_PRODUCT }).success,
    ).toBe(false);
  });
});

describe("draftSchema", () => {
  function base(): Record<string, unknown> {
    return {
      scanId: SCAN_ID,
      barcode: SYNTHETIC_EAN13,
      barcodeRaw: SYNTHETIC_EAN13,
      price: "4.50",
      capturedBy: new ObjectId(),
      capturedAt: new Date(),
      deviceId: "pixel-7a",
      status: "queued",
      updatedAt: new Date(),
    };
  }

  const parent = {
    productId: SYNTHETIC_PRODUCT,
    productTitle: "Gift Box",
    posOnly: true,
    optionName: "Size",
    optionValue: "Large",
    existingVariantNeedsValue: true,
  };

  it("defaults the fields the phone does not send", () => {
    const draft = draftSchema.parse({ ...base(), kind: "new_product" });
    expect(draft.counts).toEqual([]);
    expect(draft.images).toEqual([]);
    expect(draft.attempts).toBe(0);
    expect(draft.labelPrinted).toBe(false);
  });

  it("will not accept a variant draft with no parent to attach to", () => {
    // Publishing this would mean mutating a live product with nothing to say
    // which one, so it has to fail at the door rather than at the mutation.
    expect(draftSchema.safeParse({ ...base(), kind: "new_variant" }).success).toBe(false);
    expect(draftSchema.safeParse({ ...base(), kind: "new_variant", parent }).success).toBe(true);
  });

  it("keeps a parent off a new-product draft", () => {
    const draft = draftSchema.parse({ ...base(), kind: "new_product", parent });
    expect(draft).not.toHaveProperty("parent");
  });

  it("rejects an unknown kind rather than guessing one", () => {
    expect(draftSchema.safeParse({ ...base(), kind: "new_thing" }).success).toBe(false);
  });

  it("sums a repeated count instead of overwriting it", () => {
    const by = new ObjectId();
    const draft = draftSchema.parse({
      ...base(),
      kind: "new_product",
      counts: [
        { scanId: SCAN_ID, qty: 6, by, at: new Date() },
        { scanId: "9c2f7b10-4e5d-4a31-8f77-2b6d0e9a4c13", qty: 4, by, at: new Date() },
      ],
    });
    expect(draft.counts.reduce((total, count) => total + count.qty, 0)).toBe(10);
  });

  it("treats a rejected draft as pending, so the next scan shows the reason", () => {
    expect(pendingDraftStatuses).toContain("rejected");
    expect(pendingDraftStatuses).not.toContain("published");
    expect(pendingDraftStatuses).not.toContain("approved");
  });

  it("keeps rejected and failed pending for lookup but not writable", () => {
    // A rejected or failed draft is still *shown* on a scan (it's pending),
    // but it has its own action (recapture, retry) — add-to-count and
    // add-photos must not accept a write against either.
    expect(writablePendingDraftStatuses).not.toContain("rejected");
    expect(writablePendingDraftStatuses).not.toContain("failed");
    for (const status of writablePendingDraftStatuses) {
      expect(pendingDraftStatuses).toContain(status);
    }
  });

  it("accepts a variant draft with no option value yet — nothing has read the packaging at intake", () => {
    const draft = draftSchema.parse({
      ...base(),
      kind: "new_variant",
      parent: { ...parent, optionValue: null },
    });
    expect(draft.kind).toBe("new_variant");
    if (draft.kind === "new_variant") expect(draft.parent.optionValue).toBeNull();
  });

  it("round-trips a rejection, even though nothing writes one before commit 13", () => {
    const rejectedBy = new ObjectId();
    const draft = draftSchema.parse({
      ...base(),
      kind: "new_product",
      status: "rejected",
      rejectedBy,
      rejectedReason: "Blurry photos — recapture in better light.",
      rejectedAt: new Date(),
    });
    expect(draft.rejectedReason).toBe("Blurry photos — recapture in better light.");
  });
});

describe("productEditsSchema", () => {
  it("takes one field on its own — an admin fixing a title edits a title", () => {
    const edits = productEditsSchema.parse({ title: "Foil Balloon Gold 45cm" });
    expect(edits).toEqual({ title: "Foil Balloon Gold 45cm" });
  });

  it("holds admin edits apart from ai.* rather than merging them early", () => {
    // Hard rule 10: both survive to publish time.
    expect(productEditsSchema.safeParse({ confidence: 0.9 }).success).toBe(true);
    expect(productEditsSchema.parse({ confidence: 0.9 })).toEqual({});
  });
});

describe("inventoryEventSchema", () => {
  function event(): Record<string, unknown> {
    return {
      scanId: SCAN_ID,
      barcode: SYNTHETIC_EAN13,
      variantId: SYNTHETIC_VARIANT,
      inventoryItemId: SYNTHETIC_ITEM,
      locationId: SYNTHETIC_LOCATION,
      ambiguousBarcode: false,
      before: 12,
      mode: "set",
      actor: new ObjectId(),
      source: "scan",
      createdAt: new Date(),
    };
  }

  it("opens pending with no outcome, which is what the pre-write insert is", () => {
    const parsed = inventoryEventSchema.parse(event());
    expect(parsed.status).toBe("pending");
    expect(parsed.after).toBeNull();
    expect(parsed.chosenFrom).toEqual([]);
  });

  it("records a compareQuantity clash as its own outcome, not as a failure", () => {
    const parsed = inventoryEventSchema.parse({ ...event(), status: "conflict" });
    expect(parsed.status).toBe("conflict");
  });

  it("allows a null before, for an item that was never tracked", () => {
    expect(inventoryEventSchema.parse({ ...event(), before: null }).before).toBeNull();
  });
});

describe("userSchema", () => {
  it("lower-cases the email so the unique index can do its job", () => {
    const user = userSchema.parse({
      email: "Sam@Example.com",
      name: "Sam",
      passwordHash: "$argon2id$v=19$m=65536,t=3,p=4$not-a-real-hash",
      role: "staff",
      createdAt: new Date(),
    });
    expect(user.email).toBe("sam@example.com");
    expect(user.active).toBe(true);
  });

  it("rejects a role it does not know about", () => {
    expect(
      userSchema.safeParse({
        email: "sam@example.com",
        name: "Sam",
        passwordHash: "hash",
        role: "superadmin",
        createdAt: new Date(),
      }).success,
    ).toBe(false);
  });
});
