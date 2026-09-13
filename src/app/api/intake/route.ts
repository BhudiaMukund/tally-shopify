import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";

import { requireApiUser } from "@/lib/auth/guards";
import { createDraft } from "@/lib/intake/create-draft";
import { intakeRequestSchema } from "@/lib/intake/request";
import { log } from "@/lib/log";

/**
 * `POST /api/intake` — the no-match capture path (BUILD_PLAN §10). Writes a
 * `drafts` document and enqueues enrichment, but never waits for it: the
 * phone resets straight back to the scanner, so this has to answer in well
 * under 200ms.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const startedAt = performance.now();
  const user = await requireApiUser();
  if (user === null) {
    return NextResponse.json(
      { status: "error", message: "Sign in to capture a product." },
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

  const parsed = intakeRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { status: "error", message: parsed.error.issues[0]?.message ?? "Invalid request." },
      { status: 400 },
    );
  }

  const { draft, created } = await createDraft(parsed.data, new ObjectId(user.id));
  const ms = Math.round(performance.now() - startedAt);

  log.info("intake.create", {
    draftId: draft._id.toHexString(),
    scanId: parsed.data.scanId,
    kind: parsed.data.kind,
    created,
    ms,
  });

  return NextResponse.json(
    { draftId: draft._id.toHexString(), status: draft.status },
    { status: created ? 201 : 200, headers: { "server-timing": `total;dur=${ms}` } },
  );
}
