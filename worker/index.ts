import { Worker } from "bullmq";

import { closeDb } from "@/lib/db/client";
import { log } from "@/lib/log";
import { closeRedisConnection, getRedisConnection } from "@/lib/queue/connection";
import { ENRICH_QUEUE_NAME, type EnrichJobData } from "@/lib/queue/enrich-queue";
import { scheduleSweepOrphans, SWEEP_ORPHANS_QUEUE_NAME } from "@/lib/queue/sweep-orphans-queue";

import { loadEnvFiles } from "../scripts/load-env";
import { handleEnrichJobFailed } from "./handle-enrich-failure";
import { processEnrichJob } from "./process-enrich-job";
import { processSweepOrphans } from "./sweep-orphans";

/**
 * The standalone worker process (BUILD_PLAN §11) — a separate container from
 * the web service, sharing `src/lib` and nothing else. Two BullMQ workers:
 * `enrich` does the real per-draft work at concurrency 4; `sweep-orphans`
 * runs a daily maintenance sweep at concurrency 1, on its own queue, so a
 * slow sweep can never take a worker slot away from a real capture.
 *
 * Runs via `pnpm worker` (`tsx worker/index.ts`) locally and in
 * `Dockerfile.worker` — nothing in this repo compiles a standalone TS
 * entrypoint to JS first, so this doesn't either.
 */

const ENRICH_CONCURRENCY = 4;
const SWEEP_ORPHANS_CONCURRENCY = 1;

async function main(): Promise<void> {
  loadEnvFiles();

  const connection = getRedisConnection();

  const enrichWorker = new Worker<EnrichJobData>(ENRICH_QUEUE_NAME, processEnrichJob, {
    connection,
    concurrency: ENRICH_CONCURRENCY,
  });
  enrichWorker.on("completed", (job) => {
    log.info("enrich.job.finalized", { draftId: job.data.draftId, jobId: job.id });
  });
  enrichWorker.on("failed", (job, error) => {
    void handleEnrichJobFailed(job, error);
  });

  const sweepWorker = new Worker(SWEEP_ORPHANS_QUEUE_NAME, () => processSweepOrphans(), {
    connection,
    concurrency: SWEEP_ORPHANS_CONCURRENCY,
  });
  sweepWorker.on("failed", (job, error) => {
    log.error("sweep_orphans.job.failed", { jobId: job?.id, message: error.message });
  });

  // Idempotent — safe to re-register the same daily schedule on every boot.
  await scheduleSweepOrphans();

  log.info("worker.started", {
    queues: [ENRICH_QUEUE_NAME, SWEEP_ORPHANS_QUEUE_NAME],
    enrichConcurrency: ENRICH_CONCURRENCY,
  });

  let shuttingDown = false;
  async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info("worker.shutting_down", { signal });
    await Promise.all([enrichWorker.close(), sweepWorker.close()]);
    await Promise.all([closeRedisConnection(), closeDb()]);
    process.exit(0);
  }

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
