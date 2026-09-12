import { z } from "zod";

import { shopifyRequest, type ShopifyEndpoint } from "../client";

/**
 * Every sales channel the store publishes to, so the doctor can print the GID
 * for `SHOPIFY_POS_PUBLICATION_ID`.
 *
 * **`Publication.name` is deprecated in 2026-07** and still non-null, with no
 * documented replacement — `catalog` carries the channel now, but its title is
 * behind an interface and an `AppCatalog` variant. Both are selected: the
 * catalog title where it exists, `name` as the fallback, because the only
 * consumer is a human choosing from a printed list. Revisit when Shopify names
 * the successor.
 *
 * https://shopify.dev/docs/api/admin-graphql/2026-07/objects/Publication
 */

const QUERY = `
  query TallyListPublications($first: Int!) {
    publications(first: $first) {
      nodes {
        id
        name
        autoPublish
        catalog {
          ... on AppCatalog {
            apps(first: 1) { nodes { handle } }
          }
        }
      }
    }
  }
`;

export const listPublicationsSchema = z.object({
  publications: z.object({
    nodes: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        autoPublish: z.boolean(),
        catalog: z
          .object({
            apps: z.object({ nodes: z.array(z.object({ handle: z.string() })) }).optional(),
          })
          .nullable()
          .optional(),
      }),
    ),
  }),
});

export type ShopifyPublication = z.infer<
  typeof listPublicationsSchema
>["publications"]["nodes"][number];

/** Shopify's app handle for Point of Sale. The channel's app id is 129785. */
export const POS_APP_HANDLE = "pos";

/** True when this publication is the Point of Sale channel rather than a guess at its name. */
export function isPointOfSale(publication: ShopifyPublication): boolean {
  const byHandle = publication.catalog?.apps?.nodes.some((app) => app.handle === POS_APP_HANDLE);
  if (byHandle === true) return true;
  return publication.name.trim().toLowerCase() === "point of sale";
}

export async function listPublications(endpoint?: ShopifyEndpoint): Promise<ShopifyPublication[]> {
  const data = await shopifyRequest({
    operation: "TallyListPublications",
    query: QUERY,
    variables: { first: 50 },
    schema: listPublicationsSchema,
    endpoint,
  });
  return data.publications.nodes;
}
