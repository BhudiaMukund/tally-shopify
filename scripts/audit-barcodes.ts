/**
 * `pnpm barcodes:audit` — every variant whose barcode would fail a scan.
 *
 * This is the gate on putting the phone in front of staff (BUILD_PLAN §9). Run
 * it to size the manual barcode assignment, and again to confirm it is done.
 *
 * It reads `products_mirror`, so run `pnpm mirror:backfill` first — the report
 * prints how old the mirror is and refuses to be quiet about it. Reading the
 * cache is fine here precisely because nothing is written from what it says.
 *
 *   pnpm barcodes:audit           the report
 *   pnpm barcodes:audit --all     every row, not the first 40 of each section
 *   pnpm barcodes:audit --csv     the same rows as CSV on stdout, for the shop floor
 */
import { barcodeKey, normaliseBarcode, type BarcodeProblem } from "@/lib/barcode";
import { closeDb, getDb } from "@/lib/db/client";
import { productsMirror } from "@/lib/db/collections";
import type { ProductMirror } from "@/lib/db/schemas/products-mirror";

import { loadEnvFiles } from "./load-env";

const ROWS_SHOWN = 40;

interface Finding {
  row: ProductMirror;
  problem: BarcodeProblem;
}

function variantLabel(row: ProductMirror): string {
  const values = Object.values(row.optionValues).join(" / ");
  return values === "" ? "(single variant)" : values;
}

/** `title — Large  $12.50  gid://…/ProductVariant/1` */
function describe(row: ProductMirror): string {
  return (
    `  ${row.title} — ${variantLabel(row)}\n` +
    `    $${row.price}  ${row.shopifyVariantId}` +
    (row.barcodeRaw === undefined ? "" : `  raw: ${JSON.stringify(row.barcodeRaw)}`)
  );
}

function groupByProduct(rows: readonly ProductMirror[]): Map<string, ProductMirror[]> {
  const byProduct = new Map<string, ProductMirror[]>();
  for (const row of rows) {
    const list = byProduct.get(row.shopifyProductId) ?? [];
    list.push(row);
    byProduct.set(row.shopifyProductId, list);
  }
  return byProduct;
}

function printGrouped(rows: readonly ProductMirror[], showAll: boolean): void {
  const byProduct = groupByProduct(rows);
  let printed = 0;

  for (const [, group] of byProduct) {
    if (!showAll && printed >= ROWS_SHOWN) {
      console.log(`  … and ${rows.length - printed} more rows. Re-run with --all.`);
      return;
    }
    for (const row of group) {
      console.log(describe(row));
      printed += 1;
    }
  }
}

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

async function main(): Promise<void> {
  loadEnvFiles();

  const showAll = process.argv.includes("--all");
  const asCsv = process.argv.includes("--csv");

  const rows = await productsMirror(await getDb())
    .find({}, { sort: { title: 1 } })
    .toArray();

  if (rows.length === 0) {
    console.log("\nThe mirror is empty. Run `pnpm mirror:backfill` first.\n");
    process.exitCode = 1;
    return;
  }

  const missing: ProductMirror[] = [];
  const malformed: Finding[] = [];
  const byKey = new Map<string, ProductMirror[]>();

  for (const row of rows) {
    if (row.barcode === undefined) {
      missing.push(row);
      continue;
    }

    // The stored value is already digits, so this re-checks length and check
    // digit rather than re-parsing. `barcodeRaw` is what a person has to fix.
    const normalised = normaliseBarcode(row.barcode);
    if (!normalised.ok && normalised.problem !== undefined) {
      malformed.push({ row, problem: normalised.problem });
    }

    const key = barcodeKey(row.barcode);
    const shared = byKey.get(key) ?? [];
    shared.push(row);
    byKey.set(key, shared);
  }

  /**
   * A barcode on several variants of *one* product is a size run and is exactly
   * what §3 says to expect. The same code on two different products is a data
   * error: the till cannot tell them apart, and neither can a scan.
   */
  const sizeRuns: [string, ProductMirror[]][] = [];
  const collisions: [string, ProductMirror[]][] = [];

  for (const [key, shared] of byKey) {
    if (shared.length < 2) continue;
    const products = new Set(shared.map((row) => row.shopifyProductId));
    (products.size > 1 ? collisions : sizeRuns).push([key, shared]);
  }

  if (asCsv) {
    console.log("problem,product,variant,option,price,barcode_raw,variant_id");
    const emit = (problem: string, row: ProductMirror) =>
      console.log(
        [
          problem,
          csvCell(row.title),
          csvCell(variantLabel(row)),
          csvCell(Object.keys(row.optionValues).join(" / ")),
          row.price,
          csvCell(row.barcodeRaw ?? ""),
          row.shopifyVariantId,
        ].join(","),
      );

    for (const row of missing) emit("missing", row);
    for (const finding of malformed) emit(finding.problem, finding.row);
    for (const [, shared] of collisions) for (const row of shared) emit("collision", row);
    return;
  }

  const oldest = rows.reduce(
    (min, row) => (row.syncedAt < min ? row.syncedAt : min),
    rows[0]?.syncedAt ?? new Date(),
  );
  const ageMinutes = Math.round((Date.now() - oldest.getTime()) / 60_000);
  const needFixing = missing.length + malformed.length + collisions.length;

  console.log(`\nBarcode audit — ${rows.length.toLocaleString()} variants in the mirror`);
  console.log("=".repeat(52));
  console.log(`  missing a barcode        ${String(missing.length).padStart(6)}`);
  console.log(`  malformed                ${String(malformed.length).padStart(6)}`);
  console.log(`  shared across products   ${String(collisions.length).padStart(6)}  (barcodes)`);
  console.log(
    `  shared within a product  ${String(sizeRuns.length).padStart(6)}  (barcodes, expected)`,
  );
  console.log(
    `\n  Mirror last fully synced ${ageMinutes < 1 ? "just now" : `${ageMinutes} minutes ago`}.` +
      (ageMinutes > 60 ? "  Run `pnpm mirror:backfill` for a current answer." : ""),
  );

  if (missing.length > 0) {
    console.log(`\nNo barcode (${missing.length})`);
    console.log("-".repeat(52));
    printGrouped(missing, showAll);
  }

  if (malformed.length > 0) {
    console.log(`\nMalformed (${malformed.length})`);
    console.log("-".repeat(52));
    console.log("  Not one of the four GTIN lengths, or the check digit disagrees.");
    console.log("  A scan still finds these, but the normaliser calls them junk.");
    for (const problem of ["length", "check-digit", "empty"] as const) {
      const group = malformed.filter((finding) => finding.problem === problem);
      if (group.length === 0) continue;
      console.log(`\n  ${problem} (${group.length})`);
      printGrouped(
        group.map((finding) => finding.row),
        showAll,
      );
    }
  }

  if (collisions.length > 0) {
    console.log(`\nOne barcode, several products (${collisions.length})`);
    console.log("-".repeat(52));
    console.log("  The till cannot ring these up correctly. Fix at the source.");
    for (const [key, shared] of collisions.slice(0, showAll ? collisions.length : ROWS_SHOWN)) {
      console.log(`\n  ${key.replace(/^0+/, "")}`);
      for (const row of shared) console.log(describe(row));
    }
  }

  if (sizeRuns.length > 0) {
    console.log(`\nOne barcode, one product, several variants (${sizeRuns.length})`);
    console.log("-".repeat(52));
    console.log("  Expected — a printed code covering a size run. Listed for completeness.");
    if (showAll) {
      for (const [key, shared] of sizeRuns) {
        console.log(`\n  ${key.replace(/^0+/, "")}`);
        for (const row of shared) console.log(describe(row));
      }
    }
  }

  console.log(
    needFixing === 0
      ? "\nNothing to fix. This gate is clear.\n"
      : `\n${needFixing} things to fix before the phone goes on the shop floor.\n`,
  );

  if (needFixing > 0) process.exitCode = 1;
}

main()
  .catch((error: unknown) => {
    console.error(`\n${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
