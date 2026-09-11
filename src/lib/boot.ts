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
