import type { Job } from "bullmq";
import { ObjectId } from "mongodb";

import { getCollections } from "@/lib/db/collections";
import { errorMessage, log } from "@/lib/log";
import type { EnrichJobData } from "@/lib/queue/enrich-queue";

/**
 * BullMQ's `"failed"` event fires after *every* failed attempt, not only the
 * last one — `job.attemptsMade` vs. `job.opts.attempts` is what tells apart
 * "will retry" from "just landed in the dead-letter queue" (BUILD_PLAN §11).
 * Only the latter should flip the draft's own `status`: the phone and the
 * future review console read that field, and "attempt 1 of 3 failed" is not
 * a state either of them has a use for.
 */
export async function handleEnrichJobFailed(
  job: Job<EnrichJobData> | undefined,
  error: Error,
): Promise<void> {
  if (job === undefined) return;

  const attempts = job.opts.attempts ?? 1;
  if (job.attemptsMade < attempts) {
    log.warn("enrich.job.retry", {
      draftId: job.data.draftId,
      jobId: job.id,
      attempt: job.attemptsMade,
      attempts,
      message: errorMessage(error),
    });
    return;
  }

  const { drafts } = await getCollections();
  const now = new Date();
  await drafts.updateOne(
    // Only a draft still in the pipeline gets marked failed — one that moved
    // on for an unrelated reason (rejected, deleted) keeps whatever status
    // already reflects that.
    { _id: new ObjectId(job.data.draftId), status: { $in: ["queued", "enriching"] } },
    {
      $set: {
        status: "failed",
        error: { message: errorMessage(error), step: "enrich", at: now },
        updatedAt: now,
      },
    },
  );

  log.error("enrich.job.dead_letter", {
    draftId: job.data.draftId,
    jobId: job.id,
    attempts,
    message: errorMessage(error),
  });
}
