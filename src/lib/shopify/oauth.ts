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
 * The two candidate messages, built from the *raw* query string.
 *
 * Raw, because the encoding is the whole question and `URLSearchParams` throws
 * it away: once a value has been decoded there is no way back to the bytes
 * Shopify actually signed. Everything here works on the query string as it
 * arrived on the wire.
 *
 * Per the 2026-07 docs, only `hmac` is removed — "Remove the `hmac` parameter
 * from the query string, sort the remaining parameters alphabetically". An
 * earlier version of this function also dropped `signature`, which is an
 * app-proxy parameter that has no business in an OAuth callback; dropping a
 * parameter Shopify did sign is precisely how the message ends up wrong.
 */
export interface CallbackMessages {
  /** Values exactly as they arrived, still percent-encoded. */
  encoded: string;
  /** Values URL-decoded, which is what most framework-parsed query objects give. */
  decoded: string;
  /** The hmac Shopify sent, or undefined. */
  hmac: string | undefined;
  /** Parameter names present, in sorted order. Useful in a debug dump. */
  keys: string[];
}

/** Splits a raw query string without decoding anything. */
function rawPairs(rawQuery: string): { key: string; rawValue: string }[] {
  return rawQuery
    .replace(/^\?/, "")
    .split("&")
    .filter((pair) => pair !== "")
    .map((pair) => {
      const index = pair.indexOf("=");
      return index === -1
        ? { key: pair, rawValue: "" }
        : { key: pair.slice(0, index), rawValue: pair.slice(index + 1) };
    });
}

function decodeComponent(value: string): string {
  try {
    // `+` is a space in application/x-www-form-urlencoded, which is what a
    // query string is. decodeURIComponent alone does not handle it.
    return decodeURIComponent(value.replace(/\+/g, " "));
  } catch {
    return value;
  }
}

export function callbackMessages(rawQuery: string): CallbackMessages {
  const pairs = rawPairs(rawQuery);
  const hmac = pairs.find((pair) => decodeComponent(pair.key) === "hmac")?.rawValue;

  const signed = pairs
    .filter((pair) => decodeComponent(pair.key) !== "hmac")
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  return {
    encoded: signed.map((pair) => `${pair.key}=${pair.rawValue}`).join("&"),
    decoded: signed
      .map((pair) => `${decodeComponent(pair.key)}=${decodeComponent(pair.rawValue)}`)
      .join("&"),
    hmac: hmac === undefined || hmac === "" ? undefined : hmac,
    keys: signed.map((pair) => decodeComponent(pair.key)),
  };
}

function digestOf(message: string, clientSecret: string): string {
  return createHmac("sha256", clientSecret).update(message).digest("hex");
}

function digestMatches(computed: string, provided: string): boolean {
  const a = Buffer.from(computed, "utf8");
  const b = Buffer.from(provided, "utf8");
  // timingSafeEqual throws on a length mismatch, which would itself be a
  // (very coarse) oracle and, more practically, a crash on malformed input.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export type HmacVariant = "encoded" | "decoded";

export interface HmacResult {
  ok: boolean;
  /** Which message construction matched, when one did. */
  variant?: HmacVariant;
  computed: Record<HmacVariant, string>;
  messages: CallbackMessages;
}

/**
 * Verifies the HMAC Shopify appends to the callback, against the raw query.
 *
 * Both encodings are tried because the documentation does not settle it and
 * Shopify's own libraries disagree: the Ruby gem signs the decoded params,
 * while the JS library re-encodes them through `URLSearchParams`. For an
 * ordinary callback the two are byte-identical — `code`, `shop`, `state` and
 * `timestamp` contain nothing that encodes differently — so the question only
 * bites when a parameter like `host` carries base64 padding (`=` → `%3D`).
 * That is almost certainly what broke this install.
 *
 * The encoded form is checked first and is the one to prefer: a decoded
 * message is ambiguous, because a value containing a literal `&` or `=` would
 * join into something indistinguishable from two separate parameters.
 *
 * Accepting either does not weaken anything — producing a valid digest for
 * *either* message still requires the client secret — but once a real callback
 * tells us which one Shopify used, the other should go.
 */
export function verifyCallbackHmacDetailed(rawQuery: string, clientSecret: string): HmacResult {
  const messages = callbackMessages(rawQuery);
  const computed: Record<HmacVariant, string> = {
    encoded: digestOf(messages.encoded, clientSecret),
    decoded: digestOf(messages.decoded, clientSecret),
  };

  if (messages.hmac === undefined) return { ok: false, computed, messages };

  for (const variant of ["encoded", "decoded"] as const) {
    if (digestMatches(computed[variant], messages.hmac)) {
      return { ok: true, variant, computed, messages };
    }
  }
  return { ok: false, computed, messages };
}

/** The yes/no answer. Takes the raw query string, not parsed parameters. */
export function verifyCallbackHmac(rawQuery: string, clientSecret: string): boolean {
  return verifyCallbackHmacDetailed(rawQuery, clientSecret).ok;
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
