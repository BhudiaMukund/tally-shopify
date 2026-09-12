import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { verifyCallbackHmac } from "./oauth";
import { planWebhooks, type WebhookSubscription } from "./operations/webhook-subscriptions";
import {
  inventoryLevelWebhookSchema,
  productWebhookSchema,
  toGid,
  verifyWebhookHmac,
  webhookTopic,
  WEBHOOK_TOPIC_ENUM,
} from "./webhooks";

/**
 * The HMAC is the only thing proving a webhook came from Shopify. Everything
 * else in this file is shape-checking; this part is the security boundary.
 *
 * The key is deliberately *not* shaped like a real one. A plausible-looking
 * `shpss_…` fixture trips GitHub's push protection, and a test that has to be
 * allow-listed past a secret scanner teaches everyone to wave the scanner
 * through. Nothing here depends on the format.
 */
const SECRET = "not-a-real-client-secret";

function sign(body: Buffer | string, secret = SECRET): string {
  return createHmac("sha256", secret).update(body).digest("base64");
}

describe("verifyWebhookHmac", () => {
  const body = Buffer.from(JSON.stringify({ id: 123, title: "Foil Balloon 45cm" }), "utf8");

  it("accepts a body signed with the client secret", () => {
    expect(verifyWebhookHmac(body, sign(body), SECRET)).toBe(true);
  });

  it("rejects a body that changed by one byte", () => {
    const signature = sign(body);
    const tampered = Buffer.from(body);
    tampered[tampered.length - 3] = tampered[tampered.length - 3]! ^ 0x01;
    expect(verifyWebhookHmac(tampered, signature, SECRET)).toBe(false);
  });

  it("rejects a signature made with a different secret", () => {
    expect(verifyWebhookHmac(body, sign(body, "a-different-client-secret"), SECRET)).toBe(false);
  });

  it("rejects a missing, empty or truncated header rather than throwing", () => {
    expect(verifyWebhookHmac(body, null, SECRET)).toBe(false);
    expect(verifyWebhookHmac(body, undefined, SECRET)).toBe(false);
    expect(verifyWebhookHmac(body, "", SECRET)).toBe(false);
    expect(verifyWebhookHmac(body, sign(body).slice(0, 20), SECRET)).toBe(false);
    expect(verifyWebhookHmac(body, "not base64 at all!!", SECRET)).toBe(false);
  });

  it("signs the exact bytes, not a re-encoding of them", () => {
    // A body carrying invalid UTF-8 survives as a Buffer and does not as a
    // string — Buffer.from(body.toString()) would replace it with U+FFFD and
    // compute a different digest.
    const raw = Buffer.concat([
      Buffer.from('{"title":"'),
      Buffer.from([0xed, 0xa0, 0x80]),
      Buffer.from('"}'),
    ]);
    expect(verifyWebhookHmac(raw, sign(raw), SECRET)).toBe(true);
    expect(verifyWebhookHmac(Buffer.from(raw.toString("utf8"), "utf8"), sign(raw), SECRET)).toBe(
      false,
    );
  });

  it("is not interchangeable with the OAuth callback check", () => {
    // Same secret, same bytes, different construction and different encoding.
    // If these two ever agreed, one of them would be verifying the wrong thing.
    const query = "code=abc&shop=example.myshopify.com";
    const webhookStyle = sign(Buffer.from(query, "utf8"));
    expect(verifyCallbackHmac(`${query}&hmac=${webhookStyle}`, SECRET)).toBe(false);
  });
});

describe("webhookTopic", () => {
  it("covers the four topics the mirror needs and nothing else", () => {
    expect(webhookTopic.options).toEqual([
      "products/create",
      "products/update",
      "products/delete",
      "inventory_levels/update",
    ]);
    expect(webhookTopic.safeParse("orders/create").success).toBe(false);
  });

  it("maps each to the GraphQL enum spelling", () => {
    for (const topic of webhookTopic.options) {
      expect(WEBHOOK_TOPIC_ENUM[topic]).toBe(topic.toUpperCase().replace("/", "_"));
    }
  });
});

describe("payload schemas", () => {
  it("reads a product id whether it arrives as a number or a string", () => {
    expect(productWebhookSchema.parse({ id: 9615614574760 }).id).toBe(9615614574760);
    expect(productWebhookSchema.parse({ id: "9615614574760" }).id).toBe("9615614574760");
  });

  it("takes the inventory level's own location and quantity", () => {
    const level = inventoryLevelWebhookSchema.parse({
      inventory_item_id: 4242,
      location_id: 77,
      available: 12,
      updated_at: "2026-09-12T00:00:00Z",
    });
    expect(toGid("InventoryItem", level.inventory_item_id)).toBe(
      "gid://shopify/InventoryItem/4242",
    );
    expect(level.available).toBe(12);
  });

  it("accepts a null available — an untracked item still sends the event", () => {
    expect(
      inventoryLevelWebhookSchema.parse({
        inventory_item_id: 1,
        location_id: 2,
        available: null,
      }).available,
    ).toBeNull();
  });
});

describe("toGid", () => {
  it("leaves a GID alone and builds one from a number", () => {
    expect(toGid("Product", 5)).toBe("gid://shopify/Product/5");
    expect(toGid("Product", "gid://shopify/Product/5")).toBe("gid://shopify/Product/5");
  });
});

describe("planWebhooks", () => {
  const uri = "https://tally.example.com/api/webhooks/shopify";
  const subscription = (topic: string, at: string): WebhookSubscription => ({
    id: `gid://shopify/WebhookSubscription/${topic}`,
    topic,
    uri: at,
    apiVersion: { handle: "2026-07" },
  });

  it("creates what is missing", () => {
    expect(planWebhooks([], uri, webhookTopic.options).map((entry) => entry.action)).toEqual([
      "create",
      "create",
      "create",
      "create",
    ]);
  });

  it("keeps what already points at us", () => {
    const existing = webhookTopic.options.map((topic) =>
      subscription(WEBHOOK_TOPIC_ENUM[topic], uri),
    );
    expect(
      planWebhooks(existing, uri, webhookTopic.options).every((e) => e.action === "keep"),
    ).toBe(true);
  });

  it("re-points a subscription left on an old tunnel rather than adding a second", () => {
    const stale = subscription(
      "PRODUCTS_UPDATE",
      "https://old-tunnel.example.com/api/webhooks/shopify",
    );
    const plan = planWebhooks([stale], uri, webhookTopic.options);
    const update = plan.find((entry) => entry.topic === "products/update");

    expect(update?.action).toBe("repoint");
    expect(update?.existing?.id).toBe(stale.id);
    // Two subscriptions on one topic means every change is delivered twice.
    expect(plan.filter((entry) => entry.topic === "products/update")).toHaveLength(1);
  });
});
