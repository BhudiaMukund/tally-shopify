import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { applyTaxonomyRules, rareValues } from "@/lib/taxonomy-rules";

import { backoffDelayMs, isRetryableStatus, retryDelayMs } from "./backoff";
import { assertNoUserErrors, ShopifyUserError } from "./errors";
import {
  buildAuthorizeUrl,
  isValidShopDomain,
  REQUIRED_SCOPES,
  scopeDifference,
  callbackMessages,
  statesMatch,
  tokenExchangeBody,
  verifyCallbackHmac,
  verifyCallbackHmacDetailed,
} from "./oauth";
import { createTaxonomyAccumulator, parseJsonl } from "./taxonomy-aggregate";
import { LeakyBucket } from "./throttle";

const SECRET = "not-a-real-client-secret";

describe("LeakyBucket", () => {
  it("does not delay until a response has told it the numbers", () => {
    // Guessing a bucket size would only ever be wrong.
    expect(new LeakyBucket().delayMs()).toBe(0);
  });

  it("does not delay while the bucket is comfortably full", () => {
    const bucket = new LeakyBucket();
    bucket.observe({ maximumAvailable: 2000, currentlyAvailable: 1900, restoreRate: 100 }, 0);
    expect(bucket.delayMs(0)).toBe(0);
  });

  it("waits long enough to climb back to the low-water mark", () => {
    const bucket = new LeakyBucket();
    // 100 available, 200 wanted, 100/s restore: one second.
    bucket.observe({ maximumAvailable: 2000, currentlyAvailable: 100, restoreRate: 100 }, 0);
    expect(bucket.delayMs(0)).toBe(1000);
  });

  it("counts the refill that happened while we were away", () => {
    const bucket = new LeakyBucket();
    bucket.observe({ maximumAvailable: 2000, currentlyAvailable: 100, restoreRate: 100 }, 0);
    // Half a second later, 50 points have come back, so only half remains.
    expect(bucket.delayMs(500)).toBe(500);
    expect(bucket.delayMs(1000)).toBe(0);
  });

  it("never reports more than the bucket can hold", () => {
    const bucket = new LeakyBucket();
    bucket.observe({ maximumAvailable: 2000, currentlyAvailable: 1000, restoreRate: 100 }, 0);
    expect(bucket.availableAt(60_000)).toBe(2000);
  });
});

describe("backoff", () => {
  it("grows exponentially and is bounded", () => {
    const ceilings = [1, 2, 3, 4].map((attempt) => backoffDelayMs(attempt, () => 1));
    expect(ceilings).toEqual([500, 1000, 2000, 4000]);
  });

  it("jitters, so parallel workers do not retry in lockstep", () => {
    expect(backoffDelayMs(3, () => 0)).toBe(0);
    expect(backoffDelayMs(3, () => 0.5)).toBe(1000);
  });

  it("honours Retry-After when Shopify sends one", () => {
    expect(retryDelayMs(1, "2")).toBe(2000);
    expect(retryDelayMs(1, "0.5")).toBe(500);
    expect(retryDelayMs(1, "nonsense", () => 1)).toBe(500);
    expect(retryDelayMs(1, null, () => 1)).toBe(500);
  });

  it("retries 429 and 5xx but not an ordinary 4xx", () => {
    expect(isRetryableStatus(429)).toBe(true);
    expect(isRetryableStatus(500)).toBe(true);
    expect(isRetryableStatus(503)).toBe(true);
    expect(isRetryableStatus(401)).toBe(false);
    expect(isRetryableStatus(404)).toBe(false);
    expect(isRetryableStatus(200)).toBe(false);
  });
});

describe("assertNoUserErrors", () => {
  it("throws on a 200 that carried userErrors", () => {
    // The failure that looks like success. CLAUDE.md §11.
    expect(() =>
      assertNoUserErrors("productSet", {
        userErrors: [{ field: ["input", "title"], message: "can't be blank" }],
      }),
    ).toThrow(ShopifyUserError);
  });

  it("names the field and the message so the log is actionable", () => {
    try {
      assertNoUserErrors("productVariantsBulkCreate", {
        userErrors: [
          { field: ["variants", "0", "barcode"], message: "already exists", code: "TAKEN" },
        ],
      });
      expect.unreachable("expected a throw");
    } catch (error) {
      expect((error as Error).message).toContain("variants.0.barcode");
      expect((error as Error).message).toContain("already exists");
      expect((error as Error).message).toContain("[TAKEN]");
    }
  });

  it("passes an empty list and a payload with no userErrors at all", () => {
    expect(() => assertNoUserErrors("x", { userErrors: [] })).not.toThrow();
    expect(() => assertNoUserErrors("x", {})).not.toThrow();
    expect(() => assertNoUserErrors("x", null)).not.toThrow();
  });
});

describe("OAuth", () => {
  it("builds the authorize URL with all nine scopes", () => {
    const url = new URL(
      buildAuthorizeUrl({
        shop: "example-store.myshopify.com",
        clientId: "client-id",
        redirectUri: "http://localhost:3456/auth/callback",
        state: "nonce",
      }),
    );

    expect(url.origin).toBe("https://example-store.myshopify.com");
    expect(url.pathname).toBe("/admin/oauth/authorize");
    expect(url.searchParams.get("scope")?.split(",")).toHaveLength(9);
    expect(url.searchParams.get("scope")).toBe(REQUIRED_SCOPES.join(","));
    expect(url.searchParams.get("state")).toBe("nonce");
  });

  it("refuses a shop domain that is not myshopify.com", () => {
    expect(isValidShopDomain("example-store.myshopify.com")).toBe(true);
    expect(isValidShopDomain("evil.example")).toBe(false);
    expect(isValidShopDomain("example-store.myshopify.com.evil.example")).toBe(false);
    expect(isValidShopDomain("-leading-dash.myshopify.com")).toBe(false);
  });

  /** Signs a message the way Shopify does, for building fixtures. */
  const sign = (message: string): string =>
    createHmac("sha256", SECRET).update(message).digest("hex");

  it("verifies a genuine callback HMAC", () => {
    const signed =
      "code=the-code&shop=example-store.myshopify.com&state=nonce&timestamp=1700000000";
    expect(verifyCallbackHmac(`${signed}&hmac=${sign(signed)}`, SECRET)).toBe(true);
  });

  it("keeps a percent-encoded value encoded in the signed message", () => {
    // This is the bug. `host` is base64 and carries `=` padding, which arrives
    // as %3D. Parsing the callback with URLSearchParams decoded it, so the
    // message being signed no longer matched the bytes Shopify signed — and
    // every callback carrying a host failed with a perfectly correct secret.
    const raw =
      "code=the-code&host=ZXhhbXBsZS1zdG9yZS5teXNob3BpZnkuY29tL2FkbWlu%3D%3D" +
      "&shop=example-store.myshopify.com&state=nonce&timestamp=1700000000";

    const { encoded, decoded } = callbackMessages(raw);
    expect(encoded).toContain("%3D%3D");
    expect(decoded).toContain("==");
    expect(encoded).not.toBe(decoded);

    const result = verifyCallbackHmacDetailed(`${raw}&hmac=${sign(encoded)}`, SECRET);
    expect(result.ok).toBe(true);
    expect(result.variant).toBe("encoded");
  });

  it("still accepts a callback Shopify signed in its decoded form", () => {
    const raw =
      "code=the-code&host=ZXhhbXBsZQ%3D%3D&shop=example-store.myshopify.com&timestamp=1700000000";
    const result = verifyCallbackHmacDetailed(
      `${raw}&hmac=${sign(callbackMessages(raw).decoded)}`,
      SECRET,
    );
    expect(result.ok).toBe(true);
    expect(result.variant).toBe("decoded");
  });

  it("signs every parameter except hmac, signature included", () => {
    // The 2026-07 docs remove only hmac. This function also dropped
    // `signature`, an app-proxy parameter — and dropping something Shopify did
    // sign is exactly how the message comes out wrong.
    const { keys } = callbackMessages(
      "code=c&hmac=deadbeef&shop=example-store.myshopify.com&signature=abc&timestamp=1",
    );
    expect(keys).toEqual(["code", "shop", "signature", "timestamp"]);
    expect(keys).not.toContain("hmac");
  });

  it("sorts lexicographically by key and joins as key=value with &", () => {
    expect(callbackMessages("timestamp=3&code=1&shop=2&hmac=x").encoded).toBe(
      "code=1&shop=2&timestamp=3",
    );
  });

  it("rejects a tampered callback", () => {
    const signed = "code=the-code&shop=example-store.myshopify.com&timestamp=1700000000";
    // Swapping the shop after signing is the attack that matters: it would
    // point the token exchange at a store the attacker controls.
    const tampered = "code=the-code&shop=evil-store.myshopify.com&timestamp=1700000000";
    expect(verifyCallbackHmac(`${tampered}&hmac=${sign(signed)}`, SECRET)).toBe(false);
  });

  it("rejects a missing, empty or malformed hmac instead of throwing", () => {
    const signed = "shop=example-store.myshopify.com";
    expect(verifyCallbackHmac(signed, SECRET)).toBe(false);
    expect(verifyCallbackHmac(`${signed}&hmac=`, SECRET)).toBe(false);
    expect(verifyCallbackHmac(`${signed}&hmac=zz-not-hex`, SECRET)).toBe(false);
    expect(verifyCallbackHmac(`${signed}&hmac=ab`, SECRET)).toBe(false);
  });

  it("reports both digests, so one debug run settles which Shopify used", () => {
    const result = verifyCallbackHmacDetailed("code=c&shop=s&hmac=deadbeef", SECRET);
    expect(result.ok).toBe(false);
    expect(result.computed.encoded).toMatch(/^[0-9a-f]{64}$/);
    expect(result.computed.decoded).toMatch(/^[0-9a-f]{64}$/);
    expect(result.messages.hmac).toBe("deadbeef");
  });

  it("compares the state nonce without crashing on a missing one", () => {
    expect(statesMatch("nonce", "nonce")).toBe(true);
    expect(statesMatch("nonce", "other")).toBe(false);
    expect(statesMatch("nonce", null)).toBe(false);
    expect(statesMatch("nonce", "nonce-longer")).toBe(false);
  });

  it("asks for a non-expiring offline token", () => {
    // `expiring=1` would return a token that dies in an hour plus a refresh
    // token. Omitting it defaults to 0, which is what we want.
    const body = tokenExchangeBody({ clientId: "id", clientSecret: SECRET, code: "code" });
    expect(body.get("expiring")).toBeNull();
    expect(body.get("client_id")).toBe("id");
    expect(body.get("code")).toBe("code");
  });

  it("reports scopes the install did not grant", () => {
    const { missing, extra } = scopeDifference("read_products,write_products,read_orders");
    expect(missing).toContain("write_inventory");
    expect(missing).not.toContain("read_products");
    expect(extra).toEqual(["read_orders"]);
  });
});

describe("taxonomy aggregation", () => {
  /** Synthetic bulk output. Shapes copied from the docs, values invented. */
  const JSONL = [
    '{"id":"gid://shopify/Product/1","productType":"Candle","vendor":"Acme","category":{"name":"Candles"},"options":[{"name":"Size"}]}',
    '{"key":"color-pattern","value":"Gold","type":"single_line_text_field","__parentId":"gid://shopify/Product/1"}',
    '{"id":"gid://shopify/Product/2","productType":"Candles","vendor":"Acme","category":{"name":"Candles"},"options":[{"name":"Size"},{"name":"Colour"}]}',
    '{"key":"color-pattern","value":"[\\"Gold\\",\\"Silver\\"]","type":"list.single_line_text_field","__parentId":"gid://shopify/Product/2"}',
    '{"id":"gid://shopify/Product/3","productType":"Balloon","vendor":"Zephyr","category":null,"options":[]}',
    '{"key":"celebration-type","value":"gid://shopify/Metaobject/9","type":"metaobject_reference","__parentId":"gid://shopify/Product/3"}',
    "",
  ].join("\n");

  function aggregate() {
    const accumulator = createTaxonomyAccumulator();
    for (const line of parseJsonl(JSONL)) accumulator.add(line);
    return accumulator.result();
  }

  it("counts products, not lines", () => {
    // The metafield lines are children and must not inflate the total.
    expect(aggregate().productCount).toBe(3);
  });

  it("counts distinct values with their frequency", () => {
    const { values } = aggregate();
    expect(values.vendor).toEqual(
      expect.arrayContaining([
        { value: "Acme", count: 2 },
        { value: "Zephyr", count: 1 },
      ]),
    );
    expect(values.optionName).toEqual(
      expect.arrayContaining([
        { value: "Size", count: 2 },
        { value: "Colour", count: 1 },
      ]),
    );
  });

  it("unpacks a list-typed metafield into its members", () => {
    const { values } = aggregate();
    expect(values.color).toEqual(
      expect.arrayContaining([
        { value: "Gold", count: 2 },
        { value: "Silver", count: 1 },
      ]),
    );
  });

  it("skips metaobject references rather than offering the AI a GID", () => {
    const { values, referenceOnly } = aggregate();
    expect(values.celebrationType).toBeUndefined();
    expect(referenceOnly.celebrationType).toBe(1);
  });

  it("ignores a product with no category rather than counting an empty one", () => {
    expect(aggregate().values.category).toEqual([{ value: "Candles", count: 2 }]);
  });
});

describe("applyTaxonomyRules", () => {
  it("merges an alias and sums the counts", () => {
    // Candle 40 + Candles 2 is one category used 42 times, not a category and
    // a mistake.
    const merged = applyTaxonomyRules("productType", [
      { value: "Candle", count: 40 },
      { value: "Candles", count: 2 },
      { value: "Balloon", count: 10 },
    ]);

    expect(merged).toEqual([
      { value: "Candle", count: 42 },
      { value: "Balloon", count: 10 },
    ]);
  });

  it("matches an alias whatever its case, and writes the canonical spelling", () => {
    expect(applyTaxonomyRules("productType", [{ value: "candles", count: 3 }])).toEqual([
      { value: "Candle", count: 3 },
    ]);
  });

  it("folds values that differ only by case or padding", () => {
    expect(
      applyTaxonomyRules("vendor", [
        { value: "Acme", count: 2 },
        { value: "ACME", count: 1 },
        { value: "  Acme  ", count: 1 },
      ]),
    ).toEqual([{ value: "Acme", count: 4 }]);
  });

  it("drops an empty value instead of writing a blank enum member", () => {
    expect(applyTaxonomyRules("vendor", [{ value: "   ", count: 5 }])).toEqual([]);
  });

  it("sorts most-used first so the tail is where the typos are", () => {
    const sorted = applyTaxonomyRules("vendor", [
      { value: "Rare", count: 1 },
      { value: "Common", count: 90 },
    ]);
    expect(sorted.map((entry) => entry.value)).toEqual(["Common", "Rare"]);
  });

  it("flags anything used fewer than three times", () => {
    const rare = rareValues([
      { value: "Common", count: 90 },
      { value: "Typo", count: 1 },
      { value: "Borderline", count: 2 },
      { value: "Fine", count: 3 },
    ]);
    expect(rare.map((entry) => entry.value)).toEqual(["Typo", "Borderline"]);
  });
});
