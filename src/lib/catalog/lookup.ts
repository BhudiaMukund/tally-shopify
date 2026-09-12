import type { WithId } from "mongodb";

import { barcodeCandidates, normaliseBarcode } from "@/lib/barcode";
import { getCollections } from "@/lib/db/collections";
import {
  pendingDraftStatuses,
  type Draft,
  type DraftKind,
  type DraftStatus,
} from "@/lib/db/schemas/drafts";
import { envVar } from "@/lib/env";
import { findVariantsByBarcode } from "@/lib/shopify/operations/find-variants-by-barcode";

import { groupMirrorRows, toProductMatch, type MirrorContext } from "./mapping";
import type { ProductMatch } from "./types";

/**
 * What a scan resolves to.
 *
 * Three questions are asked at once, and they are not the same question:
 *
 *   the mirror   what Shopify had a moment ago, in single-digit milliseconds
 *   Shopify      what Shopify has now, in 150-300ms
 *   drafts       what is on its way but is not in Shopify at all (BUILD_PLAN §9)
 *
 * The mirror answer paints the screen and the live answer replaces it. That is
 * the only thing the cache is for: it is never the input to a write, and a
 * quantity is never read from it to compute a new one (CLAUDE.md §1).
 *
 * `live` is handed back as a promise rather than awaited, so the scan screen can
 * render `cached` immediately and reconcile when Shopify lands. It never
 * rejects — a Shopify failure resolves as `{ ok: false }` — because an
 * unobserved rejection on the scan path would take the process down.
 */

export interface PendingMatch {
  draftId: string;
  kind: DraftKind;
  status: DraftStatus;
  barcode: string;
  price: string;
  /** The hero photo, if one has finished uploading. */
  imageUrl: string | null;
  imageCount: number;
  /** The running count, summed from `counts[]`. Scans accumulate, never overwrite. */
  countedQty: number;
  capturedAt: Date;
  capturedBy: string;
  /** The other draft in a same-barcode, different-price pair. */
  siblingOf: string | null;
  parent: {
    productId: string;
    productTitle: string;
    optionName: string;
    optionValue: string;
  } | null;
  /**
   * Why a `failed` draft failed, so the phone can offer a retry rather than
   * silently starting a second draft. A `rejected` draft's reason and reviewer
   * arrive with the review console at commit 12 — there is nothing to read them
   * from yet, and inventing the fields here would mean two shapes to merge.
   */
  error: { message: string; step: string | null; at: Date } | null;
}

export type LiveResult =
  { ok: true; products: ProductMatch[]; ms: number } | { ok: false; error: string; ms: number };

/**
 * `invalid`  the scanner read something that is not a GTIN — do not act on it
 * `match`    at least one variant in Shopify carries this code
 * `pending`  no Shopify match, but a draft is already on its way (§9)
 * `new`      nothing anywhere: new-product intake
 */
export type LookupState = "invalid" | "match" | "pending" | "new";

export interface BarcodeLookup {
  /** Exactly what was scanned. */
  raw: string;
  /** Digits only — what a write would use. */
  barcode: string;
  wellFormed: boolean;
  checkDigitOk: boolean;
  cached: ProductMatch[];
  pending: PendingMatch[];
  live: Promise<LiveResult>;
  /** How long the mirror and the drafts took. The budget for this pair is tiny. */
  cachedMs: number;
}

export interface SettledLookup extends Omit<BarcodeLookup, "live"> {
  live: LiveResult;
  /** Decided on the live answer where there is one, the mirror where there is not. */
  state: LookupState;
  /** The matches to act on: live when Shopify answered, cached when it did not. */
  products: ProductMatch[];
}

function mirrorContext(): MirrorContext {
  return {
    locationId: envVar("SHOPIFY_LOCATION_ID"),
    posPublicationId: envVar("SHOPIFY_POS_PUBLICATION_ID"),
  };
}

function pendingMatchOf(draft: WithId<Draft>): PendingMatch {
  const images = [...draft.images].sort((a, b) => a.order - b.order);

  return {
    draftId: draft._id.toHexString(),
    kind: draft.kind,
    status: draft.status,
    barcode: draft.barcode,
    price: draft.price,
    imageUrl: images[0]?.url ?? null,
    imageCount: images.length,
    countedQty: draft.counts.reduce((total, count) => total + count.qty, 0),
    capturedAt: draft.capturedAt,
    capturedBy: draft.capturedBy.toHexString(),
    siblingOf: draft.siblingOf?.toHexString() ?? null,
    parent:
      draft.kind !== "new_variant"
        ? null
        : {
            productId: draft.parent.productId,
            productTitle: draft.parent.productTitle,
            optionName: draft.parent.optionName,
            optionValue: draft.parent.optionValue,
          },
    error:
      draft.error === undefined
        ? null
        : { message: draft.error.message, step: draft.error.step ?? null, at: draft.error.at },
  };
}

/** The mirror's answer. One indexed `$in`, grouped by product. */
export async function lookupCached(barcode: string): Promise<ProductMatch[]> {
  const candidates = barcodeCandidates(barcode);
  if (candidates.length === 0) return [];

  const { productsMirror } = await getCollections();
  const rows = await productsMirror.find({ barcode: { $in: candidates } }).toArray();
  return groupMirrorRows(rows);
}

/**
 * Drafts carrying this barcode that have not reached Shopify yet.
 *
 * Newest first: if a barcode somehow has two open drafts, the most recent
 * capture is the one the person holding the item is looking at.
 */
export async function lookupPending(barcode: string): Promise<PendingMatch[]> {
  const candidates = barcodeCandidates(barcode);
  if (candidates.length === 0) return [];

  const { drafts } = await getCollections();
  const rows = await drafts
    .find({ barcode: { $in: candidates }, status: { $in: [...pendingDraftStatuses] } })
    .sort({ capturedAt: -1 })
    .toArray();

  return rows.map(pendingMatchOf);
}

/** Shopify's answer. Resolves to `{ ok: false }` rather than throwing. */
export async function lookupLive(barcode: string, signal?: AbortSignal): Promise<LiveResult> {
  const startedAt = performance.now();
  const context = mirrorContext();

  try {
    const products = await findVariantsByBarcode(barcode, {
      locationId: context.locationId,
      signal,
    });
    return {
      ok: true,
      products: products.map((product) => toProductMatch(product, context)),
      ms: Math.round(performance.now() - startedAt),
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      ms: Math.round(performance.now() - startedAt),
    };
  }
}

export function lookupStateOf(lookup: {
  wellFormed: boolean;
  products: readonly ProductMatch[];
  pending: readonly PendingMatch[];
}): LookupState {
  if (!lookup.wellFormed) return "invalid";
  if (lookup.products.length > 0) return "match";
  if (lookup.pending.length > 0) return "pending";
  return "new";
}

export interface LookupOptions {
  signal?: AbortSignal;
  /** Skips Shopify. For scripts and tests, never for the scan path. */
  cachedOnly?: boolean;
}

/**
 * Mirror, drafts and Shopify, all three started together.
 *
 * A barcode that is not a GTIN never reaches Mongo or Shopify. Eight wrong
 * digits off a damaged label should not be able to create a product, and "no
 * match" would be indistinguishable from a genuine new item.
 */
export async function lookupByBarcode(
  raw: string,
  options: LookupOptions = {},
): Promise<BarcodeLookup> {
  const normalised = normaliseBarcode(raw);
  const base = {
    raw: normalised.raw,
    barcode: normalised.digits,
    wellFormed: normalised.wellFormed,
    checkDigitOk: normalised.checkDigitOk,
  };

  if (!normalised.wellFormed) {
    return {
      ...base,
      cached: [],
      pending: [],
      live: Promise.resolve<LiveResult>({ ok: true, products: [], ms: 0 }),
      cachedMs: 0,
    };
  }

  const startedAt = performance.now();
  // Started before the awaits below, so the round trip overlaps the local reads
  // instead of following them.
  const live =
    options.cachedOnly === true
      ? Promise.resolve<LiveResult>({ ok: true, products: [], ms: 0 })
      : lookupLive(normalised.digits, options.signal);

  const [cached, pending] = await Promise.all([
    lookupCached(normalised.digits),
    lookupPending(normalised.digits),
  ]);

  return { ...base, cached, pending, live, cachedMs: Math.round(performance.now() - startedAt) };
}

/** Awaits the live half. For an API route, a script, or a test that wants one object. */
export async function settleLookup(lookup: BarcodeLookup): Promise<SettledLookup> {
  const live = await lookup.live;
  const products = live.ok ? live.products : lookup.cached;
  return { ...lookup, live, products, state: lookupStateOf({ ...lookup, products }) };
}
