import { Agent, request } from "undici";
import type { z } from "zod";

import { envVar } from "@/lib/env";

import { isRetryableStatus, MAX_ATTEMPTS, retryDelayMs } from "./backoff";
import { ShopifyGraphQLError, ShopifyHttpError, ShopifyThrottledError } from "./errors";
import { costSchema, LeakyBucket } from "./throttle";

/**
 * The Admin GraphQL client.
 *
 * One connection pool and one bucket per process. Every operation in
 * `./operations` goes through `shopifyRequest`, which is what makes the rate
 * limiting work at all — a caller that opens its own fetch is invisible to the
 * bucket and will throttle everyone else.
 */

/**
 * Keep-alive matters more here than it looks. Every call is TLS to the same
 * host, and a fresh handshake per request would dominate the p95 of the
 * inventory write, which has a 600ms budget end to end.
 */
let agent: Agent | undefined;
function getAgent(): Agent {
  agent ??= new Agent({
    keepAliveTimeout: 30_000,
    keepAliveMaxTimeout: 120_000,
    connections: 16,
  });
  return agent;
}

const bucket = new LeakyBucket();

/** Exposed for the doctor script and for logging; not for making decisions. */
export function throttleSnapshot() {
  return bucket.snapshot();
}

/** Test seam: point the client at a local server instead of Shopify. */
export interface ShopifyEndpoint {
  storeDomain: string;
  apiVersion: string;
  adminToken: string;
  /** Overrides the scheme+host. Only a test should pass this. */
  baseUrl?: string;
}

function endpointFromEnv(): ShopifyEndpoint {
  return {
    storeDomain: envVar("SHOPIFY_STORE_DOMAIN"),
    apiVersion: envVar("SHOPIFY_API_VERSION"),
    adminToken: envVar("SHOPIFY_ADMIN_TOKEN"),
  };
}

function graphqlUrl(endpoint: ShopifyEndpoint): string {
  const origin = endpoint.baseUrl ?? `https://${endpoint.storeDomain}`;
  return `${origin}/admin/api/${endpoint.apiVersion}/graphql.json`;
}

const sleep = (ms: number): Promise<void> =>
  ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Shopify answers a cost overrun with HTTP 200 and a THROTTLED error rather
 * than a 429 — the rate-limit page calls it a "200 Throttled" response. A
 * client that only retried on status codes would treat it as a hard failure
 * and never come back.
 */
function isThrottledError(errors: readonly { message: string; extensions?: { code?: string } }[]) {
  return errors.some(
    (error) =>
      error.extensions?.code === "THROTTLED" || error.message.toLowerCase().includes("throttled"),
  );
}

export interface ShopifyRequestOptions<TSchema extends z.ZodType> {
  /** Names the call in errors, logs and retries. Use the GraphQL operation name. */
  operation: string;
  query: string;
  variables?: Record<string, unknown>;
  /** Validates `data`. The operation module owns this. */
  schema: TSchema;
  endpoint?: ShopifyEndpoint;
  signal?: AbortSignal;
}

/**
 * Sends one GraphQL operation and returns its parsed `data`.
 *
 * Waits on the bucket first, retries a 429, a 5xx or a THROTTLED response up
 * to `MAX_ATTEMPTS`, and throws a typed error for anything else. `userErrors`
 * are deliberately *not* handled here: they live inside the payload, are
 * shaped differently per mutation, and each operation asserts on them with
 * `assertNoUserErrors`.
 */
export async function shopifyRequest<TSchema extends z.ZodType>({
  operation,
  query,
  variables,
  schema,
  endpoint = endpointFromEnv(),
  signal,
}: ShopifyRequestOptions<TSchema>): Promise<z.infer<TSchema>> {
  const url = graphqlUrl(endpoint);
  const body = JSON.stringify({ query, variables: variables ?? {} });

  let lastThrottle: ShopifyThrottledError | undefined;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    // Pre-emptive: the bucket already told us it is nearly empty.
    await sleep(bucket.delayMs());

    const response = await request(url, {
      method: "POST",
      body,
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        "x-shopify-access-token": endpoint.adminToken,
      },
      dispatcher: getAgent(),
      signal,
    });

    const requestId = header(response.headers, "x-request-id");
    const status = response.statusCode;

    if (status < 200 || status >= 300) {
      const text = await response.body.text();
      if (isRetryableStatus(status) && attempt < MAX_ATTEMPTS) {
        await sleep(retryDelayMs(attempt, header(response.headers, "retry-after")));
        continue;
      }
      throw new ShopifyHttpError(operation, status, requestId, text.slice(0, 2_000));
    }

    const payload = (await response.body.json()) as {
      data?: unknown;
      errors?: { message: string; extensions?: { code?: string } }[];
      extensions?: { cost?: unknown };
    };

    // Read the bucket before deciding anything else: even a throttled response
    // carries the current level, and that is what sizes the next wait.
    const cost = costSchema.safeParse(payload.extensions?.cost);
    if (cost.success) bucket.observe(cost.data.throttleStatus);

    const errors = payload.errors ?? [];
    if (errors.length > 0) {
      if (isThrottledError(errors)) {
        lastThrottle = new ShopifyThrottledError(operation, attempt);
        if (attempt < MAX_ATTEMPTS) {
          // The bucket delay above already covers the wait when the cost
          // extension came through; backoff is the floor when it did not.
          await sleep(Math.max(bucket.delayMs(), retryDelayMs(attempt, null)));
          continue;
        }
        throw lastThrottle;
      }
      throw new ShopifyGraphQLError(operation, errors, requestId);
    }

    return schema.parse(payload.data) as z.infer<TSchema>;
  }

  throw lastThrottle ?? new ShopifyThrottledError(operation, MAX_ATTEMPTS);
}

function header(headers: Record<string, string | string[] | undefined>, name: string) {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

/** Closes the connection pool. Scripts need this or the process hangs. */
export async function closeShopifyClient(): Promise<void> {
  if (agent === undefined) return;
  const open = agent;
  agent = undefined;
  await open.close();
}
