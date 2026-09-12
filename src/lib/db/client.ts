import { MongoClient, type Db, type MongoClientOptions } from "mongodb";

import { envVar } from "@/lib/env";

/**
 * The MongoDB connection.
 *
 * One client per process, cached on `globalThis` so a hot reload in dev reuses
 * the existing pool instead of opening a new one on every file save — a few
 * dozen edits and an uncached client exhausts the server's connection limit.
 */

const clientOptions: MongoClientOptions = {
  appName: "tally",
  /**
   * The scan path has a p95 budget of 400ms. The driver's 30s default turns
   * "Mongo is down" into a request that hangs until the phone gives up; five
   * seconds still rides out an election but fails visibly.
   */
  serverSelectionTimeoutMS: 5_000,
  maxPoolSize: 20,
  retryWrites: true,
};

type ClientCache = { promise?: Promise<MongoClient> };

const globalForMongo = globalThis as typeof globalThis & { __tallyMongo?: ClientCache };

function cache(): ClientCache {
  return (globalForMongo.__tallyMongo ??= {});
}

/** The connected client. Connects on first call, then hands back the same one. */
export function getMongoClient(): Promise<MongoClient> {
  const store = cache();
  store.promise ??= new MongoClient(envVar("MONGODB_URI"), clientOptions)
    .connect()
    .catch((error) => {
      // A rejected promise left in the cache would fail every later request even
      // after Mongo came back. Drop it so the next caller retries the connection.
      store.promise = undefined;
      throw error;
    });
  return store.promise;
}

/**
 * The Tally database. The name comes from the path in `MONGODB_URI` — never
 * hard-coded, so a test or a restore can point at another one.
 */
export async function getDb(): Promise<Db> {
  const client = await getMongoClient();
  return client.db();
}

/** Closes the pool. For scripts, which otherwise hang on an open socket. */
export async function closeDb(): Promise<void> {
  const store = cache();
  const promise = store.promise;
  if (promise === undefined) return;
  store.promise = undefined;
  await (await promise).close();
}
