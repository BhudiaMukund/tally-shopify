import type { UserRole } from "@/lib/db/schemas/users";

/**
 * Puts `role` on the session, the user and the token.
 *
 * `UserRole` is inferred from the Zod schema in `lib/db/schemas/users.ts`, so
 * adding a third role is one edit there and this follows.
 */
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email: string;
      name: string;
      role: UserRole;
    };
  }

  interface User {
    role: UserRole;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: UserRole;
  }
}

export {};
