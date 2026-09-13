import { Queue } from "bullmq";

import { getRedisConnection } from "./connection";

/**
 * The scheduling side of the orphan sweep (BUILD_PLAN §11). A separate queue
 * from `enrich`, not a job type on it: this runs on its own schedule at
 * concurrency 1 — it is a maintenance sweep over the whole bucket, not a
 * per-draft hot path, and giving it the same worker pool as enrichment would
 * let a slow sweep starve real captures.
 */

export const SWEEP_ORPHANS_QUEUE_NAME = "sweep-orphans";
export const SWEEP_ORPHANS_JOB_NAME = "sweep-orphans";
/** Stable id for the repeatable job — `upsertJobScheduler` keys on this, so re-registering on every boot updates the one scheduler rather than creating a second. */
export const SWEEP_ORPHANS_SCHEDULER_ID = "sweep-orphans-daily";

let queue: Queue | undefined;

function getQueue(): Queue {
  queue ??= new Queue(SWEEP_ORPHANS_QUEUE_NAME, { connection: getRedisConnection() });
  return queue;
}

/**
 * Registers the daily sweep. Idempotent — safe to call every time the worker
 * boots, per `upsertJobScheduler`'s own contract (it *upserts* by scheduler
 * id, never appends a second schedule).
 */
export async function scheduleSweepOrphans(): Promise<void> {
  await getQueue().upsertJobScheduler(
    SWEEP_ORPHANS_SCHEDULER_ID,
    { pattern: "0 3 * * *" },
    { name: SWEEP_ORPHANS_JOB_NAME },
  );
}

/** Job counts by state — folded into `/api/health`'s queue-depth figure alongside `enrich`'s. */
export async function getSweepOrphansQueueJobCounts(): Promise<Record<string, number>> {
  return getQueue().getJobCounts();
}
