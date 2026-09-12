import { assertEnv, EnvValidationError } from "@/lib/env";

/**
 * Node-only boot checks. Kept out of `src/instrumentation.ts` because that file
 * is compiled for the Edge runtime as well, and `process.exit` there is a build
 * warning even when a runtime guard means it can never be reached.
 */
export function assertEnvOrExit(): void {
  try {
    assertEnv();
  } catch (error) {
    if (!(error instanceof EnvValidationError)) throw error;
    // Next catches whatever `register()` throws and carries on serving 500s.
    // A process that cannot possibly work should exit so the supervisor restarts
    // or reports it, and the operator sees the reason rather than a stack trace.
    console.error(`\n${error.message}\n`);
    process.exit(1);
  }
}

/**
 * Creates any missing index, then gets out of the way.
 *
 * Unlike the env check this does not exit on failure. A bad env var can never
 * fix itself; an unreachable Mongo usually does, within seconds, because the
 * web container starts before the database is accepting connections. Crash
 * looping through that is worse than serving the first DB-backed request a
 * clear error — and the indexes are re-checked on the next boot anyway.
 */
export async function ensureIndexesAtBoot(): Promise<void> {
  const { getDb } = await import("@/lib/db/client");
  const { ensureIndexes } = await import("@/lib/db/indexes");

  try {
    const report = await ensureIndexes(await getDb());
    console.log(
      JSON.stringify({
        level: "info",
        event: "db.indexes.ensured",
        created: report.created,
        existing: report.existing.length,
        durationMs: report.durationMs,
      }),
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "error",
        event: "db.indexes.failed",
        message: error instanceof Error ? error.message : String(error),
        hint: "Run `pnpm db:indexes` once Mongo is reachable.",
      }),
    );
  }
}
