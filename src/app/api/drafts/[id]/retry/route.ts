import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";

import { requireApiUser } from "@/lib/auth/guards";
import { getCollections } from "@/lib/db/collections";
import { enqueueEnrichment } from "@/lib/queue/enrich-queue";
import { log } from "@/lib/log";

/**
 * `POST /api/drafts/:id/retry` — the pending-draft screen's action for a
 * `failed` draft (BUILD_PLAN §9): re-enqueue rather than silently starting a
 * second draft on the next scan.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  ctx: RouteContext<"/api/drafts/[id]/retry">,
): Promise<Response> {
  const user = await requireApiUser();
  if (user === null) {
    return NextResponse.json({ status: "error", message: "Sign in to retry." }, { status: 401 });
  }

  const { id } = await ctx.params;
  if (!ObjectId.isValid(id)) {
    return NextResponse.json({ status: "error", message: "Not a draft id." }, { status: 400 });
  }

  const draftId = new ObjectId(id);
  const { drafts } = await getCollections();

  const updated = await drafts.findOneAndUpdate(
    { _id: draftId, status: "failed" },
    {
      $set: { status: "queued", updatedAt: new Date() },
      $unset: { error: "" },
      $inc: { attempts: 1 },
    },
    { returnDocument: "after" },
  );

  if (updated === null) {
    const current = await drafts.findOne({ _id: draftId });
    const message =
      current === null ? "That draft no longer exists." : "That draft is not in a failed state.";
    return NextResponse.json(
      { status: "error", message },
      { status: current === null ? 404 : 409 },
    );
  }

  await enqueueEnrichment(id);
  log.info("drafts.retry", { draftId: id, attempts: updated.attempts });
  return NextResponse.json({ status: updated.status });
}
