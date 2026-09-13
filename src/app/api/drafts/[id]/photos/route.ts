import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireApiUser } from "@/lib/auth/guards";
import { getCollections } from "@/lib/db/collections";
import { writablePendingDraftStatuses } from "@/lib/db/schemas/drafts";
import { intakeImageSchema } from "@/lib/intake/request";
import { log } from "@/lib/log";

/**
 * `POST /api/drafts/:id/photos` — the pending-draft screen's secondary
 * action (BUILD_PLAN §9): adding more photos to a draft that is already
 * queued, without starting a second capture. Photos are uploaded to Garage
 * the same way as at first capture (`POST /api/uploads/sign` then a direct
 * PUT) — this route only appends the resulting keys to the draft.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ images: z.array(intakeImageSchema).min(1) });

export async function POST(
  request: Request,
  ctx: RouteContext<"/api/drafts/[id]/photos">,
): Promise<Response> {
  const user = await requireApiUser();
  if (user === null) {
    return NextResponse.json(
      { status: "error", message: "Sign in to add photos." },
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
  const current = await drafts.findOne({ _id: draftId });

  if (current === null) {
    return NextResponse.json(
      { status: "error", message: "That draft no longer exists." },
      { status: 404 },
    );
  }
  if (
    !writablePendingDraftStatuses.includes(
      current.status as (typeof writablePendingDraftStatuses)[number],
    )
  ) {
    return NextResponse.json(
      { status: "error", message: "That draft is no longer open for photos." },
      { status: 409 },
    );
  }

  const startOrder = current.images.length;
  const newImages = parsed.data.images.map((image, index) => ({
    ...image,
    order: startOrder + index,
  }));

  await drafts.updateOne(
    { _id: draftId },
    { $push: { images: { $each: newImages } }, $set: { updatedAt: new Date() } },
  );

  log.info("drafts.photos", { draftId: id, added: newImages.length });
  return NextResponse.json({ imageCount: startOrder + newImages.length });
}
