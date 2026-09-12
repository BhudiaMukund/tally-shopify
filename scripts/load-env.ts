import { existsSync } from "node:fs";

/**
 * Loads `.env.local` then `.env` for a script run outside Next, which does this
 * for itself but only for the app.
 *
 * Anything already set in the real environment wins, so
 * `MONGODB_URI=… pnpm db:indexes` points at another database without editing a
 * file — the behaviour you want the one time you are running this against
 * production. `process.loadEnvFile` overwrites, so the pre-existing keys are
 * snapshotted and put back.
 */
export function loadEnvFiles(files: readonly string[] = [".env.local", ".env"]): void {
  const preset = { ...process.env };

  for (const file of files) {
    if (!existsSync(file)) continue;
    process.loadEnvFile(file);
  }

  for (const [key, value] of Object.entries(preset)) {
    if (value !== undefined) process.env[key] = value;
  }
}
