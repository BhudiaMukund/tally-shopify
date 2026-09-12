/**
 * `pnpm db:indexes` — create any index Tally needs that the database is missing.
 *
 * Idempotent. Runs on every boot from `src/instrumentation.ts` as well; this is
 * the copy you run by hand after a restore, or against a database that isn't
 * the one your app is pointed at.
 */
import { closeDb, getDb } from "@/lib/db/client";
import { ensureIndexes, indexes } from "@/lib/db/indexes";

import { loadEnvFiles } from "./load-env";

async function main(): Promise<void> {
  loadEnvFiles();

  const db = await getDb();
  // The database name only. The URI carries credentials.
  console.log(`Ensuring ${indexes.length} indexes on "${db.databaseName}"\n`);

  const report = await ensureIndexes(db);

  for (const name of report.created) console.log(`  created  ${name}`);
  for (const name of report.existing) console.log(`  ok       ${name}`);

  console.log(
    `\n${report.created.length} created, ${report.existing.length} already present (${report.durationMs}ms)`,
  );
}

main()
  .then(() => closeDb())
  .catch(async (error: unknown) => {
    console.error(`\n${error instanceof Error ? error.message : String(error)}\n`);
    await closeDb().catch(() => {});
    process.exitCode = 1;
  });
