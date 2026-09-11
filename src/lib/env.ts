import { z } from "zod";

/**
 * The single source of truth for environment configuration.
 *
 * Every key here appears in `.env.example`. Validation is lazy — the first read
 * of `env` parses and caches — and `assertEnv()` forces it at boot from
 * `src/instrumentation.ts` so a misconfigured deploy fails immediately rather
 * than on the first request that happens to touch a missing value.
 */
const envSchema = z.object({
  // app
  APP_URL: z.url("must be an absolute URL, e.g. https://tally.example.com"),
  AUTH_SECRET: z
    .string()
    .min(32, "must be at least 32 characters — generate with `openssl rand -base64 32`"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  // mongo — a single-node replica set, for transactions and change streams
  MONGODB_URI: z
    .string()
    .regex(/^mongodb(\+srv)?:\/\//, "must start with mongodb:// or mongodb+srv://"),

  // queue
  REDIS_URL: z.string().regex(/^rediss?:\/\//, "must start with redis:// or rediss://"),

  // object storage
  S3_ENDPOINT: z.url("must be an absolute URL, e.g. http://localhost:9000"),
  S3_PUBLIC_URL: z.url("must be an absolute URL"),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),

  // shopify
  SHOPIFY_STORE_DOMAIN: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/, "must be a <store>.myshopify.com domain"),
  SHOPIFY_ADMIN_TOKEN: z.string().min(1),
  SHOPIFY_API_VERSION: z.string().regex(/^\d{4}-\d{2}$/, "must look like 2026-07"),
  SHOPIFY_LOCATION_ID: z
    .string()
    .regex(
      /^gid:\/\/shopify\/Location\/\d+$/,
      "must be a location GID — run `pnpm shopify:doctor`",
    ),
  SHOPIFY_POS_PUBLICATION_ID: z
    .string()
    .regex(
      /^gid:\/\/shopify\/Publication\/\d+$/,
      "must be a publication GID — run `pnpm shopify:doctor`",
    ),
  SHOPIFY_WEBHOOK_SECRET: z.string().min(1),

  // ai — only the selected provider's key is required; see providerKeys
  AI_PROVIDER: z.enum(["gemini", "anthropic"]).default("gemini"),
  GEMINI_API_KEY: z.string().min(1).optional(),
  GEMINI_MODEL: z.string().min(1).default("gemini-flash-latest"),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  AI_PROMPT_VERSION: z.coerce.number().int().positive().default(1),
});

export type Env = z.infer<typeof envSchema>;

type RawEnv = Record<string, string | undefined>;

export class EnvValidationError extends Error {
  readonly missing: readonly string[];
  readonly invalid: readonly { key: string; reason: string }[];

  constructor(missing: readonly string[], invalid: readonly { key: string; reason: string }[]) {
    super(formatMessage(missing, invalid));
    this.name = "EnvValidationError";
    this.missing = missing;
    this.invalid = invalid;
  }
}

function formatMessage(
  missing: readonly string[],
  invalid: readonly { key: string; reason: string }[],
): string {
  const count = missing.length + invalid.length;
  const lines = [
    `Invalid environment — ${count} ${count === 1 ? "problem" : "problems"}. Nothing was started.`,
    "",
  ];

  if (missing.length > 0) {
    lines.push(`  Missing (${missing.length}):`);
    for (const key of missing) lines.push(`    ${key}`);
    lines.push("");
  }

  if (invalid.length > 0) {
    lines.push(`  Invalid (${invalid.length}):`);
    for (const { key, reason } of invalid) lines.push(`    ${key} — ${reason}`);
    lines.push("");
  }

  lines.push("Copy .env.example to .env.local and fill in every key listed above.");
  return lines.join("\n");
}

/** Treat a key set to the empty string as unset — `.env.example` ships blank values. */
function compact(source: RawEnv): RawEnv {
  const out: RawEnv = {};
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === "string" && value.trim() === "") continue;
    out[key] = value;
  }
  return out;
}

/** The API key each provider needs. A key for the other provider stays optional. */
const providerKeys = {
  gemini: "GEMINI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
} as const;

/**
 * Names the API key the selected provider needs, when it isn't set.
 *
 * Checked here rather than as a `.superRefine()` on the schema because Zod skips
 * object-level refinements as soon as any field has failed. A missing
 * `AUTH_SECRET` would therefore hide a missing `ANTHROPIC_API_KEY` until the
 * next restart, which is exactly the one-problem-at-a-time loop this module
 * exists to avoid.
 */
function missingProviderKey(present: RawEnv): string | undefined {
  const provider = present.AI_PROVIDER ?? "gemini";
  // An unrecognised provider is the enum's problem to report, not ours.
  if (!(provider in providerKeys)) return undefined;

  const key = providerKeys[provider as keyof typeof providerKeys];
  return present[key] === undefined ? key : undefined;
}

/**
 * Parses an environment source, reporting *every* problem at once rather than
 * failing on the first one — fixing config one restart at a time is miserable.
 */
export function parseEnv(source: RawEnv): Env {
  const present = compact(source);
  const result = envSchema.safeParse(present);
  const providerKey = missingProviderKey(present);

  if (result.success && providerKey === undefined) return result.data;

  const missing: string[] = [];
  const invalid: { key: string; reason: string }[] = [];
  const seen = new Set<string>();

  if (!result.success) {
    for (const issue of result.error.issues) {
      const key = String(issue.path[0] ?? "(root)");
      if (seen.has(key)) continue;
      seen.add(key);

      if (present[key] === undefined) missing.push(key);
      else invalid.push({ key, reason: issue.message });
    }
  }

  if (providerKey !== undefined && !seen.has(providerKey)) missing.push(providerKey);

  missing.sort();
  invalid.sort((a, b) => a.key.localeCompare(b.key));
  throw new EnvValidationError(missing, invalid);
}

let cached: Env | undefined;

/** Parses once and caches. Throws `EnvValidationError` if anything is wrong. */
export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}

/** Call at boot to fail fast. Returns the parsed environment. */
export function assertEnv(): Env {
  return getEnv();
}

/** Test seam — drops the cached parse so a test can vary `process.env`. */
export function resetEnvCache(): void {
  cached = undefined;
}

/**
 * Ergonomic accessor: `env.SHOPIFY_API_VERSION`. Validation happens on first
 * property read, so importing this module is always safe.
 */
export const env: Env = new Proxy({} as Env, {
  get: (_target, prop: string | symbol) => getEnv()[prop as keyof Env],
  has: (_target, prop: string | symbol) => prop in getEnv(),
  ownKeys: () => Reflect.ownKeys(getEnv()),
  getOwnPropertyDescriptor: (_target, prop: string | symbol) =>
    Reflect.getOwnPropertyDescriptor(getEnv(), prop),
});
