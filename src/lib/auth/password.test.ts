import { describe, expect, it } from "vitest";

import { hashPassword, MIN_PASSWORD_LENGTH, passwordProblem, verifyPassword } from "./password";

/** argon2 is deliberately slow — a few hashes per run is the whole budget. */
const PASSWORD = "correct-horse-battery";

describe("hashPassword", () => {
  it("produces an argon2id hash with the parameters we chose", async () => {
    const hash = await hashPassword(PASSWORD);
    // Pinned so a dependency default cannot quietly weaken new passwords.
    expect(hash.startsWith("$argon2id$v=19$m=19456,t=2,p=1$")).toBe(true);
  });

  it("salts, so the same password twice is two different hashes", async () => {
    const [a, b] = await Promise.all([hashPassword(PASSWORD), hashPassword(PASSWORD)]);
    expect(a).not.toBe(b);
    expect(await verifyPassword(a, PASSWORD)).toBe(true);
    expect(await verifyPassword(b, PASSWORD)).toBe(true);
  });
});

describe("verifyPassword", () => {
  it("accepts the right password and rejects a near miss", async () => {
    const hash = await hashPassword(PASSWORD);
    expect(await verifyPassword(hash, PASSWORD)).toBe(true);
    expect(await verifyPassword(hash, "correct-horse-batterz")).toBe(false);
    expect(await verifyPassword(hash, PASSWORD.toUpperCase())).toBe(false);
    expect(await verifyPassword(hash, "")).toBe(false);
  });

  it("never passes when there is no stored hash", async () => {
    // The no-such-account path. It still does the work (see the dummy hash in
    // password.ts) but it must not authenticate anybody.
    expect(await verifyPassword(undefined, PASSWORD)).toBe(false);
    expect(await verifyPassword("", PASSWORD)).toBe(false);
    expect(await verifyPassword(undefined, "")).toBe(false);
  });

  it("returns false on a malformed hash rather than throwing", async () => {
    // A user document edited by hand should fail the login, not 500 the route.
    expect(await verifyPassword("not-a-hash", PASSWORD)).toBe(false);
    expect(await verifyPassword("$argon2id$broken", PASSWORD)).toBe(false);
  });
});

describe("passwordProblem", () => {
  it("names what is wrong, in words that say what to do", () => {
    expect(passwordProblem("short")).toContain(String(MIN_PASSWORD_LENGTH));
    expect(passwordProblem(" leading-space-password ")).toContain("space");
  });

  it("accepts a password that is long enough", () => {
    expect(passwordProblem("a".repeat(MIN_PASSWORD_LENGTH))).toBeUndefined();
    expect(passwordProblem(PASSWORD)).toBeUndefined();
  });
});
