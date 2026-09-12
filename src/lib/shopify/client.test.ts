import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { closeShopifyClient, shopifyRequest, type ShopifyEndpoint } from "./client";
import { ShopifyGraphQLError, ShopifyHttpError, ShopifyThrottledError } from "./errors";

/**
 * The client against a fake Shopify.
 *
 * A real store cannot be reached from CI and a mocked fetch would only prove
 * the mock works. This is a local HTTP server speaking the shapes the Admin
 * API actually returns — a 200 carrying `errors`, a 429, a 5xx — which is
 * where the retry and throttle logic either works or does not.
 */

interface Scripted {
  status?: number;
  headers?: Record<string, string>;
  body: unknown;
}

let server: Server;
let endpoint: ShopifyEndpoint;
let queue: Scripted[] = [];
let received: { token: string | undefined; body: unknown }[] = [];

function throttleStatus(currentlyAvailable: number) {
  return {
    cost: {
      requestedQueryCost: 10,
      actualQueryCost: 10,
      throttleStatus: { maximumAvailable: 2000, currentlyAvailable, restoreRate: 100 },
    },
  };
}

beforeAll(async () => {
  server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      received.push({
        token: request.headers["x-shopify-access-token"] as string | undefined,
        body: JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown,
      });

      const next = queue.shift() ?? { body: { data: {} } };
      response.writeHead(next.status ?? 200, {
        "content-type": "application/json",
        "x-request-id": "req-test-1",
        ...next.headers,
      });
      response.end(JSON.stringify(next.body));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  endpoint = {
    storeDomain: "example-store.myshopify.com",
    apiVersion: "2026-07",
    adminToken: "shpat_not-a-real-token",
    baseUrl: `http://127.0.0.1:${port}`,
  };
});

afterAll(async () => {
  await closeShopifyClient();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function reset(...responses: Scripted[]): void {
  queue = [...responses];
  received = [];
}

const shopSchema = z.object({ shop: z.object({ name: z.string() }) });

function call(schema: z.ZodType = shopSchema) {
  return shopifyRequest({
    operation: "TallyTest",
    query: "query TallyTest { shop { name } }",
    schema,
    endpoint,
  });
}

describe("shopifyRequest", () => {
  it("sends the token and returns parsed data", async () => {
    reset({
      body: { data: { shop: { name: "Party Supplies" } }, extensions: throttleStatus(1900) },
    });

    const data = (await call()) as { shop: { name: string } };
    expect(data.shop.name).toBe("Party Supplies");
    expect(received[0]?.token).toBe("shpat_not-a-real-token");
  });

  it("validates the response against the operation's schema", async () => {
    // A field Shopify stopped returning must fail loudly here, not surface as
    // undefined three layers up.
    reset({ body: { data: { shop: {} }, extensions: throttleStatus(1900) } });
    await expect(call()).rejects.toThrow();
  });

  it("retries a 429 and then succeeds", async () => {
    reset(
      { status: 429, headers: { "retry-after": "0" }, body: { errors: [{ message: "too many" }] } },
      { body: { data: { shop: { name: "Party Supplies" } }, extensions: throttleStatus(1900) } },
    );

    const data = (await call()) as { shop: { name: string } };
    expect(data.shop.name).toBe("Party Supplies");
    expect(received).toHaveLength(2);
  });

  it("retries a 5xx and then succeeds", async () => {
    reset(
      { status: 503, body: { message: "service unavailable" } },
      { body: { data: { shop: { name: "Party Supplies" } }, extensions: throttleStatus(1900) } },
    );

    await expect(call()).resolves.toBeDefined();
    expect(received).toHaveLength(2);
  });

  it("gives up after three attempts and throws a typed HTTP error", async () => {
    reset(
      { status: 500, body: {} },
      { status: 500, body: {} },
      { status: 500, body: {} },
      { body: { data: { shop: { name: "never reached" } } } },
    );

    await expect(call()).rejects.toBeInstanceOf(ShopifyHttpError);
    expect(received).toHaveLength(3);
  });

  it("does not retry a 4xx that will fail again identically", async () => {
    reset({ status: 401, body: { errors: "Invalid API key or access token" } });

    const error = await call().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ShopifyHttpError);
    expect((error as ShopifyHttpError).status).toBe(401);
    expect(received).toHaveLength(1);
  });

  it("retries a THROTTLED error returned with HTTP 200", async () => {
    // Shopify answers a cost overrun with 200 and an error in the body, not a
    // 429. A client that only looked at the status would treat this as fatal.
    reset(
      {
        body: {
          errors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }],
          extensions: throttleStatus(5),
        },
      },
      { body: { data: { shop: { name: "Party Supplies" } }, extensions: throttleStatus(1900) } },
    );

    await expect(call()).resolves.toBeDefined();
    expect(received).toHaveLength(2);
  });

  it("throws ShopifyThrottledError when it is still throttled at the last attempt", async () => {
    const throttled: Scripted = {
      body: {
        errors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }],
        extensions: throttleStatus(1900),
      },
    };
    reset(throttled, throttled, throttled);

    await expect(call()).rejects.toBeInstanceOf(ShopifyThrottledError);
    expect(received).toHaveLength(3);
  });

  it("throws a typed GraphQL error and does not retry it", async () => {
    reset({
      body: {
        errors: [
          { message: "Access denied for shop field", extensions: { code: "ACCESS_DENIED" } },
        ],
      },
    });

    const error = await call().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ShopifyGraphQLError);
    expect((error as ShopifyGraphQLError).isAccessDenied).toBe(true);
    expect((error as ShopifyGraphQLError).requestId).toBe("req-test-1");
    expect(received).toHaveLength(1);
  });
});
