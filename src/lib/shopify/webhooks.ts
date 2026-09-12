import { createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

/**
 * Webhook authenticity, and nothing else.
 *
 * **This is not `oauth.ts` and must never share a helper with it.** The two
 * verifications look alike and are not alike: OAuth signs a sorted query
 * string with the hmac parameter removed and encodes the digest as hex, while a
 * webhook signs the raw request body, byte for byte, and encodes it as base64.
 * A helper covering both would have to take the difference as a parameter, and
 * the parameter would eventually be passed wrong.
 *
 * The other difference is what a mismatch means. `shopify-install.ts` warns and
 * carries on, because a failed check there is a local script talking to a
 * browser the operator is looking at. Here the request arrives from the open
 * internet and this signature is the *only* evidence it came from Shopify, so a
 * mismatch is fatal — a forged body would otherwise rewrite the mirror.
 *
 * The signing key is the app's client secret, the same `shpss_` value as
 * `SHOPIFY_API_SECRET`; `SHOPIFY_WEBHOOK_SECRET` is the name it goes by here
 * because the running app has no other use for the client secret.
 *
 * https://shopify.dev/docs/apps/build/webhooks/subscribe/https
 */

export const HMAC_HEADER = "x-shopify-hmac-sha256";
export const TOPIC_HEADER = "x-shopify-topic";
export const SHOP_DOMAIN_HEADER = "x-shopify-shop-domain";
export const WEBHOOK_ID_HEADER = "x-shopify-webhook-id";
export const API_VERSION_HEADER = "x-shopify-api-version";
export const TRIGGERED_AT_HEADER = "x-shopify-triggered-at";

/** The four topics Tally subscribes to. Anything else is acknowledged and dropped. */
export const webhookTopic = z.enum([
  "products/create",
  "products/update",
  "products/delete",
  "inventory_levels/update",
]);
export type WebhookTopic = z.infer<typeof webhookTopic>;

/** The same four as the GraphQL enum `WebhookSubscriptionTopic` spells them. */
export const WEBHOOK_TOPIC_ENUM: Readonly<Record<WebhookTopic, string>> = {
  "products/create": "PRODUCTS_CREATE",
  "products/update": "PRODUCTS_UPDATE",
  "products/delete": "PRODUCTS_DELETE",
  "inventory_levels/update": "INVENTORY_LEVELS_UPDATE",
};

export const WEBHOOK_PATH = "/api/webhooks/shopify";

/**
 * Verifies the HMAC over the exact bytes Shopify signed.
 *
 * Takes a `Buffer` rather than a string on purpose. A body read as text and
 * re-encoded is usually identical and occasionally is not — any lone surrogate
 * or invalid UTF-8 sequence comes back as U+FFFD and the digest changes — and a
 * webhook that fails once a month for a product title with an unusual character
 * in it is a miserable thing to debug.
 */
export function verifyWebhookHmac(
  body: Buffer,
  headerValue: string | null | undefined,
  secret: string,
): boolean {
  if (typeof headerValue !== "string" || headerValue === "") return false;

  const expected = createHmac("sha256", secret).update(body).digest();
  // Shopify sends base64. Anything that isn't decodes to the wrong length and
  // fails the comparison below rather than throwing.
  const provided = Buffer.from(headerValue, "base64");

  // timingSafeEqual throws on a length mismatch, which would be both a crash on
  // malformed input and a (very coarse) oracle.
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

/** The headers that matter, lower-cased, from a `Headers` or a plain object. */
export interface WebhookHeaders {
  hmac: string | null;
  topic: string | null;
  shopDomain: string | null;
  webhookId: string | null;
  apiVersion: string | null;
  triggeredAt: string | null;
}

export function readWebhookHeaders(headers: Headers): WebhookHeaders {
  return {
    hmac: headers.get(HMAC_HEADER),
    topic: headers.get(TOPIC_HEADER),
    shopDomain: headers.get(SHOP_DOMAIN_HEADER),
    webhookId: headers.get(WEBHOOK_ID_HEADER),
    apiVersion: headers.get(API_VERSION_HEADER),
    triggeredAt: headers.get(TRIGGERED_AT_HEADER),
  };
}

/**
 * The product webhook payload, in its REST shape.
 *
 * Only the fields that decide *what to do* are read. Everything the mirror
 * stores is re-read from the Admin API afterwards, because the payload carries
 * no publication list and truncates its variant array at 100 — see
 * `get-catalog-product.ts`.
 */
export const productWebhookSchema = z.object({
  id: z.union([z.number(), z.string()]),
  admin_graphql_api_id: z.string().optional(),
  updated_at: z.string().optional(),
  title: z.string().optional(),
});

/**
 * `inventory_levels/update` is the one payload Tally trusts directly: it is
 * three numbers, it names its own location, and re-reading the item would cost
 * a round trip per POS sale. The mirror is a cache and this is cache
 * maintenance — no write to Shopify ever starts from it (CLAUDE.md §1).
 */
export const inventoryLevelWebhookSchema = z.object({
  inventory_item_id: z.union([z.number(), z.string()]),
  location_id: z.union([z.number(), z.string()]),
  available: z.number().int().nullable().optional(),
  updated_at: z.string().optional(),
});

/** `gid://shopify/Product/123` from a numeric webhook id, or from one already given. */
export function toGid(resource: string, id: number | string): string {
  const value = String(id);
  return value.startsWith("gid://") ? value : `gid://shopify/${resource}/${value}`;
}
