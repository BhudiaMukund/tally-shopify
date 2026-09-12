/**
 * `pnpm taxonomy:sync` — rebuild the enum lists the AI is allowed to pick from,
 * straight from the live catalogue. No file, no export, no fixture (§11).
 *
 * Safe to re-run: each set is replaced atomically, never appended to.
 */
import { createInterface } from "node:readline";

import { request } from "undici";

import { closeDb, getDb } from "@/lib/db/client";
import { taxonomy } from "@/lib/db/collections";
import { taxonomyKey, taxonomySchema, type TaxonomyKey } from "@/lib/db/schemas/taxonomy";
import { closeShopifyClient } from "@/lib/shopify/client";
import {
  getBulkOperation,
  isTerminal,
  runBulkQuery,
  type BulkOperation,
} from "@/lib/shopify/operations/bulk-operation";
import {
  allowedChoices,
  listMetafieldDefinitions,
} from "@/lib/shopify/operations/list-metafield-definitions";
import {
  createTaxonomyAccumulator,
  METAFIELD_TAXONOMY_KEYS,
  PRODUCT_TAXONOMY_BULK_QUERY,
} from "@/lib/shopify/taxonomy-aggregate";
import { applyTaxonomyRules, rareValues, RARE_VALUE_THRESHOLD } from "@/lib/taxonomy-rules";

import { loadEnvFiles } from "./load-env";

const POLL_INTERVAL_MS = 2_000;
const POLL_TIMEOUT_MS = 10 * 60 * 1000;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForBulk(id: string): Promise<BulkOperation> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let last = "";

  for (;;) {
    const operation = await getBulkOperation(id);

    // Only reprint when something changed; this loop runs for minutes.
    const line = `  ${operation.status.toLowerCase()}, ${operation.objectCount} objects`;
    if (line !== last) {
      console.log(line);
      last = line;
    }

    if (isTerminal(operation.status)) return operation;
    if (Date.now() > deadline) {
      throw new Error(`Bulk operation ${id} still ${operation.status} after 10 minutes.`);
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

/** Streams the JSONL rather than buffering it — the whole catalogue is in here. */
async function streamJsonl(url: string, onLine: (value: unknown) => void): Promise<void> {
  const response = await request(url, { method: "GET" });
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`Downloading the bulk result failed: HTTP ${response.statusCode}`);
  }

  const lines = createInterface({ input: response.body, crlfDelay: Infinity });
  let lineNumber = 0;
  for await (const line of lines) {
    lineNumber += 1;
    const trimmed = line.trim();
    if (trimmed === "") continue;
    try {
      onLine(JSON.parse(trimmed));
    } catch {
      throw new Error(`Bulk result line ${lineNumber} is not valid JSON.`);
    }
  }
}

async function main(): Promise<void> {
  loadEnvFiles();

  console.log("\nStarting the bulk query over all products");
  const started = await runBulkQuery(PRODUCT_TAXONOMY_BULK_QUERY);
  const finished = await waitForBulk(started.id);

  if (finished.status !== "COMPLETED") {
    throw new Error(
      `Bulk operation ${finished.status}${finished.errorCode ? ` (${finished.errorCode})` : ""}. ` +
        "Nothing was written.",
    );
  }
  if (finished.url === null) {
    // A store with no products completes with no file. Not an error, but there
    // is nothing to sync and overwriting the taxonomy with empty sets would be
    // worse than leaving yesterday's.
    throw new Error("The bulk operation completed with no result file. Nothing was written.");
  }

  const accumulator = createTaxonomyAccumulator();
  await streamJsonl(finished.url, (line) => accumulator.add(line));
  const { values, productCount, referenceOnly } = accumulator.result();

  // Where a metafield definition constrains its values, those beat anything
  // counted from usage: they are the store's own allow-list, and they include
  // options no product happens to use yet.
  console.log("\nReading product metafield definitions");
  const definitions = await listMetafieldDefinitions();
  const fromDefinitions = new Set<TaxonomyKey>();

  for (const definition of definitions) {
    if (definition.namespace !== "shopify") continue;
    const key = METAFIELD_TAXONOMY_KEYS[definition.key];
    if (key === undefined) continue;

    const choices = allowedChoices(definition);
    if (choices === undefined) continue;

    const counted = new Map(
      (values[key] ?? []).map((entry) => [entry.value.toLowerCase(), entry.count]),
    );
    values[key] = choices.map((choice) => ({
      value: choice,
      count: counted.get(choice.toLowerCase()) ?? 0,
    }));
    fromDefinitions.add(key);
  }

  const db = await getDb();
  const collection = taxonomy(db);
  const sourcedAt = new Date();

  console.log("\nSet                    values  source");
  console.log("-".repeat(52));

  for (const key of taxonomyKey.options) {
    const raw = values[key];
    if (raw === undefined || raw.length === 0) continue;

    const merged = applyTaxonomyRules(key, raw);
    const document = taxonomySchema.parse({
      _id: key,
      values: merged,
      sourcedAt,
      productCount,
    });

    // Replace, never append: a value deleted in Shopify has to disappear here
    // too, or the AI keeps being offered it.
    await collection.replaceOne({ _id: key }, document, { upsert: true });

    const source = fromDefinitions.has(key) ? "definition" : "usage";
    console.log(`${key.padEnd(22)} ${String(merged.length).padStart(6)}  ${source}`);
  }

  console.log(`\n${productCount} products scanned.`);

  const suspicious: string[] = [];
  for (const key of taxonomyKey.options) {
    const raw = values[key];
    if (raw === undefined) continue;
    if (fromDefinitions.has(key)) continue; // An allow-list is not a typo.

    for (const entry of rareValues(applyTaxonomyRules(key, raw))) {
      suspicious.push(`  ${key}: "${entry.value}" (${entry.count})`);
    }
  }

  if (suspicious.length > 0) {
    console.log(`\nUsed fewer than ${RARE_VALUE_THRESHOLD} times — check for typos:`);
    for (const line of suspicious) console.log(line);
    console.log("\nFix a genuine duplicate by adding an alias to src/lib/taxonomy-rules.ts.");
  }

  const references = Object.entries(referenceOnly);
  if (references.length > 0) {
    console.log("\nMetafield values that are metaobject references, not labels, and were skipped:");
    for (const [key, count] of references) console.log(`  ${key}: ${count}`);
    console.log("These need a definition with choices, or a metaobject lookup, to be usable.");
  }

  console.log();
}

main()
  .catch((error: unknown) => {
    console.error(`\n${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeShopifyClient();
    await closeDb();
  });
