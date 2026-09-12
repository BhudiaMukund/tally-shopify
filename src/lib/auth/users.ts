import type { WithId } from "mongodb";

import { getDb } from "@/lib/db/client";
import { users } from "@/lib/db/collections";
import { userSchema, type User, type UserRole } from "@/lib/db/schemas/users";

import { hashPassword } from "./password";

/** Reads and writes of the `users` collection. The only place accounts are touched. */

/** Emails are stored lower-cased; look them up the same way or the index misses. */
function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function findUserByEmail(email: string): Promise<WithId<User> | null> {
  const db = await getDb();
  return users(db).findOne({ email: normaliseEmail(email) });
}

export interface CreateUserInput {
  email: string;
  name: string;
  role: UserRole;
  password: string;
}

export class DuplicateEmailError extends Error {
  constructor(email: string) {
    super(`An account already exists for ${email}.`);
    this.name = "DuplicateEmailError";
  }
}

/**
 * Creates an account. The password is hashed here and never held anywhere else
 * — the caller passes plaintext in and gets an id out.
 */
export async function createUser(input: CreateUserInput): Promise<string> {
  const user = userSchema.parse({
    email: input.email,
    name: input.name,
    role: input.role,
    passwordHash: await hashPassword(input.password),
    createdAt: new Date(),
  });

  const db = await getDb();
  try {
    const result = await users(db).insertOne(user);
    return result.insertedId.toHexString();
  } catch (error) {
    // The unique index on email is the real guard; this only translates it.
    if ((error as { code?: number }).code === 11000) throw new DuplicateEmailError(user.email);
    throw error;
  }
}
