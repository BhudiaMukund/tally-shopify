import { z } from "zod";

import { barcodeDigits, gid, objectId, scanId } from "./common";

/**
 * `inventory_events` — the audit log for every stocktake write.
 *
 * A row is inserted *before* the Shopify mutation and finalised after it (§3),
 * keyed on `scanId` with a unique index. That pair is the whole idempotency
 * story for the inventory path: a retry with the same `scanId` hits the
 * duplicate key, reads the original row and returns its result instead of
 * applying the count twice.
 *
 * "Append-only, never updated" in §2 means no event is ever rewritten for a
 * later scan, and no field that records intent (`before`, `delta`, `mode`)
 * changes after insert. The finalise step is the single permitted update: it
 * fills in the outcome that could not be known before the call was made.
 */

export const inventoryMode = z.enum(["set", "add"]);
export type InventoryMode = z.infer<typeof inventoryMode>;

export const inventorySource = z.enum(["scan", "admin", "reconcile"]);
export type InventorySource = z.infer<typeof inventorySource>;

export const inventoryEventStatus = z.enum([
  /** Inserted, mutation not yet answered. A row stuck here means we lost the response. */
  "pending",
  "applied",
  /**
   * `compareQuantity` rejected the write because the number moved underneath us
   * — a POS sale mid-count. The correct outcome, not an error to swallow
   * (CLAUDE.md §8); the staff member is shown the new figure and asked again.
   */
  "conflict",
  "failed",
]);
export type InventoryEventStatus = z.infer<typeof inventoryEventStatus>;

export const inventoryEventSchema = z.object({
  scanId,
  barcode: barcodeDigits,
  variantId: gid("ProductVariant"),
  inventoryItemId: gid("InventoryItem"),
  locationId: gid("Location"),

  /** True when this barcode matched more than one variant and a choice was made. */
  ambiguousBarcode: z.boolean(),
  /** The variants offered in that choice, so a bad pick can be traced back. */
  chosenFrom: z.array(gid("ProductVariant")).default([]),

  /**
   * The quantity read immediately before the write, and the value passed as
   * `compareQuantity`. Null when the item was untracked and had no level yet.
   */
  before: z.number().int().nullable(),
  /** Filled in on finalise. Null while pending, and on a conflict or failure. */
  after: z.number().int().nullable().default(null),
  delta: z.number().int().nullable().default(null),
  mode: inventoryMode,

  actor: objectId,
  source: inventorySource,

  status: inventoryEventStatus.default("pending"),
  /** Shopify's `X-Request-Id`. The one thing their support will ask for. */
  shopifyRequestId: z.string().min(1).optional(),
  error: z.string().min(1).optional(),

  createdAt: z.date(),
  /** When the outcome was recorded. Absent while pending. */
  completedAt: z.date().optional(),
});

export type InventoryEvent = z.infer<typeof inventoryEventSchema>;
