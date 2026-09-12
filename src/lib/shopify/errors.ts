/**
 * The four ways a Shopify call fails, kept apart because the caller does
 * something different about each.
 */

export interface ShopifyUserErrorEntry {
  field: readonly string[] | null;
  message: string;
  code?: string | null;
}

/**
 * A mutation that returned 200 with `userErrors`.
 *
 * This is the failure mode that quietly corrupts data: Shopify answers OK, the
 * JSON parses, and nothing happened. CLAUDE.md §11 — every mutation checks
 * `userErrors`, and a non-empty list is an error, not a warning.
 */
export class ShopifyUserError extends Error {
  readonly operation: string;
  readonly userErrors: readonly ShopifyUserErrorEntry[];

  constructor(operation: string, userErrors: readonly ShopifyUserErrorEntry[]) {
    const detail = userErrors
      .map((entry) => {
        const path = entry.field?.join(".") ?? "";
        const code = entry.code ? ` [${entry.code}]` : "";
        return path === "" ? `${entry.message}${code}` : `${path}: ${entry.message}${code}`;
      })
      .join("; ");

    super(`${operation} failed: ${detail}`);
    this.name = "ShopifyUserError";
    this.operation = operation;
    this.userErrors = userErrors;
  }
}

/** A GraphQL-level error: a bad query, a missing scope, an unknown field. */
export class ShopifyGraphQLError extends Error {
  readonly operation: string;
  readonly errors: readonly { message: string; extensions?: { code?: string } }[];
  readonly requestId: string | undefined;

  constructor(
    operation: string,
    errors: readonly { message: string; extensions?: { code?: string } }[],
    requestId: string | undefined,
  ) {
    super(`${operation}: ${errors.map((error) => error.message).join("; ")}`);
    this.name = "ShopifyGraphQLError";
    this.operation = operation;
    this.errors = errors;
    this.requestId = requestId;
  }

  /** True when Shopify rejected the query itself rather than the data. */
  get isAccessDenied(): boolean {
    return this.errors.some((error) => error.extensions?.code === "ACCESS_DENIED");
  }
}

/** A non-2xx response, after retries were exhausted. */
export class ShopifyHttpError extends Error {
  readonly status: number;
  readonly requestId: string | undefined;
  readonly body: string;

  constructor(operation: string, status: number, requestId: string | undefined, body: string) {
    super(`${operation}: Shopify returned HTTP ${status}`);
    this.name = "ShopifyHttpError";
    this.status = status;
    this.requestId = requestId;
    this.body = body;
  }
}

/** Still throttled after the last attempt. Distinct so a caller can slow down. */
export class ShopifyThrottledError extends Error {
  readonly operation: string;
  readonly attempts: number;

  constructor(operation: string, attempts: number) {
    super(`${operation}: still throttled after ${attempts} attempts`);
    this.name = "ShopifyThrottledError";
    this.operation = operation;
    this.attempts = attempts;
  }
}

/**
 * Throws when a mutation payload carries `userErrors`.
 *
 * Call it on every mutation result. A 200 with userErrors is a failure
 * (CLAUDE.md §11), and the one thing that must never happen is treating it as
 * a success because the HTTP layer was happy.
 */
export function assertNoUserErrors(
  operation: string,
  payload: { userErrors?: readonly ShopifyUserErrorEntry[] } | null | undefined,
): void {
  const userErrors = payload?.userErrors;
  if (userErrors !== undefined && userErrors.length > 0) {
    throw new ShopifyUserError(operation, userErrors);
  }
}
