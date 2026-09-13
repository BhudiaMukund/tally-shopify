import { NextResponse } from "next/server";

import {
  aggregateHealth,
  checkGarage,
  checkMongo,
  checkQueues,
  checkRedis,
  checkShopify,
} from "@/lib/health/checks";

/**
 * `GET /api/health` — Mongo, Redis, Garage and Shopify reachability, plus
 * queue depth (BUILD_PLAN §11). No auth: Coolify's healthcheck has no
 * session, and there is nothing here a signed-out request could abuse.
 *
 * The web `Dockerfile`'s `HEALTHCHECK` uses `wget --spider`, which treats any
 * non-2xx as failure — so `degraded` has to be a real HTTP status, not just a
 * field in the body a text-only spider check would never read.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const [mongo, redis, garage, shopify, queues] = await Promise.all([
    checkMongo(),
    checkRedis(),
    checkGarage(),
    checkShopify(),
    checkQueues(),
  ]);

  const report = aggregateHealth({ mongo, redis, garage, shopify, queues });
  return NextResponse.json(report, { status: report.status === "ok" ? 200 : 503 });
}
