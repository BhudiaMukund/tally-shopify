/**
 * `pnpm taxonomy:sync` — rebuild the enum lists the AI is allowed to pick from,
 * straight from the live catalogue. No file, no export, no fixture (§11).
 *
 * Safe to re-run: each set is replaced atomically, never appended to.
 */
import { closeDb, getDb } from "@/lib/db/client";
import { taxonomy } from "@/lib/db/collections";
import { taxonomyKey, taxonomySchema, type TaxonomyKey } from "@/lib/db/schemas/taxonomy";
import { runBulkQueryAndStream } from "@/lib/shopify/bulk-result";
import { closeShopifyClient } from "@/lib/shopify/client";
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

async function main(): Promise<void> {
  loadEnvFiles();

  console.log("\nStarting the bulk query over all products");
  const accumulator = createTaxonomyAccumulator();
  await runBulkQueryAndStream(PRODUCT_TAXONOMY_BULK_QUERY, (line) => accumulator.add(line), {
    onProgress: (operation) =>
      console.log(`  ${operation.status.toLowerCase()}, ${operation.objectCount} objects`),
  });
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
