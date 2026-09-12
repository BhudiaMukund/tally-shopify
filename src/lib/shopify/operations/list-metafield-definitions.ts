import { z } from "zod";

import { shopifyRequest, type ShopifyEndpoint } from "../client";

/**
 * Product metafield definitions and, where they have them, their allowed
 * values.
 *
 * `validations` is a list of `{ name, value }` where the value is a JSON
 * string — a `choices` validation holds a JSON array of the permitted options.
 * That list is what constrains the AI (CLAUDE.md §12); where a definition has
 * no `choices`, the taxonomy sync falls back to distinct-ing the values
 * actually in use.
 *
 * https://shopify.dev/docs/api/admin-graphql/2026-07/queries/metafieldDefinitions
 */

const QUERY = `
  query TallyListMetafieldDefinitions($first: Int!, $after: String) {
    metafieldDefinitions(ownerType: PRODUCT, first: $first, after: $after) {
      nodes {
        name
        namespace
        key
        type { name }
        validations { name value }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

export const metafieldDefinitionSchema = z.object({
  name: z.string(),
  namespace: z.string(),
  key: z.string(),
  type: z.object({ name: z.string() }),
  validations: z.array(z.object({ name: z.string(), value: z.string().nullable() })),
});
export type MetafieldDefinition = z.infer<typeof metafieldDefinitionSchema>;

export const listMetafieldDefinitionsSchema = z.object({
  metafieldDefinitions: z.object({
    nodes: z.array(metafieldDefinitionSchema),
    pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() }),
  }),
});

/**
 * The permitted values for a definition, or undefined when it does not
 * constrain them. Returns undefined rather than an empty array so the caller
 * can tell "no rule" from "a rule allowing nothing".
 */
export function allowedChoices(definition: MetafieldDefinition): string[] | undefined {
  const choices = definition.validations.find((validation) => validation.name === "choices");
  if (choices?.value == null) return undefined;

  try {
    const parsed: unknown = JSON.parse(choices.value);
    if (!Array.isArray(parsed)) return undefined;
    const values = parsed.filter((value): value is string => typeof value === "string");
    return values.length > 0 ? values : undefined;
  } catch {
    // A definition we cannot read is one we must not silently treat as
    // unconstrained-but-empty. Fall back to counting real usage instead.
    return undefined;
  }
}

export async function listMetafieldDefinitions(
  endpoint?: ShopifyEndpoint,
): Promise<MetafieldDefinition[]> {
  const all: MetafieldDefinition[] = [];
  let after: string | null = null;

  do {
    // Annotated rather than inferred: `after` is both an input to this call and
    // assigned from its result, which TypeScript reads as a circular
    // initializer and quietly widens to `any`.
    const data: z.infer<typeof listMetafieldDefinitionsSchema> = await shopifyRequest({
      operation: "TallyListMetafieldDefinitions",
      query: QUERY,
      variables: { first: 100, after },
      schema: listMetafieldDefinitionsSchema,
      endpoint,
    });
    all.push(...data.metafieldDefinitions.nodes);
    after = data.metafieldDefinitions.pageInfo.hasNextPage
      ? data.metafieldDefinitions.pageInfo.endCursor
      : null;
  } while (after !== null);

  return all;
}
