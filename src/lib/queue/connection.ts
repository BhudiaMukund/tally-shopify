import IORedis from "ioredis";

import { envVar } from "@/lib/env";

/**
 * The Redis connection BullMQ's producers share.
 *
 * Cached on `globalThis` for the same reason as `db/client.ts`'s Mongo
 * client: a hot reload in dev must reuse the existing socket rather than
 * opening a new one on every file save.
 *
 * `maxRetriesPerRequest: null` is BullMQ's own requirement — its blocking
 * commands need a connection that retries forever rather than one that gives
 * up and throws mid-`BRPOPLPUSH`. It applies just as much to a producer-only
 * connection as to a worker's, so it is set here rather than only when
 * commit 11 adds the consumer.
 */

type ConnectionCache = { client?: IORedis };

const globalForRedis = globalThis as typeof globalThis & { __tallyRedis?: ConnectionCache };

function cache(): ConnectionCache {
  return (globalForRedis.__tallyRedis ??= {});
}

export function getRedisConnection(): IORedis {
  const store = cache();
  store.client ??= new IORedis(envVar("REDIS_URL"), { maxRetriesPerRequest: null });
  return store.client;
}

/** Closes the connection. For scripts, which otherwise hang on an open socket. */
export async function closeRedisConnection(): Promise<void> {
  const store = cache();
  if (store.client === undefined) return;
  const client = store.client;
  store.client = undefined;
  await client.quit();
}
