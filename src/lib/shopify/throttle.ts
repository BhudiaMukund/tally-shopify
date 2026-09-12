import { z } from "zod";

/**
 * The leaky bucket, mirrored in memory.
 *
 * Shopify's Admin GraphQL API is cost-based, not request-based: every response
 * carries the bucket's current level in `extensions.cost.throttleStatus`, and
 * the client's job is to read it and slow down *before* the bucket empties
 * rather than after. Getting throttled is recoverable but it costs a round
 * trip, and a bulk publish of twenty products would spend most of its time in
 * backoff.
 *
 * https://shopify.dev/docs/api/usage/rate-limits
 */

export const throttleStatusSchema = z.object({
  maximumAvailable: z.number(),
  currentlyAvailable: z.number(),
  restoreRate: z.number(),
});
export type ThrottleStatus = z.infer<typeof throttleStatusSchema>;

export const costSchema = z.object({
  requestedQueryCost: z.number().optional(),
  actualQueryCost: z.number().nullable().optional(),
  throttleStatus: throttleStatusSchema,
});
export type QueryCost = z.infer<typeof costSchema>;

/**
 * Wait until the bucket has at least this much in it before sending again.
 * The plan's number: below roughly 200 points, the next ordinary query is in
 * real danger of being rejected.
 */
export const LOW_WATER_MARK = 200;

/** Never sleep longer than this in one go, however far behind the bucket is. */
const MAX_WAIT_MS = 5_000;

export class LeakyBucket {
  /** Undefined until the first response tells us the real numbers. */
  private status: ThrottleStatus | undefined;
  private observedAt = 0;

  constructor(private readonly lowWaterMark: number = LOW_WATER_MARK) {}

  /** Record what the last response said about the bucket. */
  observe(status: ThrottleStatus, now: number = Date.now()): void {
    this.status = status;
    this.observedAt = now;
  }

  /**
   * The bucket refills continuously, so what it held when we last looked is a
   * floor, not the current level. Project it forward at the restore rate and
   * cap it at the bucket's size.
   */
  availableAt(now: number = Date.now()): number | undefined {
    if (this.status === undefined) return undefined;
    const elapsedSeconds = Math.max(0, now - this.observedAt) / 1000;
    const restored = this.status.currentlyAvailable + elapsedSeconds * this.status.restoreRate;
    return Math.min(restored, this.status.maximumAvailable);
  }

  /**
   * How long to wait before the next request, in milliseconds.
   *
   * Zero until a response has actually been seen — guessing a bucket size
   * would only ever be wrong, and the first request is what tells us.
   */
  delayMs(now: number = Date.now()): number {
    const available = this.availableAt(now);
    if (available === undefined || this.status === undefined) return 0;
    if (available >= this.lowWaterMark) return 0;
    if (this.status.restoreRate <= 0) return MAX_WAIT_MS;

    const deficit = this.lowWaterMark - available;
    const seconds = deficit / this.status.restoreRate;
    return Math.min(Math.ceil(seconds * 1000), MAX_WAIT_MS);
  }

  /** For the doctor script and structured logs. */
  snapshot(): ThrottleStatus | undefined {
    return this.status;
  }
}
