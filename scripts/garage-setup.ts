/**
 * `pnpm garage:setup` — the one-time-per-fresh-volume step after
 * `docker compose -f docker-compose.dev.yml up -d`.
 *
 * Garage's CLI has no equivalent of MinIO's `mc anonymous set` one-liner, and
 * CORS specifically has no CLI command at all — it is an S3-API-only
 * operation (spiked and confirmed). So this does everything by hand: assign
 * the single-node layout, create the bucket, import a fixed dev key/secret
 * (matching `.env.example`), grant it owner (required for `PutBucketCors`,
 * not just read/write), then set CORS using the same `@aws-sdk/client-s3`
 * the app uses for real.
 *
 * Safe to re-run: every step checks current state first rather than assuming
 * a fresh volume, so this also fixes a Garage container that was recreated
 * without its data volume.
 *
 * Local dev only — talks to the container via `docker compose exec`.
 * Production's Garage/S3 setup is a separate, not-yet-built step (commit 17).
 */
import { execFileSync } from "node:child_process";

import { CORSRule, PutBucketCorsCommand, S3Client } from "@aws-sdk/client-s3";

import { loadEnvFiles } from "./load-env";

loadEnvFiles();

const COMPOSE_FILE = "docker-compose.dev.yml";
const SERVICE = "garage";

function garage(...args: string[]): string {
  return execFileSync(
    "docker",
    ["compose", "-f", COMPOSE_FILE, "exec", "-T", SERVICE, "/garage", ...args],
    {
      encoding: "utf8",
    },
  );
}

/** `execFileSync` throws on a non-zero exit — used here as the presence check. */
function garageOk(...args: string[]): boolean {
  try {
    garage(...args);
    return true;
  } catch {
    return false;
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is not set — copy .env.example to .env.local first.`);
  }
  return value;
}

async function main(): Promise<void> {
  const bucket = requireEnv("S3_BUCKET");
  const accessKey = requireEnv("S3_ACCESS_KEY");
  const secretKey = requireEnv("S3_SECRET_KEY");
  const endpoint = requireEnv("S3_ENDPOINT");
  const region = process.env.S3_REGION ?? "garage";
  const appUrl = requireEnv("APP_URL");

  console.log("Checking cluster layout...");
  const status = garage("status");
  const unassigned = status.split("\n").find((line) => line.includes("NO ROLE ASSIGNED"));
  if (unassigned !== undefined) {
    const nodeId = unassigned.trim().split(/\s+/)[0];
    if (nodeId === undefined) throw new Error(`Could not parse a node id from:\n${unassigned}`);
    console.log(`  Assigning layout to node ${nodeId}...`);
    garage("layout", "assign", "-z", "dev", "-c", "1G", nodeId);
    garage("layout", "apply", "--version", "1");
  } else {
    console.log("  Already assigned.");
  }

  console.log(`Ensuring bucket "${bucket}"...`);
  if (garage("bucket", "list").includes(bucket)) {
    console.log("  Already exists.");
  } else {
    garage("bucket", "create", bucket);
  }

  console.log(`Ensuring key ${accessKey}...`);
  if (garageOk("key", "info", accessKey)) {
    console.log("  Already imported.");
  } else {
    garage("key", "import", accessKey, secretKey, "--yes", "-n", "tally-dev");
  }

  console.log("Granting read, write and owner (owner is required for PutBucketCors)...");
  garage("bucket", "allow", "--read", "--write", "--owner", bucket, "--key", accessKey);

  console.log(`Setting CORS to allow PUT/GET from ${appUrl}...`);
  const s3 = new S3Client({
    endpoint,
    region,
    credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
    forcePathStyle: true,
  });
  const rule: CORSRule = {
    AllowedOrigins: [appUrl],
    AllowedMethods: ["PUT", "GET"],
    AllowedHeaders: ["*"],
    ExposeHeaders: ["ETag"],
    MaxAgeSeconds: 3000,
  };
  await s3.send(
    new PutBucketCorsCommand({ Bucket: bucket, CORSConfiguration: { CORSRules: [rule] } }),
  );

  console.log("\nGarage is ready.");
}

main().catch((error: unknown) => {
  console.error(`\n${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
