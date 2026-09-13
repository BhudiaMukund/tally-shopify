import { describe, expect, it } from "vitest";

import { aggregateHealth, withTimeout, type CheckResult, type QueuesCheckResult } from "./checks";

/**
 * The aggregation is the one piece of `/api/health` worth testing directly —
 * everything else is a thin wrapper around a real dependency ping, which a
 * unit test would just be re-mocking. `withTimeout` is the other: a hung
 * check has to resolve as "failed" rather than hang the whole endpoint
 * (Coolify's healthcheck has its own timeout, but this one should fire first).
 */

function ok(ms = 5): CheckResult {
  return { ok: true, ms };
}

function failing(ms = 5): CheckResult {
  return { ok: false, ms, error: "unreachable" };
}

function queuesOk(): QueuesCheckResult {
  return { ok: true, ms: 5, queues: [{ name: "enrich", counts: { waiting: 0 } }] };
}

describe("aggregateHealth", () => {
  it("is ok when every check passes", () => {
    const report = aggregateHealth({
      mongo: ok(),
      redis: ok(),
      garage: ok(),
      shopify: ok(),
      queues: queuesOk(),
    });
    expect(report.status).toBe("ok");
  });

  it("is degraded when any single check fails", () => {
    const report = aggregateHealth({
      mongo: ok(),
      redis: failing(),
      garage: ok(),
      shopify: ok(),
      queues: queuesOk(),
    });
    expect(report.status).toBe("degraded");
    expect(report.redis.ok).toBe(false);
  });

  it("is degraded when the queue check itself fails", () => {
    const report = aggregateHealth({
      mongo: ok(),
      redis: ok(),
      garage: ok(),
      shopify: ok(),
      queues: { ok: false, ms: 5, error: "redis down", queues: [] },
    });
    expect(report.status).toBe("degraded");
  });
});

describe("withTimeout", () => {
  it("resolves with the value when the promise settles in time", async () => {
    await expect(withTimeout(Promise.resolve("fine"), 50)).resolves.toBe("fine");
  });

  it("rejects rather than hanging when the promise never settles", async () => {
    const neverSettles = new Promise(() => {});
    await expect(withTimeout(neverSettles, 20)).rejects.toThrow(/Timed out/);
  });

  it("propagates the original rejection when the promise fails before the timeout", async () => {
    await expect(withTimeout(Promise.reject(new Error("boom")), 50)).rejects.toThrow("boom");
  });
});
