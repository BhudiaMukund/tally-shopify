import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * The pure half of the OAuth install flow, so the parts that must not be got
 * wrong can be tested without a browser or a store.
 *
 * https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/authorization-code-grant
 */

/** The nine scopes from BUILD_PLAN §3. Order is not significant to Shopify. */
export const REQUIRED_SCOPES = [
  "read_products",
  "write_products",
  "read_inventory",
  "write_inventory",
  "read_locations",
  "read_publications",
  "write_publications",
  "read_files",
  "write_files",
] as const;

/** Shopify's own rule for a store domain, from the callback validation steps. */
const SHOP_DOMAIN = /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/;

export function isValidShopDomain(shop: string): boolean {
  return SHOP_DOMAIN.test(shop);
}

export function buildAuthorizeUrl(options: {
  shop: string;
  clientId: string;
  redirectUri: string;
  state: string;
  scopes?: readonly string[];
}): string {
  if (!isValidShopDomain(options.shop)) {
    throw new Error(`"${options.shop}" is not a <store>.myshopify.com domain`);
  }

  const url = new URL(`https://${options.shop}/admin/oauth/authorize`);
  url.searchParams.set("client_id", options.clientId);
  url.searchParams.set("scope", (options.scopes ?? REQUIRED_SCOPES).join(","));
  url.searchParams.set("redirect_uri", options.redirectUri);
  url.searchParams.set("state", options.state);
  return url.toString();
}

/**
 * Verifies the HMAC Shopify appends to the callback.
 *
 * Drop `hmac`, sort the rest alphabetically, join as `key=value&…`, sign with
 * the client secret, compare in constant time. `signature` is dropped too — it
 * is the legacy sibling of `hmac` and was never part of the signed message.
 */
export function verifyCallbackHmac(params: URLSearchParams, clientSecret: string): boolean {
  const provided = params.get("hmac");
  if (provided === null || provided === "") return false;

  const message = [...params.entries()]
    .filter(([key]) => key !== "hmac" && key !== "signature")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");

  const expected = createHmac("sha256", clientSecret).update(message).digest();

  let supplied: Buffer;
  try {
    supplied = Buffer.from(provided, "hex");
  } catch {
    return false;
  }
  // timingSafeEqual throws on a length mismatch, which would itself be a
  // (very coarse) oracle and, more practically, a crash on malformed input.
  if (supplied.length !== expected.length) return false;
  return timingSafeEqual(supplied, expected);
}

/** Constant-time compare for the state nonce. Lengths are ours, so equal by construction. */
export function statesMatch(expected: string, received: string | null): boolean {
  if (received === null) return false;
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(received, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export interface AccessTokenResponse {
  access_token: string;
  scope: string;
}

/**
 * Exchanges the one-time code for a permanent offline token.
 *
 * `expiring` is deliberately absent: it defaults to 0, and 0 is the
 * non-expiring offline token we want. Passing `expiring=1` returns a token
 * that dies in an hour plus a refresh token, which would mean building refresh
 * handling into a stockroom scanner for no reason.
 */
export function tokenExchangeBody(options: {
  clientId: string;
  clientSecret: string;
  code: string;
}): URLSearchParams {
  return new URLSearchParams({
    client_id: options.clientId,
    client_secret: options.clientSecret,
    code: options.code,
  });
}

/** Names any scope Shopify granted that we did not ask for, or withheld. */
export function scopeDifference(granted: string): {
  missing: string[];
  extra: string[];
} {
  const got = new Set(
    granted
      .split(",")
      .map((scope) => scope.trim())
      .filter((scope) => scope !== ""),
  );
  const wanted = new Set<string>(REQUIRED_SCOPES);

  return {
    missing: [...wanted].filter((scope) => !got.has(scope)),
    extra: [...got].filter((scope) => !wanted.has(scope)),
  };
}
