import { getDb } from "@/lib/db/client";
import { errorMessage } from "@/lib/log";
import { getRedisConnection } from "@/lib/queue/connection";
import { getEnrichQueueJobCounts } from "@/lib/queue/enrich-queue";
import { getSweepOrphansQueueJobCounts } from "@/lib/queue/sweep-orphans-queue";
import { checkBucketReachable } from "@/lib/s3/objects";
import { getShop } from "@/lib/shopify/operations/get-shop";

/**
 * `/api/health` — Mongo, Redis, Garage and Shopify reachability, plus queue
 * depth (BUILD_PLAN §11). Coolify's healthcheck polls this with no session,
 * so every check here has to be self-contained and time-bounded: one hanging
 * dependency must not hang the whole endpoint.
 */

export interface CheckResult {
  ok: boolean;
  ms: number;
  error?: string;
}

const CHECK_TIMEOUT_MS = 3_000;

/** Rejects if `promise` hasn't settled within `ms` — a hung dependency is reported as failed, not left pending. */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function timed(check: () => Promise<void>): Promise<CheckResult> {
  const startedAt = performance.now();
  try {
    await withTimeout(check(), CHECK_TIMEOUT_MS);
    return { ok: true, ms: Math.round(performance.now() - startedAt) };
  } catch (error) {
    return { ok: false, ms: Math.round(performance.now() - startedAt), error: errorMessage(error) };
  }
}

export function checkMongo(): Promise<CheckResult> {
  return timed(async () => {
    const db = await getDb();
    await db.command({ ping: 1 });
  });
}

export function checkRedis(): Promise<CheckResult> {
  return timed(async () => {
    await getRedisConnection().ping();
  });
}

export function checkGarage(): Promise<CheckResult> {
  return timed(checkBucketReachable);
}

/**
 * Cached for 30s: a healthcheck polling every few seconds shouldn't spend a
 * live GraphQL call — and its rate-limit cost (CLAUDE.md's leaky-bucket
 * budget) — on every single hit.
 */
const SHOPIFY_CHECK_CACHE_MS = 30_000;
let cachedShopifyCheck: { result: CheckResult; at: number } | undefined;

export async function checkShopify(): Promise<CheckResult> {
  const now = Date.now();
  if (cachedShopifyCheck !== undefined && now - cachedShopifyCheck.at < SHOPIFY_CHECK_CACHE_MS) {
    return cachedShopifyCheck.result;
  }

  const result = await timed(async () => {
    await getShop();
  });
  cachedShopifyCheck = { result, at: now };
  return result;
}

export interface QueuesCheckResult extends CheckResult {
  queues: { name: string; counts: Record<string, number> }[];
}

export async function checkQueues(): Promise<QueuesCheckResult> {
  const startedAt = performance.now();
  try {
    const [enrich, sweepOrphans] = await withTimeout(
      Promise.all([getEnrichQueueJobCounts(), getSweepOrphansQueueJobCounts()]),
      CHECK_TIMEOUT_MS,
    );
    return {
      ok: true,
      ms: Math.round(performance.now() - startedAt),
      queues: [
        { name: "enrich", counts: enrich },
        { name: "sweep-orphans", counts: sweepOrphans },
      ],
    };
  } catch (error) {
    return {
      ok: false,
      ms: Math.round(performance.now() - startedAt),
      error: errorMessage(error),
      queues: [],
    };
  }
}

export interface HealthReport {
  status: "ok" | "degraded";
  mongo: CheckResult;
  redis: CheckResult;
  garage: CheckResult;
  shopify: CheckResult;
  queues: QueuesCheckResult;
}

/** Pure aggregation, kept apart from the individual checks so it's testable against fakes. */
export function aggregateHealth(parts: {
  mongo: CheckResult;
  redis: CheckResult;
  garage: CheckResult;
  shopify: CheckResult;
  queues: QueuesCheckResult;
}): HealthReport {
  const allOk =
    parts.mongo.ok && parts.redis.ok && parts.garage.ok && parts.shopify.ok && parts.queues.ok;
  return { status: allOk ? "ok" : "degraded", ...parts };
}
