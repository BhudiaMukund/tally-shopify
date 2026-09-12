/**
 * `pnpm mirror:backfill` — fill `products_mirror` from the live catalogue.
 *
 * The one-off that gives the webhooks something to keep fresh, and the repair
 * for whenever they have missed something. Safe to re-run: every write is an
 * upsert keyed on the variant id, and the ordering guard in `catalog/mirror.ts`
 * means a webhook landing mid-run is not overwritten by this older snapshot.
 *
 * Run it *after* the manual barcode assignment, not during — a snapshot taken
 * half way through leaves half the catalogue without a barcode until the
 * webhooks catch up (BUILD_PLAN §9).
 *
 *   pnpm mirror:backfill              write, then prune anything not seen
 *   pnpm mirror:backfill --no-prune   leave rows this run did not touch
 *   pnpm mirror:backfill --dry-run    read and report, write nothing
 */
import { upsertCatalogProduct, pruneMirror } from "@/lib/catalog/mirror";
import { closeDb, getDb } from "@/lib/db/client";
import { productsMirror } from "@/lib/db/collections";
import { envVar } from "@/lib/env";
import { runBulkQueryAndStream } from "@/lib/shopify/bulk-result";
import { catalogBulkQuery, createCatalogAccumulator } from "@/lib/shopify/catalog-bulk";
import { closeShopifyClient } from "@/lib/shopify/client";

import { loadEnvFiles } from "./load-env";

/** Reported in full; the rest are counted. A wall of identical errors helps nobody. */
const ERRORS_SHOWN = 10;

function pluralise(count: number, noun: string): string {
  return `${count.toLocaleString()} ${noun}${count === 1 ? "" : "s"}`;
}

async function main(): Promise<void> {
  loadEnvFiles();

  const prune = !process.argv.includes("--no-prune");
  const dryRun = process.argv.includes("--dry-run");

  const context = {
    locationId: envVar("SHOPIFY_LOCATION_ID"),
    posPublicationId: envVar("SHOPIFY_POS_PUBLICATION_ID"),
  };

  console.log("\nStarting the bulk query over the whole catalogue");
  const accumulator = createCatalogAccumulator();
  const startedAt = new Date();

  const operation = await runBulkQueryAndStream(
    catalogBulkQuery(context.locationId),
    (line) => accumulator.add(line),
    {
      onProgress: (bulk) =>
        console.log(`  ${bulk.status.toLowerCase()}, ${bulk.objectCount} objects`),
    },
  );

  const { products, unknownLines, orphanLines } = accumulator.result();
  const variantTotal = products.reduce((total, product) => total + product.variants.length, 0);
  console.log(
    `\nRead ${pluralise(products.length, "product")} and ${pluralise(variantTotal, "variant")} ` +
      `from ${operation.objectCount} objects.`,
  );

  if (unknownLines > 0) console.log(`  ${unknownLines} lines had a shape this script cannot read.`);
  if (orphanLines > 0) console.log(`  ${orphanLines} products arrived with no product line.`);

  if (dryRun) {
    console.log("\n--dry-run: nothing was written.\n");
    return;
  }

  const collection = productsMirror(await getDb());
  const totals = { written: 0, stale: 0, removed: 0 };
  const failures: { productId: string; message: string }[] = [];
  const syncedAt = new Date();

  for (const product of products) {
    try {
      const result = await upsertCatalogProduct(collection, product, context, syncedAt);
      totals.written += result.written;
      totals.stale += result.stale;
      totals.removed += result.removed;
    } catch (error) {
      // One product with a price or an image URL the schema refuses must not
      // abandon the other 1,900.
      failures.push({
        productId: product.id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  console.log(`\nWrote ${pluralise(totals.written, "variant")}.`);
  if (totals.stale > 0) {
    console.log(`  ${totals.stale} skipped — a webhook had already written something newer.`);
  }
  if (totals.removed > 0) {
    console.log(`  ${totals.removed} removed — the variant is gone from the product.`);
  }

  if (prune) {
    // Safe only because the run above is a complete snapshot: anything the run
    // did not touch is a variant Shopify no longer returns.
    const pruned = await pruneMirror(collection, startedAt);
    if (pruned > 0) console.log(`  ${pruned} pruned — not in the catalogue any more.`);
  } else {
    console.log("  --no-prune: rows this run did not touch were left alone.");
  }

  if (failures.length > 0) {
    console.log(`\n${pluralise(failures.length, "product")} could not be written:`);
    for (const failure of failures.slice(0, ERRORS_SHOWN)) {
      console.log(`  ${failure.productId}  ${failure.message}`);
    }
    if (failures.length > ERRORS_SHOWN) {
      console.log(`  … and ${failures.length - ERRORS_SHOWN} more.`);
    }
    process.exitCode = 1;
  }

  console.log("\nNext: `pnpm barcodes:audit` to see what still needs a barcode.\n");
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
