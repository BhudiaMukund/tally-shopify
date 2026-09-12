import { afterEach, describe, expect, it } from "vitest";

import { EnvValidationError, envVar, parseEnv } from "@/lib/env";

/** A complete, syntactically valid environment. No real store values. */
function validEnv(): Record<string, string> {
  return {
    APP_URL: "https://tally.example.com",
    AUTH_SECRET: "0".repeat(32),
    NODE_ENV: "test",
    MONGODB_URI: "mongodb://user:pass@localhost:27017/tally?authSource=admin",
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

describe("parseEnv — AI provider keys", () => {
  function missingKeysFor(source: Record<string, string | undefined>): readonly string[] {
    try {
      parseEnv(source);
      return [];
    } catch (error) {
      return (error as EnvValidationError).missing;
    }
  }

  it("accepts gemini with its own key and no anthropic key", () => {
    const source: Record<string, string | undefined> = { ...validEnv(), AI_PROVIDER: "gemini" };
    delete source.ANTHROPIC_API_KEY;

    expect(parseEnv(source).AI_PROVIDER).toBe("gemini");
  });

  it("requires GEMINI_API_KEY when gemini is selected", () => {
    const source: Record<string, string | undefined> = { ...validEnv(), AI_PROVIDER: "gemini" };
    delete source.GEMINI_API_KEY;

    expect(missingKeysFor(source)).toEqual(["GEMINI_API_KEY"]);
  });

  it("accepts anthropic with its own key and no gemini key", () => {
    const source: Record<string, string | undefined> = {
      ...validEnv(),
      AI_PROVIDER: "anthropic",
      ANTHROPIC_API_KEY: "anthropic-key",
    };
    delete source.GEMINI_API_KEY;

    const env = parseEnv(source);
    expect(env.AI_PROVIDER).toBe("anthropic");
    expect(env.GEMINI_API_KEY).toBeUndefined();
  });

  it("requires ANTHROPIC_API_KEY when anthropic is selected", () => {
    const source = { ...validEnv(), AI_PROVIDER: "anthropic" };

    expect(missingKeysFor(source)).toEqual(["ANTHROPIC_API_KEY"]);
  });

  it("treats a blank provider key as missing", () => {
    const source = { ...validEnv(), AI_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "   " };

    expect(missingKeysFor(source)).toEqual(["ANTHROPIC_API_KEY"]);
  });

  it("falls back to gemini's key when AI_PROVIDER is unset", () => {
    const source: Record<string, string | undefined> = { ...validEnv() };
    delete source.AI_PROVIDER;
    delete source.GEMINI_API_KEY;

    expect(missingKeysFor(source)).toEqual(["GEMINI_API_KEY"]);
  });

  // Regression guard: a Zod `.superRefine()` on the object would be skipped
  // entirely once another field had failed, so the provider key would go
  // unreported until the next restart. It is checked outside the schema for
  // exactly this reason — see missingProviderKey in env.ts.
  it("reports the provider key alongside unrelated failures, in one pass", () => {
    const source: Record<string, string | undefined> = { ...validEnv(), AI_PROVIDER: "anthropic" };
    delete source.AUTH_SECRET;
    delete source.MONGODB_URI;

    expect(missingKeysFor(source)).toEqual(["ANTHROPIC_API_KEY", "AUTH_SECRET", "MONGODB_URI"]);
  });

  it("leaves an unrecognised provider to the enum rather than naming a key", () => {
    const source = { ...validEnv(), AI_PROVIDER: "openai" };

    try {
      parseEnv(source);
      expect.unreachable("expected parseEnv to throw");
    } catch (error) {
      const failure = error as EnvValidationError;
      expect(failure.missing).toEqual([]);
      expect(failure.invalid.map((entry) => entry.key)).toEqual(["AI_PROVIDER"]);
    }
  });
});

describe("MONGODB_URI", () => {
  function reasonFor(uri: string): string | undefined {
    try {
      parseEnv({ ...validEnv(), MONGODB_URI: uri });
      return undefined;
    } catch (error) {
      return (error as EnvValidationError).invalid.find((e) => e.key === "MONGODB_URI")?.reason;
    }
  }

  it("accepts the shapes the dev stack and the deploy actually use", () => {
    expect(reasonFor("mongodb://localhost:27017/tally")).toBeUndefined();
    expect(reasonFor("mongodb://user:pass@mongo:27017/tally?authSource=admin")).toBeUndefined();
    expect(reasonFor("mongodb+srv://user:pass@cluster.example.com/tally")).toBeUndefined();
  });

  it("rejects a URI with no database name", () => {
    // `client.db()` takes the name from the URI. Without one the driver quietly
    // uses "test", and the app runs against an empty database that looks fine.
    expect(reasonFor("mongodb://localhost:27017")).toContain("database name");
    expect(reasonFor("mongodb://localhost:27017/?authSource=admin")).toContain("database name");
  });
});

describe("envVar", () => {
  const original = process.env.MONGODB_URI;
  afterEach(() => {
    if (original === undefined) delete process.env.MONGODB_URI;
    else process.env.MONGODB_URI = original;
  });

  it("validates one variable without demanding the whole environment", () => {
    // `pnpm db:indexes` has to run before the Shopify IDs exist (commit 5).
    process.env.MONGODB_URI = "mongodb://localhost:27017/tally";
    expect(envVar("MONGODB_URI")).toBe("mongodb://localhost:27017/tally");
  });

  it("reports a missing key as missing and a bad one as invalid", () => {
    delete process.env.MONGODB_URI;
    try {
      envVar("MONGODB_URI");
      expect.unreachable("expected envVar to throw");
    } catch (error) {
      expect((error as EnvValidationError).missing).toEqual(["MONGODB_URI"]);
    }

    process.env.MONGODB_URI = "postgres://localhost/tally";
    try {
      envVar("MONGODB_URI");
      expect.unreachable("expected envVar to throw");
    } catch (error) {
      expect((error as EnvValidationError).invalid.map((e) => e.key)).toEqual(["MONGODB_URI"]);
    }
  });

  it("applies the schema default when the key is unset", () => {
    const model = process.env.GEMINI_MODEL;
    delete process.env.GEMINI_MODEL;
    try {
      expect(envVar("GEMINI_MODEL")).toBe("gemini-flash-latest");
    } finally {
      if (model !== undefined) process.env.GEMINI_MODEL = model;
    }
  });
});
