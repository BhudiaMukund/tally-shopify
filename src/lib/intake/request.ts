import { z } from "zod";

import { gid, money, scanId } from "@/lib/db/schemas/common";

/**
 * What the phone sends to `POST /api/intake` — the wire shape, not the
 * document shape. `src/lib/db/schemas/drafts.ts` describes what gets stored;
 * this describes what gets received, before `capturedBy`/`capturedAt`/status
 * exist. The two are related but not the same schema, the way
 * `src/lib/scan/lookup-client.ts` restates `catalog/types.ts` rather than
 * importing it — this module has to be importable from a client component
 * without dragging `mongodb` in through `db/schemas/drafts.ts`.
 *
 * The discriminated union on `kind` *is* the "re-validate kind on the server"
 * step from BUILD_PLAN §10: a `new_variant` payload with no `parent` fails
 * here, at the door, rather than reaching a publish step with nothing to
 * attach a variant to.
 */

/** A draft id as it travels over JSON — a hex string, not a driver `ObjectId`. */
export const objectIdHex = z.string().regex(/^[0-9a-f]{24}$/i, "must be a 24-character hex id");

export const intakeImageSchema = z.object({
  key: z.string().min(1),
  url: z.url(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  bytes: z.number().int().positive(),
});
export type IntakeImage = z.infer<typeof intakeImageSchema>;

const intakeBaseSchema = z.object({
  scanId,
  /** Exactly what the scanner or manual entry produced — normalised server-side. */
  barcodeRaw: z.string().min(1),
  price: money,
  /** The first `counts[]` entry — a deliberate count taken at capture, same as the stocktake path. */
  qty: z.number().int().nonnegative(),
  images: z.array(intakeImageSchema).min(1, "at least one photo is required"),
  deviceId: z.string().min(1),
});

export const newProductIntakeSchema = intakeBaseSchema.extend({
  kind: z.literal("new_product"),
  /**
   * Another draft of the same not-yet-created product, captured at a
   * different price (BUILD_PLAN §9). Only ever set on a `new_product`
   * draft — a `new_variant` draft already has a real `parent.productId` to
   * attach to, so it never needs a sibling link.
   */
  siblingOf: objectIdHex.optional(),
  /**
   * Optional quick-pick chips (BUILD_PLAN §10) — a `new_variant` draft never
   * offers these, since the parent product already has a vendor and type.
   * Written to `edits.*` (never `ai.*`), the same field a reviewer would
   * later change — staff picking one first just means the merge at publish
   * time has nothing to override.
   */
  vendor: z.string().min(1).optional(),
  productType: z.string().min(1).optional(),
});

export const newVariantIntakeSchema = intakeBaseSchema.extend({
  kind: z.literal("new_variant"),
  parent: z.object({
    productId: gid("Product"),
    productTitle: z.string().min(1),
    posOnly: z.boolean(),
    /** From the synced option-name list — chosen by staff, not guessed by the client. */
    optionName: z.string().min(1),
  }),
});

export const intakeRequestSchema = z.discriminatedUnion("kind", [
  newProductIntakeSchema,
  newVariantIntakeSchema,
]);
export type IntakeRequest = z.infer<typeof intakeRequestSchema>;
export type NewProductIntake = z.infer<typeof newProductIntakeSchema>;
export type NewVariantIntake = z.infer<typeof newVariantIntakeSchema>;
