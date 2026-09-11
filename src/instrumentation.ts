/**
 * Runs once per server boot, before the first request is served.
 * See https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // `next build` compiles and prerenders without secrets; the container still
  // validates at start. SKIP_ENV_VALIDATION is the manual escape hatch.
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  if (process.env.SKIP_ENV_VALIDATION === "1") return;

  const { assertEnv, EnvValidationError } = await import("@/lib/env");

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
