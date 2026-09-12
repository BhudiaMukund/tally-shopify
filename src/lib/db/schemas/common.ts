import type { ObjectId } from "mongodb";
import { z } from "zod";

/**
 * Primitives shared by every collection schema.
 *
 * Deliberately free of a runtime `mongodb` import: these schemas are the only
 * description of a document's shape, so a client island that needs one (a draft
 * form, say) must be able to import it without dragging the driver into the
 * bundle. The scan route has a 120KB budget.
 */

/**
 * A BSON ObjectId, recognised by its `_bsontype` marker rather than
 * `instanceof ObjectId` — see the note above about not importing the driver.
 * The marker is how BSON itself identifies these values across realms.
 */
function isObjectId(value: unknown): value is ObjectId {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { _bsontype?: unknown })._bsontype === "ObjectId"
  );
}

export const objectId = z.custom<ObjectId>(isObjectId, { message: "must be an ObjectId" });

/** A Shopify global id for one resource type, e.g. `gid://shopify/Product/123`. */
export function gid<T extends string>(resource: T) {
  return z
    .string()
    .regex(
      new RegExp(String.raw`^gid://shopify/${resource}/\d+$`),
      `must be a ${resource} GID, e.g. gid://shopify/${resource}/<id>`,
    );
}

/**
 * A barcode as stored: digits only, no length rule.
 *
 * Lenient on purpose. `products_mirror` is a cache of what Shopify actually
 * holds, and this catalogue contains barcodes of 6, 9 and 11 digits. Rejecting
 * them here would silently drop those variants out of the mirror, which is
 * exactly the stock that `scripts/audit-barcodes.ts` exists to find. Normalise
 * to digits (CLAUDE.md §3), store what's there, report the junk separately.
 */
export const barcodeDigits = z
  .string()
  .regex(/^\d+$/, "must be digits only — normalise before writing");

/**
 * A barcode Tally itself is responsible for: a well-formed GTIN.
 *
 * Used where we mint or assign a code rather than read one, so the stricter
 * rule applies — one of the four legal GTIN lengths. Check-digit validation
 * lives with the generator in commit 14; this is the shape gate.
 */
export const gtin = z.string().regex(/^(\d{8}|\d{12,14})$/, "must be a GTIN-8, -12, -13 or -14");

/**
 * A price, held as a decimal string and normalised to two places.
 *
 * String rather than float because these round-trip to Shopify's `Money` scalar
 * and a binary float can't hold 12.10 exactly. Normalising on parse means
 * `"12.5"` and `"12.50"` compare equal, which matters: §3's variant decision
 * turns on whether a price *differs* from its siblings, and a string comparison
 * that answers "yes" for the same money would create variants for nothing.
 *
 * Two decimal places assumes a two-decimal currency (AUD). Revisit for JPY.
 */
export const money = z
  .string()
  .regex(/^\d+(\.\d{1,2})?$/, "must be a decimal amount, e.g. 12.50")
  .transform((value) => {
    const [whole, fraction = ""] = value.split(".");
    return `${whole}.${fraction.padEnd(2, "0")}`;
  });

/** The client-generated UUID that makes a scan's writes idempotent. */
export const scanId = z.uuid("must be a UUID generated on the device");
