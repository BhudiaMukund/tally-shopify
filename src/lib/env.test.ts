import { describe, expect, it } from "vitest";

import { EnvValidationError, parseEnv } from "@/lib/env";

/** A complete, syntactically valid environment. No real store values. */
function validEnv(): Record<string, string> {
  return {
    APP_URL: "https://tally.example.com",
    AUTH_SECRET: "0".repeat(32),
    NODE_ENV: "test",
    MONGODB_URI: "mongodb://user:pass@localhost:27017/tally?replicaSet=rs0&authSource=admin",
    REDIS_URL: "redis://localhost:6379",
    S3_ENDPOINT: "http://localhost:9000",
    S3_PUBLIC_URL: "https://files.tally.example.com",
    S3_BUCKET: "tally",
    S3_ACCESS_KEY: "access",
    S3_SECRET_KEY: "secret",
    SHOPIFY_STORE_DOMAIN: "example-store.myshopify.com",
    SHOPIFY_ADMIN_TOKEN: "shpat_not-a-real-token",
    SHOPIFY_API_VERSION: "2026-07",
    SHOPIFY_LOCATION_ID: "gid://shopify/Location/1",
    SHOPIFY_POS_PUBLICATION_ID: "gid://shopify/Publication/2",
    SHOPIFY_WEBHOOK_SECRET: "whsec",
    AI_PROVIDER: "gemini",
    GEMINI_API_KEY: "key",
    GEMINI_MODEL: "gemini-flash-latest",
    AI_PROMPT_VERSION: "1",
  };
}

describe("parseEnv", () => {
  it("accepts a complete environment", () => {
    const env = parseEnv(validEnv());
    expect(env.SHOPIFY_API_VERSION).toBe("2026-07");
    expect(env.AI_PROMPT_VERSION).toBe(1);
  });

  it("applies defaults for the optional keys", () => {
    const source = validEnv();
    delete source.NODE_ENV;
    delete source.AI_PROVIDER;
    delete source.GEMINI_MODEL;
    delete source.AI_PROMPT_VERSION;

    const env = parseEnv(source);
    expect(env.NODE_ENV).toBe("development");
    expect(env.AI_PROVIDER).toBe("gemini");
    expect(env.GEMINI_MODEL).toBe("gemini-flash-latest");
    expect(env.AI_PROMPT_VERSION).toBe(1);
  });

  it("reports every missing variable at once, not just the first", () => {
    const source = validEnv();
    delete source.AUTH_SECRET;
    delete source.MONGODB_URI;
    delete source.SHOPIFY_ADMIN_TOKEN;

    try {
      parseEnv(source);
      expect.unreachable("expected parseEnv to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError);
      const failure = error as EnvValidationError;
      expect(failure.missing).toEqual(["AUTH_SECRET", "MONGODB_URI", "SHOPIFY_ADMIN_TOKEN"]);
      expect(failure.invalid).toEqual([]);
      expect(failure.message).toContain("3 problems");
      for (const key of failure.missing) expect(failure.message).toContain(key);
    }
  });

  it("treats a blank value as missing, not as an invalid one", () => {
    const source = { ...validEnv(), S3_ACCESS_KEY: "", S3_SECRET_KEY: "   " };

    expect(() => parseEnv(source)).toThrowError(EnvValidationError);
    try {
      parseEnv(source);
    } catch (error) {
      const failure = error as EnvValidationError;
      expect(failure.missing).toEqual(["S3_ACCESS_KEY", "S3_SECRET_KEY"]);
    }
  });

  it("separates malformed values from missing ones and says what is wrong", () => {
    const source: Record<string, string | undefined> = {
      ...validEnv(),
      SHOPIFY_API_VERSION: "2026/07",
      SHOPIFY_LOCATION_ID: "gid://shopify/Location/<id>",
    };
    delete source.GEMINI_API_KEY;

    try {
      parseEnv(source);
      expect.unreachable("expected parseEnv to throw");
    } catch (error) {
      const failure = error as EnvValidationError;
      expect(failure.missing).toEqual(["GEMINI_API_KEY"]);
      expect(failure.invalid.map((entry) => entry.key)).toEqual([
        "SHOPIFY_API_VERSION",
        "SHOPIFY_LOCATION_ID",
      ]);
      expect(failure.message).toContain("must look like 2026-07");
    }
  });

  it("ignores unrelated variables in the ambient environment", () => {
    expect(() => parseEnv({ ...validEnv(), PATH: "/usr/bin", CI: "true" })).not.toThrow();
  });
});
