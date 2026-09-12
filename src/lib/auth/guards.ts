import { ObjectId } from "mongodb";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { getDb } from "@/lib/db/client";
import { users } from "@/lib/db/collections";
import type { UserRole } from "@/lib/db/schemas/users";

import { DENIED_PATH, LOGIN_PATH, SIGNED_OUT_PATH } from "./routes";

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
 * The account behind a session, re-read from Mongo — `undefined` when there is
 * no session at all, `null` when there is one but the account it names was
 * deactivated or deleted since the token was issued. The token itself stays
 * structurally valid for 30 days, so this read is what actually locks them
 * out; the two "no" cases stay distinguishable because `requireUser` sends
 * each to a different place.
 */
async function currentAccount(): Promise<CurrentUser | null | undefined> {
  const session = await auth();
  if (session === null) return undefined;

  const id = session.user?.id;
  if (id === undefined || !ObjectId.isValid(id)) return null;

  const db = await getDb();
  const account = await users(db).findOne({ _id: new ObjectId(id) });
  if (account === null || !account.active) return null;

  return { id, email: account.email, name: account.name, role: account.role };
}

/**
 * For a page or a page-tree layout. No session at all goes to /login. A
 * session whose account no longer stands behind it goes to /signed-out
 * instead, which takes the cookie away first: the token is still structurally
 * valid, so /login would hand it to the proxy, which would read a perfectly
 * good session and bounce it back to /.
 */
export async function requireUser(): Promise<CurrentUser> {
  const account = await currentAccount();
  if (account === undefined) redirect(LOGIN_PATH);
  if (account === null) redirect(SIGNED_OUT_PATH);
  return account;
}

/** As `requireUser`, and admin-only. Staff land on /denied, not on a login form. */
export async function requireAdmin(): Promise<CurrentUser> {
  const user = await requireUser();
  if (user.role !== "admin") redirect(DENIED_PATH);
  return user;
}

/**
 * As `requireUser`, but for a route handler answering `fetch()` rather than a
 * page load: `redirect()` would hand the phone a 307 to follow into an HTML
 * login page, which is not a shape `POST /api/inventory`'s caller can do
 * anything with. Returns `null` instead so the route can answer with its own
 * JSON 401, whether there was no session or a deactivated one — a route
 * handler has no separate place to send either.
 */
export async function requireApiUser(): Promise<CurrentUser | null> {
  const account = await currentAccount();
  return account ?? null;
}
