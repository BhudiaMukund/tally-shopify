import type { Job } from "bullmq";
import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { EnrichJobData } from "@/lib/queue/enrich-queue";

/**
 * BullMQ fires `"failed"` after every attempt, not only the last — this is
 * the one thing that has to get right which attempt is final, since that's
 * what decides whether the draft's own `status` moves to `failed` (BUILD_PLAN
 * §11's "done when": three attempts, then the dead-letter queue).
 */

function makeFakeDrafts(initial: Record<string, unknown>) {
  const row = { ...initial };
  return {
    row,
    async updateOne(
      filter: { status?: { $in: string[] } },
      update: { $set: Record<string, unknown> },
    ) {
      if (filter.status !== undefined && !filter.status.$in.includes(row.status as string)) {
        return { matchedCount: 0 };
      }
      Object.assign(row, update.$set);
      return { matchedCount: 1 };
    },
  };
}

let fakeDrafts: ReturnType<typeof makeFakeDrafts>;
vi.mock("@/lib/db/collections", () => ({
  getCollections: async () => ({ drafts: fakeDrafts }),
}));

const { handleEnrichJobFailed } = await import("./handle-enrich-failure");

const DRAFT_ID = new ObjectId();

function job(attemptsMade: number, attempts = 3): Job<EnrichJobData> {
  return {
    id: "1",
    data: { draftId: DRAFT_ID.toHexString() },
    attemptsMade,
    opts: { attempts },
  } as unknown as Job<EnrichJobData>;
}

beforeEach(() => {
  fakeDrafts = makeFakeDrafts({ _id: DRAFT_ID, status: "enriching" });
});

describe("handleEnrichJobFailed", () => {
  it("leaves the draft alone on an attempt that isn't the last", async () => {
    await handleEnrichJobFailed(job(1, 3), new Error("timeout"));
    expect(fakeDrafts.row.status).toBe("enriching");
  });

  it("marks the draft failed once attemptsMade reaches the configured limit", async () => {
    await handleEnrichJobFailed(job(3, 3), new Error("vision provider unreachable"));

    expect(fakeDrafts.row.status).toBe("failed");
    expect(fakeDrafts.row.error).toMatchObject({
      message: "vision provider unreachable",
      step: "enrich",
    });
  });

  it("does not overwrite a draft that already moved on for an unrelated reason", async () => {
    fakeDrafts = makeFakeDrafts({ _id: DRAFT_ID, status: "rejected" });

    await handleEnrichJobFailed(job(3, 3), new Error("vision provider unreachable"));

    expect(fakeDrafts.row.status).toBe("rejected");
  });

  it("does nothing when there is no job to act on", async () => {
    await expect(handleEnrichJobFailed(undefined, new Error("x"))).resolves.toBeUndefined();
  });
});
