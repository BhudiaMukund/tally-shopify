import { applyWebhook } from "@/lib/catalog/apply-webhook";
import { envVar } from "@/lib/env";
import { errorMessage, log } from "@/lib/log";
import { readWebhookHeaders, verifyWebhookHmac, webhookTopic } from "@/lib/shopify/webhooks";

/**
 * `POST /api/webhooks/shopify` — the mirror's freshness.
 *
 * Reachable without a session. `authorizeRoute` allows `/api/webhooks/` through
 * because Shopify has no cookie to send; the HMAC below is the authentication,
 * and it is the only thing standing between an anonymous request and the
 * catalogue cache. A failed check is a 401 and nothing else happens.
 *
 * Node runtime, not Edge: the handler talks to Mongo through the native driver.
 */
export const runtime = "nodejs";
/** Nothing here is cacheable and a cached webhook would be a silent data loss. */
export const dynamic = "force-dynamic";

/** Shopify gives a webhook five seconds before it counts the delivery as failed. */
const RESPONSE_BUDGET_MS = 5_000;

export async function POST(request: Request): Promise<Response> {
  const startedAt = performance.now();

  // The raw bytes, before anything parses them. `request.json()` here would
  // destroy the exact body the signature covers.
  const body = Buffer.from(await request.arrayBuffer());
  const headers = readWebhookHeaders(request.headers);

  if (!verifyWebhookHmac(body, headers.hmac, envVar("SHOPIFY_WEBHOOK_SECRET"))) {
    log.error("webhook.rejected", {
      reason: "hmac",
      topic: headers.topic,
      shop: headers.shopDomain,
      webhookId: headers.webhookId,
      bytes: body.byteLength,
    });
    return new Response("Signature mismatch", { status: 401 });
  }

  // Verified, so the domain is Shopify's word rather than the sender's. Still
  // checked: one app installed on two stores would otherwise cross-write.
  const expectedShop = envVar("SHOPIFY_STORE_DOMAIN");
  if (headers.shopDomain !== null && headers.shopDomain !== expectedShop) {
    log.error("webhook.rejected", { reason: "shop", shop: headers.shopDomain });
    return new Response("Unexpected shop", { status: 401 });
  }

  const topic = webhookTopic.safeParse(headers.topic);
  if (!topic.success) {
    // Acknowledged on purpose. Retrying a topic we do not handle would achieve
    // nothing and Shopify would keep trying for two days.
    log.warn("webhook.unhandled", { topic: headers.topic, webhookId: headers.webhookId });
    return new Response(null, { status: 200 });
  }

  const fields = {
    topic: topic.data,
    webhookId: headers.webhookId,
    apiVersion: headers.apiVersion,
  };

  try {
    const outcome = await applyWebhook(topic.data, JSON.parse(body.toString("utf8")));
    const ms = Math.round(performance.now() - startedAt);

    log[ms > RESPONSE_BUDGET_MS ? "warn" : "info"]("webhook.applied", {
      ...fields,
      ...outcome,
      ms,
    });
    return new Response(null, { status: 200 });
  } catch (error) {
    log.error("webhook.failed", {
      ...fields,
      message: errorMessage(error),
      ms: Math.round(performance.now() - startedAt),
    });
    // 500 so Shopify retries. The handlers are upserts, so a retry is safe.
    return new Response("Webhook handling failed", { status: 500 });
  }
}
