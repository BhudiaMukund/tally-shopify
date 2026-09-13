import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * BUILD_PLAN §8's explicit case: "the same `scanId` added to a draft's
 * counts twice sums once." A thin fake stands in for the two Mongo calls
 * this route makes — `findOneAndUpdate`'s conditional `$push` is the whole
 * idempotency mechanism, so the fake has to honour the same filter, not just
 * record that it was called.
 */

function makeFakeDrafts(initial: Record<string, unknown>[]) {
  const rows = new Map(initial.map((row) => [(row._id as ObjectId).toHexString(), row]));

  return {
    rows,
    async findOneAndUpdate(
      filter: { _id: ObjectId; status?: { $in: string[] }; "counts.scanId"?: { $ne: string } },
      update: { $push: { counts: unknown }; $set: { updatedAt: Date } },
    ) {
      const key = filter._id.toHexString();
      const row = rows.get(key);
      if (row === undefined) return null;
      if (filter.status !== undefined && !filter.status.$in.includes(row.status as string))
        return null;

      const counts = row.counts as { scanId: string }[];
      const excludeScanId = filter["counts.scanId"]?.$ne;
      if (excludeScanId !== undefined && counts.some((count) => count.scanId === excludeScanId)) {
        return null;
      }

      const updated = {
        ...row,
        counts: [...counts, update.$push.counts],
        updatedAt: update.$set.updatedAt,
      };
      rows.set(key, updated);
      return updated;
    },
    async findOne(filter: { _id: ObjectId }) {
      return rows.get(filter._id.toHexString()) ?? null;
    },
  };
}

let fakeDrafts: ReturnType<typeof makeFakeDrafts>;
vi.mock("@/lib/db/collections", () => ({
  getCollections: async () => ({ drafts: fakeDrafts }),
}));
vi.mock("@/lib/auth/guards", () => ({
  requireApiUser: async () => ({
    id: new ObjectId().toHexString(),
    email: "a@b.com",
    name: "A",
    role: "staff",
  }),
}));

const { POST } = await import("./route");

const DRAFT_ID = new ObjectId();
const SCAN_ID = "3f1a9c4e-0b22-4f4a-9d6b-1c5e2a7d8f90";

function ctx() {
  return { params: Promise.resolve({ id: DRAFT_ID.toHexString() }) };
}

function request(body: unknown) {
  return new Request("http://localhost/api/drafts/x/count", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  fakeDrafts = makeFakeDrafts([{ _id: DRAFT_ID, status: "queued", counts: [] }]);
});

describe("POST /api/drafts/[id]/count", () => {
  it("sums a repeated scanId once instead of twice", async () => {
    const first = await POST(request({ scanId: SCAN_ID, qty: 6 }), ctx());
    expect(first.status).toBe(200);
    expect((await first.json()).countedQty).toBe(6);

    const second = await POST(request({ scanId: SCAN_ID, qty: 6 }), ctx());
    expect(second.status).toBe(200);
    expect((await second.json()).countedQty).toBe(6);
  });

  it("refuses a count on a draft that is no longer open", async () => {
    fakeDrafts = makeFakeDrafts([{ _id: DRAFT_ID, status: "rejected", counts: [] }]);

    const response = await POST(request({ scanId: SCAN_ID, qty: 6 }), ctx());
    expect(response.status).toBe(409);
  });

  it("404s a draft id that doesn't exist", async () => {
    const response = await POST(request({ scanId: SCAN_ID, qty: 6 }), {
      params: Promise.resolve({ id: new ObjectId().toHexString() }),
    });
    expect(response.status).toBe(404);
  });
});
