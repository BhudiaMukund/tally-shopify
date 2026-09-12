/**
 * One line of JSON per event, on stdout.
 *
 * The shape `{ level, event, ... }` is what `src/lib/boot.ts` was already
 * writing by hand; this is the same thing with a name, so a request or a job
 * can carry its scan id or draft id on every line without each caller
 * re-deciding the field order (CLAUDE.md, conventions).
 *
 * No transport, no buffering, no dependency. The deploy collects stdout.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogFields = Record<string, unknown>;

function write(level: LogLevel, event: string, fields: LogFields = {}): void {
  const line = JSON.stringify({ level, event, at: new Date().toISOString(), ...fields });
  if (level === "error" || level === "warn") console.error(line);
  else console.log(line);
}

export const log = {
  debug: (event: string, fields?: LogFields) => {
    write("debug", event, fields);
  },
  info: (event: string, fields?: LogFields) => {
    write("info", event, fields);
  },
  warn: (event: string, fields?: LogFields) => {
    write("warn", event, fields);
  },
  error: (event: string, fields?: LogFields) => {
    write("error", event, fields);
  },
};

/** `Error` is not JSON-serialisable — this is what goes in a `message` field. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
