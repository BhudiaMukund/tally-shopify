import { Queue } from "bullmq";

import { getRedisConnection } from "./connection";

/**
 * The producer side of the enrichment pipeline. `POST /api/intake` has to
 * enqueue a job without waiting for it — the AI step must never block the
 * phone (CLAUDE.md, BUILD_PLAN §1) — so this is a thin `Queue.add()` and
 * nothing else.
 *
 * The consumer (`worker/index.ts`) is commit 11, but the retry policy below
 * lives here rather than there: BullMQ's `attempts`/`backoff` are *job*
 * options, applied when a job is added, not *worker* options — a worker
 * cannot retroactively give more retries to a job that was enqueued with
 * fewer. `removeOnFail` is BullMQ's own failed-job set, which is the
 * "dead-letter queue" BUILD_PLAN §6 asks for: capped at 1000 rather than left
 * unbounded, but not cleared to zero — a dead-lettered job has to stay
 * visible and countable (`Queue.getJobCounts()`, `/api/health`).
 */

export const ENRICH_QUEUE_NAME = "enrich";

export interface EnrichJobData {
  draftId: string;
}

let queue: Queue<EnrichJobData> | undefined;

function getQueue(): Queue<EnrichJobData> {
  queue ??= new Queue<EnrichJobData>(ENRICH_QUEUE_NAME, {
    connection: getRedisConnection(),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 5_000 },
      removeOnComplete: 500,
      removeOnFail: { count: 1000 },
    },
  });
  return queue;
}

/** Enqueues enrichment for a draft that has already been written to Mongo. */
export async function enqueueEnrichment(draftId: string): Promise<void> {
  await getQueue().add("enrich", { draftId });
}

/** Job counts by state — `/api/health`'s queue-depth figure. Never exposes the `Queue` itself. */
export async function getEnrichQueueJobCounts(): Promise<Record<string, number>> {
  return getQueue().getJobCounts();
}
