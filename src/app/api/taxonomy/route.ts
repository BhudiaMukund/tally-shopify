import { NextResponse } from "next/server";

import { requireApiUser } from "@/lib/auth/guards";
import { getCollections } from "@/lib/db/collections";
import { taxonomyKey } from "@/lib/db/schemas/taxonomy";

/**
 * `GET /api/taxonomy?keys=vendor,productType` — the quick-pick chips on the
 * capture form (BUILD_PLAN §10). Server-only: the `taxonomy` collection isn't
 * reachable from the client bundle, and the scan route's budget doesn't want
 * the Mongo driver in it anyway.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Chips are a shortcut, not a form — keep the list short enough to scan by eye. */
const MAX_VALUES_PER_KEY = 12;

export async function GET(request: Request): Promise<Response> {
  const user = await requireApiUser();
  if (user === null) {
    return NextResponse.json({ status: "error", message: "Sign in." }, { status: 401 });
  }

  const requested = new URL(request.url).searchParams.get("keys")?.split(",") ?? [];
  const keys = requested
    .map((key) => taxonomyKey.safeParse(key))
    .filter((result) => result.success)
    .map((result) => result.data);

  if (keys.length === 0) {
    return NextResponse.json(
      { status: "error", message: "Pass at least one valid taxonomy key." },
      { status: 400 },
    );
  }

  const { taxonomy } = await getCollections();
  const rows = await taxonomy.find({ _id: { $in: keys } }).toArray();

  const result: Record<string, string[]> = {};
  for (const key of keys) {
    const row = rows.find((candidate) => candidate._id === key);
    result[key] = [...(row?.values ?? [])]
      .sort((a, b) => b.count - a.count)
      .slice(0, MAX_VALUES_PER_KEY)
      .map((entry) => entry.value);
  }

  return NextResponse.json(result);
}
