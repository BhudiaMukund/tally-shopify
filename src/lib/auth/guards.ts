import { ObjectId } from "mongodb";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { getDb } from "@/lib/db/client";
import { users } from "@/lib/db/collections";
import type { UserRole } from "@/lib/db/schemas/users";

import { DENIED_PATH, LOGIN_PATH } from "./routes";

/**
 * The authoritative check, for a page or a route handler.
 *
 * The proxy is not enough on its own, for two reasons. Next's own docs warn
 * that "a matcher change or a refactor that moves a Server Function to a
 * different route can silently remove Proxy coverage", and recommend checking
 * inside the function. And because sessions are JWTs (see auth.config.ts), the
 * proxy cannot know that an account was deactivated an hour ago — only a read
 * of the `users` collection knows that.
 *
 * So: the proxy does cheap stateless routing, and this does the real check.
 */

export interface CurrentUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
}

/**
 * The signed-in user, re-read from Mongo. Redirects to /login if there is no
 * session, or if the account behind it has since been deactivated or deleted.
 */
export async function requireUser(): Promise<CurrentUser> {
  const session = await auth();
  const id = session?.user?.id;
  if (id === undefined || !ObjectId.isValid(id)) redirect(LOGIN_PATH);

  const db = await getDb();
  const account = await users(db).findOne({ _id: new ObjectId(id) });

  // Deactivated, deleted, or demoted since the token was issued. The token
  // itself stays valid for 30 days; this is what actually locks them out.
  if (account === null || !account.active) redirect(LOGIN_PATH);

  return {
    id,
    email: account.email,
    name: account.name,
    role: account.role,
  };
}

/** As `requireUser`, and admin-only. Staff land on /denied, not on a login form. */
export async function requireAdmin(): Promise<CurrentUser> {
  const user = await requireUser();
  if (user.role !== "admin") redirect(DENIED_PATH);
  return user;
}
