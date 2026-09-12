import { z } from "zod";

import { shopifyRequest, type ShopifyEndpoint } from "../client";

/**
 * The cheapest possible call that proves a token works and says whose store it
 * opened. `shopify-doctor` leads with this.
 *
 * https://shopify.dev/docs/api/admin-graphql/2026-07/queries/shop
 */

const QUERY = `
  query TallyGetShop {
    shop {
      name
      myshopifyDomain
      currencyCode
      plan { displayName }
    }
  }
`;

export const getShopSchema = z.object({
  shop: z.object({
    name: z.string(),
    myshopifyDomain: z.string(),
    currencyCode: z.string(),
    plan: z.object({ displayName: z.string() }),
  }),
});

export type ShopInfo = z.infer<typeof getShopSchema>["shop"];

export async function getShop(endpoint?: ShopifyEndpoint): Promise<ShopInfo> {
  const data = await shopifyRequest({
    operation: "TallyGetShop",
    query: QUERY,
    schema: getShopSchema,
    endpoint,
  });
  return data.shop;
}
