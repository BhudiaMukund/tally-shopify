import { z } from "zod";

import { shopifyRequest, type ShopifyEndpoint } from "../client";
import { assertNoUserErrors } from "../errors";
import { WEBHOOK_TOPIC_ENUM, type WebhookTopic } from "../webhooks";

/**
 * The four subscriptions that keep `products_mirror` fresh.
 *
 * `uri` is read and written directly rather than through `endpoint`, which is
 * deprecated in 2026-07 — its union exists to distinguish an HTTPS callback
 * from a Pub/Sub topic or an EventBridge ARN, and Tally only ever wants the
 * first.
 *
 * https://shopify.dev/docs/api/admin-graphql/2026-07/mutations/webhookSubscriptionCreate
 * https://shopify.dev/docs/api/admin-graphql/2026-07/objects/WebhookSubscription
 */

const subscriptionSchema = z.object({
  id: z.string(),
  topic: z.string(),
  uri: z.string(),
  apiVersion: z.object({ handle: z.string() }),
});
export type WebhookSubscription = z.infer<typeof subscriptionSchema>;

const LIST_QUERY = `
  query TallyListWebhookSubscriptions($first: Int!) {
    webhookSubscriptions(first: $first) {
      nodes {
        id
        topic
        uri
        apiVersion { handle }
      }
    }
  }
`;

export const listWebhookSubscriptionsSchema = z.object({
  webhookSubscriptions: z.object({ nodes: z.array(subscriptionSchema) }),
});

export async function listWebhookSubscriptions(
  endpoint?: ShopifyEndpoint,
): Promise<WebhookSubscription[]> {
  const data = await shopifyRequest({
    operation: "TallyListWebhookSubscriptions",
    query: LIST_QUERY,
    variables: { first: 100 },
    schema: listWebhookSubscriptionsSchema,
    endpoint,
  });
  return data.webhookSubscriptions.nodes;
}

const CREATE_MUTATION = `
  mutation TallyWebhookSubscriptionCreate(
    $topic: WebhookSubscriptionTopic!
    $webhookSubscription: WebhookSubscriptionInput!
  ) {
    webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) {
      webhookSubscription {
        id
        topic
        uri
        apiVersion { handle }
      }
      userErrors { field message }
    }
  }
`;

export const createWebhookSubscriptionSchema = z.object({
  webhookSubscriptionCreate: z.object({
    webhookSubscription: subscriptionSchema.nullable(),
    userErrors: z.array(z.object({ field: z.array(z.string()).nullable(), message: z.string() })),
  }),
});

export async function createWebhookSubscription(
  topic: WebhookTopic,
  uri: string,
  endpoint?: ShopifyEndpoint,
): Promise<WebhookSubscription> {
  const data = await shopifyRequest({
    operation: "TallyWebhookSubscriptionCreate",
    query: CREATE_MUTATION,
    variables: { topic: WEBHOOK_TOPIC_ENUM[topic], webhookSubscription: { uri } },
    schema: createWebhookSubscriptionSchema,
    endpoint,
  });

  assertNoUserErrors("webhookSubscriptionCreate", data.webhookSubscriptionCreate);

  const subscription = data.webhookSubscriptionCreate.webhookSubscription;
  if (subscription === null) {
    throw new Error("webhookSubscriptionCreate returned no subscription and no userErrors");
  }
  return subscription;
}

const UPDATE_MUTATION = `
  mutation TallyWebhookSubscriptionUpdate(
    $id: ID!
    $webhookSubscription: WebhookSubscriptionInput!
  ) {
    webhookSubscriptionUpdate(id: $id, webhookSubscription: $webhookSubscription) {
      webhookSubscription {
        id
        topic
        uri
        apiVersion { handle }
      }
      userErrors { field message }
    }
  }
`;

export const updateWebhookSubscriptionSchema = z.object({
  webhookSubscriptionUpdate: z.object({
    webhookSubscription: subscriptionSchema.nullable(),
    userErrors: z.array(z.object({ field: z.array(z.string()).nullable(), message: z.string() })),
  }),
});

/** Re-points an existing subscription. The dev tunnel's hostname changes; the topic does not. */
export async function updateWebhookSubscription(
  id: string,
  uri: string,
  endpoint?: ShopifyEndpoint,
): Promise<WebhookSubscription> {
  const data = await shopifyRequest({
    operation: "TallyWebhookSubscriptionUpdate",
    query: UPDATE_MUTATION,
    variables: { id, webhookSubscription: { uri } },
    schema: updateWebhookSubscriptionSchema,
    endpoint,
  });

  assertNoUserErrors("webhookSubscriptionUpdate", data.webhookSubscriptionUpdate);

  const subscription = data.webhookSubscriptionUpdate.webhookSubscription;
  if (subscription === null) {
    throw new Error("webhookSubscriptionUpdate returned no subscription and no userErrors");
  }
  return subscription;
}

export type WebhookPlanAction = "create" | "repoint" | "keep";

export interface WebhookPlanEntry {
  topic: WebhookTopic;
  action: WebhookPlanAction;
  /** The subscription already on the store, when there is one. */
  existing?: WebhookSubscription;
}

/**
 * What would have to change for the four topics to point at `uri`.
 *
 * Pure, so the doctor can print the plan without touching anything. A topic
 * pointing somewhere else is *re-pointed* rather than duplicated: two
 * subscriptions on one topic means every product change is delivered twice, and
 * the second delivery is to a tunnel that closed last Tuesday.
 */
export function planWebhooks(
  existing: readonly WebhookSubscription[],
  uri: string,
  topics: readonly WebhookTopic[],
): WebhookPlanEntry[] {
  return topics.map((topic) => {
    const match = existing.find((entry) => entry.topic === WEBHOOK_TOPIC_ENUM[topic]);
    if (match === undefined) return { topic, action: "create" };
    if (match.uri !== uri) return { topic, action: "repoint", existing: match };
    return { topic, action: "keep", existing: match };
  });
}
