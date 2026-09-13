import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireApiUser } from "@/lib/auth/guards";
import { getCollections } from "@/lib/db/collections";
import { writablePendingDraftStatuses } from "@/lib/db/schemas/drafts";
import { scanId as scanIdSchema } from "@/lib/db/schemas/common";
import { log } from "@/lib/log";

/**
 * `POST /api/drafts/:id/count` — the pending-draft screen's primary action
 * (BUILD_PLAN §9): "add to count" appends to `counts[]`, it never overwrites.
 * Idempotent on `scanId` the same way `POST /api/inventory` is — a retried
 * add-to-count tap must sum once, not twice.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  scanId: scanIdSchema,
  qty: z.number().int().nonnegative(),
});

function summedQty(counts: readonly { qty: number }[]): number {
  return counts.reduce((total, count) => total + count.qty, 0);
}

export async function POST(
  request: Request,
  ctx: RouteContext<"/api/drafts/[id]/count">,
): Promise<Response> {
  const user = await requireApiUser();
  if (user === null) {
    return NextResponse.json(
      { status: "error", message: "Sign in to update this count." },
      { status: 401 },
    );
  }

  const { id } = await ctx.params;
  if (!ObjectId.isValid(id)) {
    return NextResponse.json({ status: "error", message: "Not a draft id." }, { status: 400 });
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

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { status: "error", message: parsed.error.issues[0]?.message ?? "Invalid request." },
      { status: 400 },
    );
  }

  const draftId = new ObjectId(id);
  const { drafts } = await getCollections();
  const now = new Date();

  const updated = await drafts.findOneAndUpdate(
    {
      _id: draftId,
      status: { $in: [...writablePendingDraftStatuses] },
      "counts.scanId": { $ne: parsed.data.scanId },
    },
    {
      $push: {
        counts: {
          scanId: parsed.data.scanId,
          qty: parsed.data.qty,
          by: new ObjectId(user.id),
          at: now,
        },
      },
      $set: { updatedAt: now },
    },
    { returnDocument: "after" },
  );

  if (updated !== null) {
    log.info("drafts.count", { draftId: id, scanId: parsed.data.scanId, ms: 0 });
    return NextResponse.json({ countedQty: summedQty(updated.counts) });
  }

  // No match above — find out why, so a replay is a 200 and a real problem is not.
  const current = await drafts.findOne({ _id: draftId });
  if (current === null) {
    return NextResponse.json(
      { status: "error", message: "That draft no longer exists." },
      { status: 404 },
    );
  }
  if (current.counts.some((count) => count.scanId === parsed.data.scanId)) {
    return NextResponse.json({ countedQty: summedQty(current.counts) });
  }
  return NextResponse.json(
    { status: "error", message: "That draft is no longer open for counting." },
    { status: 409 },
  );
}
