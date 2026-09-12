import { z } from "zod";

import { shopifyRequest, type ShopifyEndpoint } from "../client";

/**
 * Every location, so the doctor can print the GID for `SHOPIFY_LOCATION_ID`.
 *
 * `includeInactive` is on deliberately: a location that is switched off still
 * has stock against it, and seeing it in the list is how you notice you picked
 * the wrong one.
 *
 * https://shopify.dev/docs/api/admin-graphql/2026-07/queries/locations
 */

const QUERY = `
  query TallyListLocations($first: Int!) {
    locations(first: $first, includeInactive: true) {
      nodes {
        id
        name
        isActive
        address { formatted }
      }
    }
  }
`;

export const listLocationsSchema = z.object({
  locations: z.object({
    nodes: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        isActive: z.boolean(),
        address: z.object({ formatted: z.array(z.string()) }).nullable(),
      }),
    ),
  }),
});

export type ShopifyLocation = z.infer<typeof listLocationsSchema>["locations"]["nodes"][number];

export async function listLocations(endpoint?: ShopifyEndpoint): Promise<ShopifyLocation[]> {
  const data = await shopifyRequest({
    operation: "TallyListLocations",
    query: QUERY,
    variables: { first: 50 },
    schema: listLocationsSchema,
    endpoint,
  });
  return data.locations.nodes;
}
