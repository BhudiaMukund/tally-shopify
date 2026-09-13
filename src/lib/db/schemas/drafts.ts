import { z } from "zod";

import { barcodeDigits, gid, gtin, money, objectId, scanId } from "./common";

/**
 * `drafts` — products and variants captured on the phone but not yet in Shopify.
 *
 * A draft is modelled as a discriminated union on `kind`, because the two kinds
 * genuinely are different records: a `new_variant` draft must carry its parent
 * and an option value, a `new_product` draft must not. Expressing that as one
 * loose object with optional fields would let a variant draft reach the publish
 * step with no parent to attach it to — and that step mutates a live product.
 */

export const draftStatus = z.enum([
  "uploading",
  "queued",
  "enriching",
  "pending_review",
  "approved",
  "publishing",
  "published",
  "failed",
  "rejected",
]);
export type DraftStatus = z.infer<typeof draftStatus>;

export const draftKind = z.enum(["new_product", "new_variant"]);
export type DraftKind = z.infer<typeof draftKind>;

/** The parent product a `new_variant` draft attaches to. */
export const draftParentSchema = z.object({
  productId: gid("Product"),
  productTitle: z.string().min(1),
  posOnly: z.boolean(),
  /**
   * From the synced option-name list, so the AI proposes `Size`, not `Box
   * Dimension`. A structural pick, not a content guess — staff choose it at
   * capture time, before the AI exists to propose anything.
   */
  optionName: z.string().min(1),
  /**
   * AI-proposed, admin-confirmed (§2). Null at intake — nothing has read the
   * packaging yet — and filled in by enrichment (commit 12) or a reviewer
   * (commit 13). Never applied without review.
   */
  optionValue: z.string().min(1).nullable(),
  /**
   * True when the parent is still a single `Default Title` variant, so publishing
   * has to name that existing variant as well as create the new one. §3 calls
   * this out as the fiddly case; it is never silent.
   */
  existingVariantNeedsValue: z.boolean(),
});
export type DraftParent = z.infer<typeof draftParentSchema>;

export const draftImageSchema = z.object({
  /** The S3 object key. Bytes go phone → MinIO directly; the server only sees this. */
  key: z.string().min(1),
  url: z.url(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  order: z.number().int().nonnegative(),
  bytes: z.number().int().positive(),
});
export type DraftImage = z.infer<typeof draftImageSchema>;

/**
 * One counting event. Summed, never overwritten — scanning the same pending
 * product again on another shelf adds to it. `scanId` is what stops a retry
 * from counting the same stock twice.
 */
export const draftCountSchema = z.object({
  scanId,
  qty: z.number().int().nonnegative(),
  by: objectId,
  at: z.date(),
});
export type DraftCount = z.infer<typeof draftCountSchema>;

/** The `shopify.*` metafields the AI may fill. Every one is optional by design. */
export const aiMetafieldsSchema = z
  .object({
    color: z.string(),
    celebrationType: z.string(),
    packageType: z.string(),
    productForm: z.string(),
    recommendedAgeGroup: z.string(),
    balloonShape: z.string(),
  })
  .partial();
export type AiMetafields = z.infer<typeof aiMetafieldsSchema>;

/** Provenance and cost, recorded for every enrichment regardless of kind. */
const aiRunSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  /** `AI_PROMPT_VERSION` at the time — you will want to know which prompt wrote what. */
  promptVersion: z.number().int().positive(),
  latencyMs: z.number().int().nonnegative(),
  tokensIn: z.number().int().nonnegative(),
  tokensOut: z.number().int().nonnegative(),
  confidence: z.number().min(0).max(1),
  needsHuman: z.boolean(),
  notes: z.string().optional(),
});

/**
 * The listing fields — the response schema of the enrichment prompt (§7.1), and
 * the exact surface an admin may override. `productType`, `vendor` and
 * `category` are checked against the `taxonomy` collection at enrichment time,
 * not here; this schema only says they have to be strings.
 */
export const aiProductContentSchema = z.object({
  title: z.string().min(1).max(70),
  descriptionHtml: z.string().min(1),
  productType: z.string().min(1),
  vendor: z.string().min(1).nullable(),
  category: z.string().min(1),
  tags: z.array(z.string().min(1)).max(6),
  seoTitle: z.string().max(60),
  seoDescription: z.string().max(155),
  metafields: aiMetafieldsSchema,
});
export type AiProductContent = z.infer<typeof aiProductContentSchema>;

/** The variant prompt's response (§7.1b). A narrower job: read a size off a box. */
export const aiVariantContentSchema = z.object({
  optionName: z.string().min(1),
  /** Null when the size could not be read. Never guessed — `needsHuman` is set instead. */
  optionValue: z.string().min(1).nullable(),
  /** A proposal for the parent's `Default Title` variant. Only ever applied by an admin. */
  existingVariantValue: z.string().min(1).nullable(),
  readFrom: z.enum(["packaging", "product", "inferred"]),
});
export type AiVariantContent = z.infer<typeof aiVariantContentSchema>;

export const productAiSchema = aiRunSchema.extend(aiProductContentSchema.shape);
export const variantAiSchema = aiRunSchema.extend(aiVariantContentSchema.shape);

/**
 * Admin overrides, held apart from `ai.*` — which is never overwritten
 * (CLAUDE.md §10). The two are merged at publish time, so re-running the
 * enrichment cannot quietly discard a correction, and what the model actually
 * said stays readable next to what the admin decided.
 */
export const productEditsSchema = aiProductContentSchema.partial().extend({
  price: money.optional(),
  cost: money.optional(),
});
export const variantEditsSchema = aiVariantContentSchema.partial().extend({
  price: money.optional(),
});

/** Where the draft landed in Shopify. Written only once publishing has succeeded. */
export const draftShopifySchema = z.object({
  productId: gid("Product"),
  variantId: gid("ProductVariant"),
  publishedAt: z.date(),
  publications: z.array(z.string()),
});

export const draftErrorSchema = z.object({
  message: z.string().min(1),
  /** The step that failed, so a retry knows where to resume. */
  step: z.string().min(1).optional(),
  at: z.date(),
});

const draftBaseSchema = z.object({
  /** Client UUID, unique. The idempotency key for the whole intake path. */
  scanId,

  barcode: barcodeDigits,
  barcodeRaw: z.string(),
  /** An in-store GTIN minted by Tally, when the scanned code was ambiguous or absent. */
  assignedBarcode: gtin.optional(),
  /** A generated barcode not yet stuck on the item is a warning in the activity view. */
  labelPrinted: z.boolean().default(false),

  price: money,
  cost: money.optional(),

  images: z.array(draftImageSchema).default([]),
  counts: z.array(draftCountSchema).default([]),
  /** Another draft of the same product, different variant, from the same session. */
  siblingOf: objectId.optional(),

  capturedBy: objectId,
  capturedAt: z.date(),
  deviceId: z.string().min(1),

  status: draftStatus,
  shopify: draftShopifySchema.optional(),
  error: draftErrorSchema.optional(),
  /**
   * Set by the review console (commit 13) — nothing before it populates
   * these. Declared now, alongside every other collection field, so the
   * pending-draft screen (§9) has something to bind to the moment a rejection
   * exists, rather than the schema growing a rejection shape only once the
   * console that writes it ships.
   */
  rejectedBy: objectId.optional(),
  rejectedReason: z.string().min(1).optional(),
  rejectedAt: z.date().optional(),
  attempts: z.number().int().nonnegative().default(0),
  updatedAt: z.date(),
});

export const newProductDraftSchema = draftBaseSchema.extend({
  kind: z.literal("new_product"),
  ai: productAiSchema.optional(),
  edits: productEditsSchema.optional(),
});

export const newVariantDraftSchema = draftBaseSchema.extend({
  kind: z.literal("new_variant"),
  parent: draftParentSchema,
  ai: variantAiSchema.optional(),
  edits: variantEditsSchema.optional(),
});

export const draftSchema = z.discriminatedUnion("kind", [
  newProductDraftSchema,
  newVariantDraftSchema,
]);

export type NewProductDraft = z.infer<typeof newProductDraftSchema>;
export type NewVariantDraft = z.infer<typeof newVariantDraftSchema>;
export type Draft = z.infer<typeof draftSchema>;

/**
 * The statuses a scan should surface as "this is already on its way" rather
 * than starting a fresh capture. Pending is a first-class third state beside
 * match and no-match (§9) — including `rejected`, so the next person to scan
 * the item sees why it was turned down instead of re-capturing it.
 */
export const pendingDraftStatuses = [
  "uploading",
  "queued",
  "enriching",
  "pending_review",
  "failed",
  "rejected",
] as const satisfies readonly DraftStatus[];

/**
 * The narrower set that may still be *written to* — add to count, add
 * photos. `failed` and `rejected` are pending for lookup purposes (§9's
 * table), but each has its own distinct action (retry, recapture) rather
 * than accepting a count or a photo appended to a draft that isn't going
 * anywhere in its current state.
 */
export const writablePendingDraftStatuses = [
  "queued",
  "enriching",
  "pending_review",
] as const satisfies readonly DraftStatus[];
