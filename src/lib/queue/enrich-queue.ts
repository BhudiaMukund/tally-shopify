import { Queue } from "bullmq";

import { getRedisConnection } from "./connection";

/**
 * The producer side of the enrichment pipeline. `POST /api/intake` has to
 * enqueue a job without waiting for it — the AI step must never block the
 * phone (CLAUDE.md, BUILD_PLAN §1) — so this is a thin `Queue.add()` and
 * nothing else.
 *
 * The consumer (`worker/index.ts`, concurrency, retries, backoff, dead-letter)
 * is commit 11. Adding a job to a queue nobody is reading from yet is safe —
 * it sits in Redis until a worker exists — so the producer lands here rather
 * than waiting for its other half.
 */

export const ENRICH_QUEUE_NAME = "enrich";

export interface EnrichJobData {
  draftId: string;
}

let queue: Queue<EnrichJobData> | undefined;

function getQueue(): Queue<EnrichJobData> {
  queue ??= new Queue<EnrichJobData>(ENRICH_QUEUE_NAME, { connection: getRedisConnection() });
  return queue;
}

/** Enqueues enrichment for a draft that has already been written to Mongo. */
export async function enqueueEnrichment(draftId: string): Promise<void> {
  await getQueue().add("enrich", { draftId });
}
