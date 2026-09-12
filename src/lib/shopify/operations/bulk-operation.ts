import { z } from "zod";

import { shopifyRequest, type ShopifyEndpoint } from "../client";
import { assertNoUserErrors } from "../errors";

/**
 * Bulk query: start one, then poll it.
 *
 * Polling uses `node(id:)` rather than `currentBulkOperation`, which **is
 * deprecated in 2026-07** ("Use bulkOperations with status filter instead").
 * `node` is better than either for this job: both alternatives answer "what is
 * the newest operation", which is a different question from "how is *mine*
 * doing" the moment anything else on the store starts one.
 *
 * https://shopify.dev/docs/api/usage/bulk-operations/queries
 * https://shopify.dev/docs/api/admin-graphql/2026-07/objects/BulkOperation
 */

export const bulkOperationStatus = z.enum([
  "CANCELED",
  "CANCELING",
  "COMPLETED",
  "CREATED",
  "EXPIRED",
  "FAILED",
  "RUNNING",
]);
export type BulkOperationStatus = z.infer<typeof bulkOperationStatus>;

export const bulkOperationSchema = z.object({
  id: z.string(),
  status: bulkOperationStatus,
  errorCode: z.string().nullable(),
  objectCount: z.string(),
  /** Null until COMPLETED. Expires seven days after the operation finishes. */
  url: z.string().nullable(),
  partialDataUrl: z.string().nullable(),
});
export type BulkOperation = z.infer<typeof bulkOperationSchema>;

const RUN_MUTATION = `
  mutation TallyBulkOperationRunQuery($query: String!) {
    bulkOperationRunQuery(query: $query) {
      bulkOperation {
        id
        status
        errorCode
        objectCount
        url
        partialDataUrl
      }
      userErrors { field message }
    }
  }
`;

export const runBulkQuerySchema = z.object({
  bulkOperationRunQuery: z.object({
    bulkOperation: bulkOperationSchema.nullable(),
    userErrors: z.array(z.object({ field: z.array(z.string()).nullable(), message: z.string() })),
  }),
});

/**
 * Starts a bulk query. Only one may run per store at a time — a second returns
 * a userError rather than queueing, which `assertNoUserErrors` turns into a
 * throw rather than a null nobody checked.
 */
export async function runBulkQuery(
  query: string,
  endpoint?: ShopifyEndpoint,
): Promise<BulkOperation> {
  const data = await shopifyRequest({
    operation: "TallyBulkOperationRunQuery",
    query: RUN_MUTATION,
    variables: { query },
    schema: runBulkQuerySchema,
    endpoint,
  });

  assertNoUserErrors("bulkOperationRunQuery", data.bulkOperationRunQuery);

  const operation = data.bulkOperationRunQuery.bulkOperation;
  if (operation === null) {
    throw new Error("bulkOperationRunQuery returned no operation and no userErrors");
  }
  return operation;
}

const NODE_QUERY = `
  query TallyGetBulkOperation($id: ID!) {
    node(id: $id) {
      ... on BulkOperation {
        id
        status
        errorCode
        objectCount
        url
        partialDataUrl
      }
    }
  }
`;

export const getBulkOperationSchema = z.object({
  node: bulkOperationSchema.nullable(),
});

export async function getBulkOperation(
  id: string,
  endpoint?: ShopifyEndpoint,
): Promise<BulkOperation> {
  const data = await shopifyRequest({
    operation: "TallyGetBulkOperation",
    query: NODE_QUERY,
    variables: { id },
    schema: getBulkOperationSchema,
    endpoint,
  });

  if (data.node === null) throw new Error(`Bulk operation ${id} not found`);
  return data.node;
}

/** Statuses that will never change again. */
export function isTerminal(status: BulkOperationStatus): boolean {
  return (
    status === "COMPLETED" || status === "FAILED" || status === "CANCELED" || status === "EXPIRED"
  );
}
