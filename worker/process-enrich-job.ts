import type { Job } from "bullmq";
import { ObjectId } from "mongodb";

import { getCollections } from "@/lib/db/collections";
import { log } from "@/lib/log";
import type { EnrichJobData } from "@/lib/queue/enrich-queue";

import { enrichDraft } from "./enrich-draft";

/**
 * The `enrich` queue's job processor. Transitions the draft through
 * `queued → enriching → pending_review`, updating status at every step so
 * the UI can show progress (BUILD_PLAN §11). Left to throw on failure —
 * no try/catch here — so BullMQ's own retry/backoff stays in full control;
 * `worker/handle-enrich-failure.ts` is what reacts once retries are
 * exhausted.
 */
export async function processEnrichJob(job: Job<EnrichJobData>): Promise<void> {
  const { draftId } = job.data;
  const _id = new ObjectId(draftId);
  const { drafts } = await getCollections();

  const draft = await drafts.findOne({ _id });
  if (draft === null) {
    // Nothing to retry into existing — a missing draft won't appear on a
    // second attempt either, but throwing (rather than swallowing) keeps it
    // visible in the dead-letter queue instead of vanishing silently.
    throw new Error(`Draft ${draftId} no longer exists`);
  }

  if (draft.status !== "queued" && draft.status !== "enriching") {
    // Moved on for a reason that has nothing to do with this job — e.g.
    // rejected before enrichment got to it. Not a failure, just stale work.
    log.info("enrich.job.skipped", { draftId, jobId: job.id, status: draft.status });
    return;
  }

  await drafts.updateOne(
    { _id, status: { $in: ["queued", "enriching"] } },
    { $set: { status: "enriching", updatedAt: new Date() } },
  );
  log.info("enrich.job.started", {
    draftId,
    jobId: job.id,
    attempt: job.attemptsMade + 1,
  });

  await enrichDraft(draft);

  await drafts.updateOne({ _id }, { $set: { status: "pending_review", updatedAt: new Date() } });
  log.info("enrich.job.completed", { draftId, jobId: job.id });
}
