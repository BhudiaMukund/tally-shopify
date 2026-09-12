import type { ReactNode } from "react";

import { requireUser } from "@/lib/auth/guards";

/**
 * Everything an ordinary signed-in person uses sits in this group, so that one
 * `requireUser()` covers all of it.
 *
 * The proxy alone only proves the cookie is well-formed and unexpired. It
 * cannot know the account was deactivated an hour ago, because a JWT session
 * carries no database read — so without this, someone offboarded this morning
 * keeps the scanning app until their token expires. `/login` and `/signed-out`
 * stay outside the group; `/admin` has its own `requireAdmin()`.
 *
 * A route group changes no URLs: these are still `/` and `/kitchen-sink`.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  await requireUser();
  return children;
}
