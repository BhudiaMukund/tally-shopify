import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { InventoryEvent } from "@/lib/db/schemas/inventory-events";

/**
 * The orchestration in `apply.ts` is where a bug would silently corrupt
 * Shopify's live inventory — CLAUDE.md's whole reason for existing — so every
 * Shopify call is mocked and the assertions are about *which* calls happen,
 * in what order, and with what numbers, not about GraphQL wiring (that is
 * `inventory-write.test.ts`'s job against a fake server).
 *
 * A minimal in-memory `inventory_events` stands in for Mongo: `findOne`,
 * `insertOne` and `updateOne({$set})` are all `applyInventoryWrite` needs, and
 * a real Mongo connection is not worth pulling into a unit test that exists to
 * catch a double-apply, not a driver bug.
 */

const LOCATION = "gid://shopify/Location/111";
const VARIANT = "gid://shopify/ProductVariant/1";
const ITEM = "gid://shopify/InventoryItem/1";
const SCAN_ID = "11111111-1111-1111-1111-111111111111";

type EventDoc = InventoryEvent & { _id: ObjectId };

function makeFakeCollection() {
  const rows = new Map<string, EventDoc>();

  return {
    rows,
    async findOne(filter: { scanId: string }) {
      return rows.get(filter.scanId) ?? null;
    },
    async insertOne(doc: InventoryEvent) {
      const withId: EventDoc = { ...doc, _id: new ObjectId() };
      rows.set(doc.scanId, withId);
      return { insertedId: withId._id };
    },
    async updateOne(filter: { scanId: string }, update: { $set: Partial<InventoryEvent> }) {
      const current = rows.get(filter.scanId);
      if (current === undefined) return { matchedCount: 0 };
      rows.set(filter.scanId, { ...current, ...update.$set });
      return { matchedCount: 1 };
    },
  };
}

const getVariantForInventory = vi.fn();
const ensureInventoryTracked = vi.fn();
const activateInventoryAtLocation = vi.fn();
const setInventoryQuantities = vi.fn();

vi.mock("@/lib/env", () => ({ envVar: () => LOCATION }));
vi.mock("@/lib/shopify/operations/get-variant-for-inventory", () => ({
  getVariantForInventory: (...args: unknown[]) => getVariantForInventory(...args),
}));
vi.mock("@/lib/shopify/operations/ensure-inventory-tracked", () => ({
  ensureInventoryTracked: (...args: unknown[]) => ensureInventoryTracked(...args),
}));
vi.mock("@/lib/shopify/operations/activate-inventory", () => ({
  activateInventoryAtLocation: (...args: unknown[]) => activateInventoryAtLocation(...args),
}));
vi.mock("@/lib/shopify/operations/set-inventory-quantities", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/shopify/operations/set-inventory-quantities")
  >("@/lib/shopify/operations/set-inventory-quantities");
  return {
    ...actual,
    setInventoryQuantities: (...args: unknown[]) => setInventoryQuantities(...args),
  };
});

let fakeCollection: ReturnType<typeof makeFakeCollection>;
vi.mock("@/lib/db/collections", () => ({
  getCollections: async () => ({ inventoryEvents: fakeCollection }),
}));

const { applyInventoryWrite } = await import("./apply");

const ACTOR = new ObjectId();

function baseRequest(overrides: Partial<Parameters<typeof applyInventoryWrite>[0]> = {}) {
  return {
    scanId: SCAN_ID,
    barcode: "9312345678907",
    variantId: VARIANT,
    mode: "set" as const,
    value: 30,
    compareQuantity: 24,
    ambiguousBarcode: false,
    chosenFrom: [],
    ...overrides,
  };
}

beforeEach(() => {
  fakeCollection = makeFakeCollection();
  getVariantForInventory.mockReset();
  ensureInventoryTracked.mockReset();
  activateInventoryAtLocation.mockReset();
  setInventoryQuantities.mockReset();
});

describe("applyInventoryWrite — the already-tracked path", () => {
  it("skips ensure-tracked and activate when the fresh read says both are already true", async () => {
    getVariantForInventory.mockResolvedValue({
      variantId: VARIANT,
      inventoryItemId: ITEM,
      tracked: true,
      availableAtLocation: 24,
    });
    setInventoryQuantities.mockResolvedValue({ quantityAfterChange: 30, userErrors: [] });

    const result = await applyInventoryWrite(baseRequest(), ACTOR);

    expect(result).toMatchObject({ status: "applied", before: 24, after: 30, delta: 6 });
    expect(ensureInventoryTracked).not.toHaveBeenCalled();
    expect(activateInventoryAtLocation).not.toHaveBeenCalled();
    expect(setInventoryQuantities).toHaveBeenCalledWith(
      expect.objectContaining({ quantity: 30, compareQuantity: 24, idempotencyKey: SCAN_ID }),
    );
  });

  it("computes 'add' as compareQuantity + value, not value alone", async () => {
    getVariantForInventory.mockResolvedValue({
      variantId: VARIANT,
      inventoryItemId: ITEM,
      tracked: true,
      availableAtLocation: 10,
    });
    setInventoryQuantities.mockResolvedValue({ quantityAfterChange: 15, userErrors: [] });

    const result = await applyInventoryWrite(
      baseRequest({ mode: "add", value: 5, compareQuantity: 10 }),
      ACTOR,
    );

    expect(result).toMatchObject({ status: "applied", before: 10, after: 15, delta: 5 });
    expect(setInventoryQuantities).toHaveBeenCalledWith(
      expect.objectContaining({ quantity: 15, compareQuantity: 10 }),
    );
  });

  it("fails without calling Shopify when a tracked item has no compareQuantity to check against", async () => {
    getVariantForInventory.mockResolvedValue({
      variantId: VARIANT,
      inventoryItemId: ITEM,
      tracked: true,
      availableAtLocation: 10,
    });

    const result = await applyInventoryWrite(baseRequest({ compareQuantity: null }), ACTOR);

    expect(result.status).toBe("failed");
    expect(setInventoryQuantities).not.toHaveBeenCalled();
  });

  it("fails closed rather than sending Shopify a negative quantity", async () => {
    getVariantForInventory.mockResolvedValue({
      variantId: VARIANT,
      inventoryItemId: ITEM,
      tracked: true,
      availableAtLocation: 2,
    });

    const result = await applyInventoryWrite(
      baseRequest({ mode: "add", value: -5, compareQuantity: 2 }),
      ACTOR,
    );

    expect(result.status).toBe("failed");
    expect(setInventoryQuantities).not.toHaveBeenCalled();
  });
});

describe("applyInventoryWrite — the never-tracked path", () => {
  it("runs ensure-tracked then activate before setting quantities, with compareQuantity 0", async () => {
    getVariantForInventory.mockResolvedValue({
      variantId: VARIANT,
      inventoryItemId: ITEM,
      tracked: false,
      availableAtLocation: null,
    });
    setInventoryQuantities.mockResolvedValue({ quantityAfterChange: 12, userErrors: [] });

    const result = await applyInventoryWrite(
      baseRequest({ mode: "add", value: 12, compareQuantity: null }),
      ACTOR,
    );

    expect(ensureInventoryTracked).toHaveBeenCalledWith(ITEM);
    expect(activateInventoryAtLocation).toHaveBeenCalledWith(
      expect.objectContaining({ inventoryItemId: ITEM, locationId: LOCATION }),
    );
    expect(setInventoryQuantities).toHaveBeenCalledWith(
      expect.objectContaining({ quantity: 12, compareQuantity: 0 }),
    );
    expect(result).toMatchObject({ status: "applied", before: null, after: 12, delta: 12 });
  });
});

describe("applyInventoryWrite — idempotent replay", () => {
  it("returns the original result on a second call with the same scanId, without calling Shopify again", async () => {
    getVariantForInventory.mockResolvedValue({
      variantId: VARIANT,
      inventoryItemId: ITEM,
      tracked: true,
      availableAtLocation: 24,
    });
    setInventoryQuantities.mockResolvedValue({ quantityAfterChange: 30, userErrors: [] });

    const first = await applyInventoryWrite(baseRequest(), ACTOR);
    const second = await applyInventoryWrite(baseRequest(), ACTOR);

    expect(second).toEqual(first);
    expect(setInventoryQuantities).toHaveBeenCalledTimes(1);
    expect(getVariantForInventory).toHaveBeenCalledTimes(1);
  });
});

describe("applyInventoryWrite — conflict", () => {
  it("turns a stale compareQuantity into a 409-shaped result carrying the fresh number", async () => {
    getVariantForInventory
      .mockResolvedValueOnce({
        variantId: VARIANT,
        inventoryItemId: ITEM,
        tracked: true,
        availableAtLocation: 24,
      })
      .mockResolvedValueOnce({
        variantId: VARIANT,
        inventoryItemId: ITEM,
        tracked: true,
        availableAtLocation: 19,
      });
    setInventoryQuantities.mockResolvedValue({
      quantityAfterChange: null,
      userErrors: [
        {
          code: "COMPARE_QUANTITY_STALE",
          field: ["quantities", "0", "compareQuantity"],
          message: "The compareQuantity value does not match persisted value.",
        },
      ],
    });

    const result = await applyInventoryWrite(baseRequest(), ACTOR);

    expect(result).toEqual({
      status: "conflict",
      message: "Stock changed while you were counting.",
      current: 19,
    });
    expect(getVariantForInventory).toHaveBeenCalledTimes(2);
  });

  it("replaying a conflicted scanId does not re-attempt the Shopify write", async () => {
    getVariantForInventory.mockResolvedValue({
      variantId: VARIANT,
      inventoryItemId: ITEM,
      tracked: true,
      availableAtLocation: 24,
    });
    setInventoryQuantities.mockResolvedValue({
      quantityAfterChange: null,
      userErrors: [{ code: "COMPARE_QUANTITY_STALE", field: null, message: "stale" }],
    });

    await applyInventoryWrite(baseRequest(), ACTOR);
    setInventoryQuantities.mockClear();
    const second = await applyInventoryWrite(baseRequest(), ACTOR);

    expect(second.status).toBe("conflict");
    expect(setInventoryQuantities).not.toHaveBeenCalled();
  });
});

describe("applyInventoryWrite — a hard userError", () => {
  it("finalises as failed and surfaces the message rather than throwing", async () => {
    getVariantForInventory.mockResolvedValue({
      variantId: VARIANT,
      inventoryItemId: ITEM,
      tracked: true,
      availableAtLocation: 24,
    });
    setInventoryQuantities.mockResolvedValue({
      quantityAfterChange: null,
      userErrors: [
        { code: "NON_MUTABLE_INVENTORY_ITEM", field: null, message: "Not adjustable via API." },
      ],
    });

    const result = await applyInventoryWrite(baseRequest(), ACTOR);

    expect(result).toEqual({ status: "failed", message: "Not adjustable via API." });
  });
});

describe("applyInventoryWrite — retrying a previous-attempt-failed idempotency key", () => {
  it("retries once with a suffixed key rather than getting stuck", async () => {
    getVariantForInventory.mockResolvedValue({
      variantId: VARIANT,
      inventoryItemId: ITEM,
      tracked: true,
      availableAtLocation: 24,
    });
    setInventoryQuantities
      .mockResolvedValueOnce({
        quantityAfterChange: null,
        userErrors: [
          {
            code: "IDEMPOTENCY_PREVIOUS_ATTEMPT_FAILED",
            field: null,
            message: "retry with a new key",
          },
        ],
      })
      .mockResolvedValueOnce({ quantityAfterChange: 30, userErrors: [] });

    const result = await applyInventoryWrite(baseRequest(), ACTOR);

    expect(result).toMatchObject({ status: "applied", after: 30 });
    expect(setInventoryQuantities).toHaveBeenCalledTimes(2);
    expect(setInventoryQuantities.mock.calls[1]?.[0]).toMatchObject({
      idempotencyKey: `${SCAN_ID}:retry`,
    });
  });
});

describe("applyInventoryWrite — a deleted variant", () => {
  it("reports not_found rather than trying to write anything", async () => {
    getVariantForInventory.mockResolvedValue(null);

    const result = await applyInventoryWrite(baseRequest(), ACTOR);

    expect(result.status).toBe("not_found");
    expect(setInventoryQuantities).not.toHaveBeenCalled();
  });
});
