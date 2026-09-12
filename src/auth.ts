import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";

import { authConfig } from "@/auth.config";
import { verifyPassword } from "@/lib/auth/password";
import { findUserByEmail } from "@/lib/auth/users";

/**
 * The full Auth.js instance: the edge-free config plus the credentials
 * provider, which reads Mongo and runs argon2. Server runtime only — the proxy
 * deliberately does not import this file.
 */

const credentialsSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});

/** What the login form is told. Never which half was wrong. */
export class InvalidCredentials extends CredentialsSignin {
  code = "credentials";
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) throw new InvalidCredentials();

        const user = await findUserByEmail(parsed.data.email);

        // Hashes even when there is no such account — see verifyPassword.
        const correct = await verifyPassword(user?.passwordHash, parsed.data.password);

        // A deactivated account fails exactly like a wrong password. Telling
        // someone their account exists but is switched off is a favour to
        // whoever is guessing emails, and none to the person who was offboarded.
        if (!user || !correct || !user.active) throw new InvalidCredentials();

        return {
          id: user._id.toHexString(),
          email: user.email,
          name: user.name,
          role: user.role,
        };
      },
    }),
  ],
});
