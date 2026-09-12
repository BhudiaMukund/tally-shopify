import { NextResponse } from "next/server";

import { requireApiUser } from "@/lib/auth/guards";
import { lookupByBarcode, lookupStateOf, type PendingMatch } from "@/lib/catalog/lookup";
import { log } from "@/lib/log";

/**
 * `GET /api/lookup?barcode=&cachedOnly=` — what a scan resolves to, for a
 * client island that cannot import `src/lib/catalog/lookup.ts` directly (it
 * touches Mongo and the Shopify client).
 *
 * The scan screen calls this twice per scan, not once: `cachedOnly=1`
 * immediately, so it can paint from the mirror inside the <100ms budget
 * (BUILD_PLAN §1), and again without the flag so the live Shopify answer can
 * reconcile it a few hundred ms later. Doing both server-side in one request
 * would only save the second request's own network round trip — a few tens of
 * milliseconds — at the cost of the phone never seeing the fast answer first,
 * which is the entire reason the mirror exists.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function serialisePending(pending: PendingMatch) {
  return {
    ...pending,
    capturedAt: pending.capturedAt.toISOString(),
    error: pending.error === null ? null : { ...pending.error, at: pending.error.at.toISOString() },
  };
}

export async function GET(request: Request): Promise<Response> {
  const startedAt = performance.now();
  const user = await requireApiUser();
  if (user === null) {
    return NextResponse.json({ status: "error", message: "Sign in to scan." }, { status: 401 });
  }

  const url = new URL(request.url);
  const barcode = url.searchParams.get("barcode");
  if (barcode === null || barcode.trim() === "") {
    return NextResponse.json({ status: "error", message: "barcode is required." }, { status: 400 });
  }
  const cachedOnly = url.searchParams.get("cachedOnly") === "1";

  const lookup = await lookupByBarcode(barcode, { cachedOnly });
  const live = await lookup.live;
  const products = live.ok ? live.products : lookup.cached;

  const ms = Math.round(performance.now() - startedAt);
  if (ms > 800) {
    log.warn("lookup.slow", { barcode: lookup.barcode, cachedOnly, ms });
  }

  // §3: one barcode legitimately covers a size run on *one* product. More than
  // one product sharing a barcode is a catalogue data error worth fixing at
  // the source, not something the scan screen should paper over — logged here
  // regardless of whether the resulting count ever gets applied.
  if (products.length > 1) {
    log.warn("catalog.barcode_collision", {
      barcode: lookup.barcode,
      productIds: products.map((product) => product.productId),
    });
  }

  return NextResponse.json(
    {
      raw: lookup.raw,
      barcode: lookup.barcode,
      wellFormed: lookup.wellFormed,
      checkDigitOk: lookup.checkDigitOk,
      state: lookupStateOf({ wellFormed: lookup.wellFormed, products, pending: lookup.pending }),
      products,
      pending: lookup.pending.map(serialisePending),
      live: live.ok ? { ok: true } : { ok: false, error: live.error },
      cachedOnly,
    },
    { status: 200, headers: { "server-timing": `total;dur=${ms}` } },
  );
}
