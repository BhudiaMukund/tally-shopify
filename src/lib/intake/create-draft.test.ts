import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Draft } from "@/lib/db/schemas/drafts";
import type { ProductMirror } from "@/lib/db/schemas/products-mirror";

/**
 * Same style as `src/lib/inventory/apply.test.ts`: a minimal in-memory
 * collection stands in for Mongo, and every Shopify-adjacent side effect
 * (here, the queue) is mocked so the assertions are about idempotency and
 * shape, not wiring.
 */

const SCAN_ID = "3f1a9c4e-0b22-4f4a-9d6b-1c5e2a7d8f90";
const SYNTHETIC_PRODUCT = "gid://shopify/Product/1";

type DraftDoc = Draft & { _id: ObjectId };

function makeFakeDrafts() {
  const rows: DraftDoc[] = [];
  return {
    rows,
    async findOne(filter: { scanId?: string }) {
      return rows.find((row) => row.scanId === filter.scanId) ?? null;
    },
    async insertOne(doc: Draft) {
      const withId: DraftDoc = { ...doc, _id: new ObjectId() };
      rows.push(withId);
      return { insertedId: withId._id };
    },
  };
}

function makeFakeMirror(rows: Partial<ProductMirror>[] = []) {
  return {
    async findOne(filter: { shopifyProductId: string }) {
      return rows.find((row) => row.shopifyProductId === filter.shopifyProductId) ?? null;
    },
  };
}

const enqueueEnrichment = vi.fn();
vi.mock("@/lib/queue/enrich-queue", () => ({
  enqueueEnrichment: (...args: unknown[]) => enqueueEnrichment(...args),
}));

let fakeDrafts: ReturnType<typeof makeFakeDrafts>;
let fakeMirror: ReturnType<typeof makeFakeMirror>;
vi.mock("@/lib/db/collections", () => ({
  getCollections: async () => ({ drafts: fakeDrafts, productsMirror: fakeMirror }),
}));

const { createDraft } = await import("./create-draft");
const { newProductIntakeSchema, newVariantIntakeSchema } = await import("./request");

const USER_ID = new ObjectId();

function newProductInput() {
  return newProductIntakeSchema.parse({
    kind: "new_product",
    scanId: SCAN_ID,
    barcodeRaw: "9310720073156",
    price: "12.50",
    qty: 4,
    images: [
      {
        key: "intake/a.webp",
        url: "https://files.example.com/a.webp",
        width: 800,
        height: 800,
        bytes: 5000,
      },
    ],
    deviceId: "pixel-7a",
  });
}

beforeEach(() => {
  fakeDrafts = makeFakeDrafts();
  fakeMirror = makeFakeMirror();
  enqueueEnrichment.mockClear();
});

describe("createDraft", () => {
  it("writes a queued draft with the capture qty seeded as its first count", async () => {
    const { draft, created } = await createDraft(newProductInput(), USER_ID);

    expect(created).toBe(true);
    expect(draft.status).toBe("queued");
    expect(draft.counts).toEqual([{ scanId: SCAN_ID, qty: 4, by: USER_ID, at: expect.any(Date) }]);
    expect(enqueueEnrichment).toHaveBeenCalledOnce();
    expect(enqueueEnrichment).toHaveBeenCalledWith(draft._id.toHexString());
  });

  it("still returns the written draft when the enqueue itself fails", async () => {
    // The Mongo write already succeeded by this point — a Redis blip must not
    // turn into a failed POST /api/intake with a draft the phone thinks was
    // never captured.
    enqueueEnrichment.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const { draft, created } = await createDraft(newProductInput(), USER_ID);
    expect(created).toBe(true);
    expect(draft.status).toBe("queued");
  });

  it("is idempotent on scanId — a replay returns the original draft, not a second one", async () => {
    const first = await createDraft(newProductInput(), USER_ID);
    const second = await createDraft(newProductInput(), USER_ID);

    expect(second.created).toBe(false);
    expect(second.draft._id.equals(first.draft._id)).toBe(true);
    expect(fakeDrafts.rows).toHaveLength(1);
    expect(enqueueEnrichment).toHaveBeenCalledOnce();
  });

  it("orders images 0..n regardless of the order they arrived in", async () => {
    const input = newProductIntakeSchema.parse({
      ...newProductInput(),
      images: [
        { key: "a.webp", url: "https://files.example.com/a.webp", width: 1, height: 1, bytes: 1 },
        { key: "b.webp", url: "https://files.example.com/b.webp", width: 1, height: 1, bytes: 1 },
      ],
    });
    const { draft } = await createDraft(input, USER_ID);
    if (draft.kind !== "new_product") throw new Error("expected a new_product draft");
    expect(draft.images.map((image) => image.order)).toEqual([0, 1]);
  });

  it("leaves optionValue null on a new_variant draft — nothing has read the packaging yet", async () => {
    const input = newVariantIntakeSchema.parse({
      kind: "new_variant",
      scanId: SCAN_ID,
      barcodeRaw: "9310720073156",
      price: "18.00",
      qty: 2,
      images: [
        { key: "a.webp", url: "https://files.example.com/a.webp", width: 1, height: 1, bytes: 1 },
      ],
      deviceId: "pixel-7a",
      parent: {
        productId: SYNTHETIC_PRODUCT,
        productTitle: "Gift Box",
        posOnly: true,
        optionName: "Size",
      },
    });

    const { draft } = await createDraft(input, USER_ID);
    if (draft.kind !== "new_variant") throw new Error("expected a new_variant draft");
    expect(draft.parent.optionValue).toBeNull();
  });

  it("reads existingVariantNeedsValue from the mirror, not the client", async () => {
    fakeMirror = makeFakeMirror([
      { shopifyProductId: SYNTHETIC_PRODUCT, optionNames: [] as string[] } as ProductMirror,
    ]);

    const input = newVariantIntakeSchema.parse({
      kind: "new_variant",
      scanId: SCAN_ID,
      barcodeRaw: "9310720073156",
      price: "18.00",
      qty: 2,
      images: [
        { key: "a.webp", url: "https://files.example.com/a.webp", width: 1, height: 1, bytes: 1 },
      ],
      deviceId: "pixel-7a",
      parent: {
        productId: SYNTHETIC_PRODUCT,
        productTitle: "Gift Box",
        posOnly: true,
        optionName: "Size",
      },
    });

    const { draft } = await createDraft(input, USER_ID);
    if (draft.kind !== "new_variant") throw new Error("expected a new_variant draft");
    expect(draft.parent.existingVariantNeedsValue).toBe(true);
  });

  it("writes a staff quick-pick to edits, never to ai", async () => {
    const input = newProductIntakeSchema.parse({ ...newProductInput(), vendor: "Alpen" });
    const { draft } = await createDraft(input, USER_ID);
    if (draft.kind !== "new_product") throw new Error("expected a new_product draft");
    expect(draft.edits).toEqual({ vendor: "Alpen", productType: undefined });
    expect(draft.ai).toBeUndefined();
  });
});
