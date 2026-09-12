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

  const { assertEnvOrExit, ensureIndexesAtBoot } = await import("@/lib/boot");
  assertEnvOrExit();
  await ensureIndexesAtBoot();
}
