import { z } from "zod";

/**
 * `users` — staff and admin accounts for the credentials provider (commit 4).
 * Created from the CLI by `scripts/create-user.ts`; there is no sign-up screen.
 */

export const userRole = z.enum(["staff", "admin"]);
export type UserRole = z.infer<typeof userRole>;

export const userSchema = z.object({
  /**
   * Lower-cased on parse so the unique index actually does its job — otherwise
   * `Sam@…` and `sam@…` are two accounts and the login that fails is the one
   * typed on a phone keyboard.
   */
  email: z.email("must be an email address").transform((value) => value.toLowerCase()),
  name: z.string().min(1),
  /** argon2id. Never a plaintext password, never a reversible encoding. */
  passwordHash: z.string().min(1),
  role: userRole,
  /** Deactivating beats deleting: the drafts and inventory events still point here. */
  active: z.boolean().default(true),
  createdAt: z.date(),
});

export type User = z.infer<typeof userSchema>;
