import type { Job } from "bullmq";
import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { EnrichJobData } from "@/lib/queue/enrich-queue";

/**
 * The processor's own logic, independent of BullMQ: does it skip stale work,
 * transition status correctly, and — critically — let a thrown error from
 * `enrichDraft` propagate untouched, since that propagation is what BullMQ's
 * retry/backoff/dead-letter mechanics depend on (BUILD_PLAN §11's "done
 * when").
 */

function makeFakeDrafts(initial: Record<string, unknown>) {
  const row = { ...initial };
  return {
    row,
    async findOne(): Promise<Record<string, unknown> | null> {
      return { ...row };
    },
    async updateOne(_filter: unknown, update: { $set: Record<string, unknown> }) {
      Object.assign(row, update.$set);
      return { matchedCount: 1 };
    },
  };
}

let fakeDrafts: ReturnType<typeof makeFakeDrafts>;
vi.mock("@/lib/db/collections", () => ({
  getCollections: async () => ({ drafts: fakeDrafts }),
}));

const enrichDraft = vi.fn();
vi.mock("./enrich-draft", () => ({ enrichDraft: (...args: unknown[]) => enrichDraft(...args) }));

const { processEnrichJob } = await import("./process-enrich-job");

const DRAFT_ID = new ObjectId();

function job(overrides: Partial<{ attemptsMade: number }> = {}): Job<EnrichJobData> {
  return {
    id: "1",
    data: { draftId: DRAFT_ID.toHexString() },
    attemptsMade: 0,
    ...overrides,
  } as unknown as Job<EnrichJobData>;
}

beforeEach(() => {
  enrichDraft.mockClear();
  enrichDraft.mockResolvedValue(undefined);
});

describe("processEnrichJob", () => {
  it("transitions queued -> enriching -> pending_review on success", async () => {
    fakeDrafts = makeFakeDrafts({ _id: DRAFT_ID, status: "queued", images: [] });

    await processEnrichJob(job());

    expect(fakeDrafts.row.status).toBe("pending_review");
    expect(enrichDraft).toHaveBeenCalledOnce();
  });

  it("re-enters cleanly from enriching — a retry after a previous attempt died mid-way", async () => {
    fakeDrafts = makeFakeDrafts({ _id: DRAFT_ID, status: "enriching", images: [] });

    await processEnrichJob(job({ attemptsMade: 1 }));

    expect(fakeDrafts.row.status).toBe("pending_review");
  });

  it("skips a draft that moved on for an unrelated reason, without calling enrichDraft", async () => {
    fakeDrafts = makeFakeDrafts({ _id: DRAFT_ID, status: "rejected", images: [] });

    await processEnrichJob(job());

    expect(fakeDrafts.row.status).toBe("rejected");
    expect(enrichDraft).not.toHaveBeenCalled();
  });

  it("throws when the draft no longer exists, rather than swallowing it", async () => {
    fakeDrafts = makeFakeDrafts({ _id: DRAFT_ID, status: "queued", images: [] });
    fakeDrafts.findOne = async () => null;

    await expect(processEnrichJob(job())).rejects.toThrow();
  });

  it("propagates a thrown enrichDraft error untouched, for BullMQ's retry to handle", async () => {
    fakeDrafts = makeFakeDrafts({ _id: DRAFT_ID, status: "queued", images: [] });
    enrichDraft.mockRejectedValueOnce(new Error("vision provider unreachable"));

    await expect(processEnrichJob(job())).rejects.toThrow("vision provider unreachable");
    // Status was already moved to "enriching" before the throw — the draft
    // is not left claiming to still be "queued" while a retry is pending.
    expect(fakeDrafts.row.status).toBe("enriching");
  });
});
