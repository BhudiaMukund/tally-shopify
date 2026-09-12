import { NextResponse } from "next/server";
import { z } from "zod";

import { requireApiUser } from "@/lib/auth/guards";
import { log } from "@/lib/log";
import { MAX_PHOTOS_PER_UPLOAD, signUploads } from "@/lib/s3/uploads";

/**
 * `POST /api/uploads/sign` — the phone's only trip through our server for a
 * photo. Bytes go straight from the browser to Garage (BUILD_PLAN §9); this
 * route hands out presigned PUT URLs and nothing else, so it answers before
 * the camera has even finished writing the file to a Blob.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  count: z.number().int().min(1).max(MAX_PHOTOS_PER_UPLOAD),
});

export async function POST(request: Request): Promise<Response> {
  const user = await requireApiUser();
  if (user === null) {
    return NextResponse.json(
      { status: "error", message: "Sign in to upload photos." },
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

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { status: "error", message: parsed.error.issues[0]?.message ?? "Invalid request." },
      { status: 400 },
    );
  }

  try {
    const uploads = await signUploads(parsed.data.count);
    return NextResponse.json({ uploads });
  } catch (error) {
    log.error("uploads.sign_failed", {
      count: parsed.data.count,
      message: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { status: "error", message: "Could not prepare an upload. Try again." },
      { status: 502 },
    );
  }
}
