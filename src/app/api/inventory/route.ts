import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";

import { requireApiUser } from "@/lib/auth/guards";
import { applyInventoryWrite, inventoryWriteRequestSchema } from "@/lib/inventory/apply";
import { log } from "@/lib/log";

/**
 * `POST /api/inventory` — the stocktake write. Synchronous, straight to
 * Shopify, no queue and no admin review (CLAUDE.md §6). Everything about
 * *how* the write happens lives in `src/lib/inventory/apply.ts`; this route is
 * only auth, request shape, and mapping the typed result onto an HTTP status.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const startedAt = performance.now();
  const user = await requireApiUser();
  if (user === null) {
    return NextResponse.json(
      { status: "error", message: "Sign in to update stock." },
      { status: 401 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { status: "error", message: "That request was not valid JSON." },
      { status: 400 },
    );
  }

  const parsed = inventoryWriteRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { status: "error", message: parsed.error.issues[0]?.message ?? "Invalid request." },
      { status: 400 },
    );
  }

  const result = await applyInventoryWrite(parsed.data, new ObjectId(user.id));
  const ms = Math.round(performance.now() - startedAt);

  log.info("inventory.write", {
    scanId: parsed.data.scanId,
    variantId: parsed.data.variantId,
    mode: parsed.data.mode,
    status: result.status,
    ambiguousBarcode: parsed.data.ambiguousBarcode,
    ms,
  });

  switch (result.status) {
    case "applied":
      return NextResponse.json(result, {
        status: 200,
        headers: { "server-timing": `total;dur=${ms}` },
      });
    case "conflict":
      return NextResponse.json(result, { status: 409 });
    case "not_found":
      return NextResponse.json(result, { status: 404 });
    case "failed":
      return NextResponse.json(result, { status: 422 });
  }
}
