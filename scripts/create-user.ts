/**
 * `pnpm create-user` — the only way an account comes into existence.
 *
 *   pnpm create-user --email sam@example.com --name "Sam" --role admin
 *
 * Prompts for the password with the echo off, which is the only form that
 * keeps it out of shell history — hence no --password flag. For a
 * non-interactive run (a container, a seed step) it is read from
 * TALLY_PASSWORD, which is no safer on its own: an inline assignment is
 * recorded like any other command and CI runners often log the environment.
 * Supply it from a secret store or a mode-600 file. See the README.
 */
import { passwordProblem } from "@/lib/auth/password";
import { createUser, DuplicateEmailError } from "@/lib/auth/users";
import { closeDb, getDb } from "@/lib/db/client";
import { ensureIndexes } from "@/lib/db/indexes";
import { userRole, type UserRole } from "@/lib/db/schemas/users";

import { loadEnvFiles } from "./load-env";

const ETX = "\u0003"; // Ctrl-C
const BACKSPACE = "\u007f";

interface Args {
  email: string;
  name: string;
  role: UserRole;
}

class UsageError extends Error {}

function parseArgs(argv: readonly string[]): Args {
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === undefined || !arg.startsWith("--")) continue;

    const [flag, inline] = arg.slice(2).split("=", 2);
    if (flag === undefined) continue;

    const next = inline ?? argv[i + 1];
    if (next === undefined || next.startsWith("--"))
      throw new UsageError(`--${flag} needs a value`);

    values.set(flag, next);
    if (inline === undefined) i += 1;
  }

  const email = values.get("email");
  const name = values.get("name");
  const role = values.get("role");

  if (email === undefined) throw new UsageError("--email is required");
  if (name === undefined) throw new UsageError("--name is required");
  if (role === undefined) throw new UsageError("--role is required (staff or admin)");

  const parsedRole = userRole.safeParse(role);
  if (!parsedRole.success) throw new UsageError(`--role must be staff or admin, not "${role}"`);

  return { email, name, role: parsedRole.data };
}

/**
 * Reads a password without echoing it.
 *
 * `readline` has no hidden-input mode, so the terminal goes into raw mode and
 * the keystrokes are collected by hand. Falls back to TALLY_PASSWORD when
 * there is no TTY, which is how this runs in a container.
 */
function readPassword(prompt: string): Promise<string> {
  const fromEnv = process.env.TALLY_PASSWORD;
  if (fromEnv !== undefined && fromEnv !== "") return Promise.resolve(fromEnv);

  if (!process.stdin.isTTY) {
    return Promise.reject(
      new UsageError("No terminal to prompt on. Set TALLY_PASSWORD and run again."),
    );
  }

  process.stdout.write(prompt);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");

  return new Promise<string>((resolve, reject) => {
    let value = "";

    const cleanup = (): void => {
      process.stdin.off("data", onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\n");
    };

    const onData = (chunk: string): void => {
      for (const char of chunk) {
        if (char === "\r" || char === "\n") {
          cleanup();
          resolve(value);
          return;
        }
        if (char === ETX) {
          cleanup();
          reject(new UsageError("Cancelled."));
          return;
        }
        if (char === BACKSPACE || char === "\b") {
          value = value.slice(0, -1);
          continue;
        }
        // Ignore the rest of the control range rather than storing it.
        if (char >= " ") value += char;
      }
    };

    process.stdin.on("data", onData);
  });
}

async function askForPassword(): Promise<string> {
  const password = await readPassword("Password: ");

  const problem = passwordProblem(password);
  if (problem !== undefined) throw new UsageError(`Password ${problem}.`);

  // Only worth asking twice when a person is typing. TALLY_PASSWORD is exact.
  if (process.env.TALLY_PASSWORD === undefined && process.stdin.isTTY) {
    const again = await readPassword("Password again: ");
    if (again !== password) throw new UsageError("The two passwords do not match.");
  }

  return password;
}

async function main(): Promise<void> {
  loadEnvFiles();
  const args = parseArgs(process.argv.slice(2));

  // On an empty database there would otherwise be no unique index on email
  // yet, and the second account with the same address would be accepted.
  await ensureIndexes(await getDb());

  const password = await askForPassword();
  const id = await createUser({ ...args, password });

  console.log(`\nCreated ${args.role} account for ${args.email.toLowerCase()} (${id}).`);
}

const USAGE = `
Usage:
  pnpm create-user --email <address> --name <name> --role <staff|admin>

The password is prompted for, or read from TALLY_PASSWORD when there is no
terminal. It is never passed as a flag.
`;

main()
  .then(() => closeDb())
  .catch(async (error: unknown) => {
    if (error instanceof UsageError) console.error(`\n${error.message}\n${USAGE}`);
    else if (error instanceof DuplicateEmailError) console.error(`\n${error.message}\n`);
    else console.error(`\n${error instanceof Error ? error.message : String(error)}\n`);

    await closeDb().catch(() => {});
    process.exitCode = 1;
  });
