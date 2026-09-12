import { hash, verify } from "@node-rs/argon2";

/**
 * Password hashing.
 *
 * argon2id via `@node-rs/argon2` rather than the `argon2` package: it ships
 * prebuilt binaries for every platform we touch, so `pnpm install` needs no
 * node-gyp toolchain on a Windows laptop or in an alpine build stage.
 */

/**
 * OWASP's second recommended argon2id profile: 19 MiB, 2 passes, 1 lane.
 * Set explicitly rather than left to the library default so that a change in
 * the dependency cannot quietly weaken every password written after it.
 */
const PARAMS = {
  algorithm: 2, // Argon2id. The enum lives in a type-only export.
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

/** The shortest password we will store. Sessions last 30 days; this is typed rarely. */
export const MIN_PASSWORD_LENGTH = 12;

export function passwordProblem(password: string): string | undefined {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `must be at least ${MIN_PASSWORD_LENGTH} characters`;
  }
  if (password.trim() !== password) {
    return "must not start or end with a space — a phone keyboard adds one after autocomplete";
  }
  return undefined;
}

export async function hashPassword(password: string): Promise<string> {
  return hash(password, PARAMS);
}

/**
 * A real hash to check against when the account does not exist.
 *
 * Computed once, lazily, from a value nobody knows: returning early for an
 * unknown email would make a missing account answer in microseconds and a
 * wrong password in ~50ms, which is a user-enumeration oracle anyone can read
 * off a network tab. Doing the work either way costs one hash per failed login.
 */
let dummyHash: Promise<string> | undefined;
function dummy(): Promise<string> {
  dummyHash ??= hash(crypto.randomUUID(), PARAMS);
  return dummyHash;
}

/**
 * Constant-time comparison against the stored hash.
 *
 * Takes `undefined` for "no such account" and still does the work. Returns
 * false rather than throwing on a malformed hash: a user document written by
 * hand with no `passwordHash` should fail the login, not 500 the route and
 * leak that the account exists.
 */
export async function verifyPassword(
  storedHash: string | undefined,
  password: string,
): Promise<boolean> {
  const target = storedHash === undefined || storedHash === "" ? await dummy() : storedHash;
  try {
    const matched = await verify(target, password);
    // A caller that passes no hash must never get a pass, whatever it matched.
    return matched && storedHash !== undefined && storedHash !== "";
  } catch {
    return false;
  }
}
