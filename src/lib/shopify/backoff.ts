/** Retry timing for 429s and 5xxs. */

export const MAX_ATTEMPTS = 3;

const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 8_000;

/**
 * Exponential backoff with full jitter.
 *
 * Full jitter rather than a fixed doubling because the worker will eventually
 * run several jobs at once: identical backoff makes them retry in lockstep and
 * hit the same wall together. `random` is injected so a test can pin it.
 *
 * `attempt` is 1-based — the delay *after* the first failure.
 */
export function backoffDelayMs(attempt: number, random: () => number = Math.random): number {
  const ceiling = Math.min(BASE_DELAY_MS * 2 ** (attempt - 1), MAX_DELAY_MS);
  return Math.round(random() * ceiling);
}

/**
 * Honours `Retry-After` when Shopify sends one, falling back to backoff.
 * The header is in seconds and may be fractional.
 */
export function retryDelayMs(
  attempt: number,
  retryAfter: string | null | undefined,
  random: () => number = Math.random,
): number {
  if (retryAfter !== null && retryAfter !== undefined && retryAfter !== "") {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(Math.ceil(seconds * 1000), MAX_DELAY_MS);
    }
  }
  return backoffDelayMs(attempt, random);
}

/** Retry a 429 and any 5xx. A 4xx other than 429 will fail again identically. */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}
