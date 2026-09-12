import { signOut } from "@/auth";
import { LOGIN_PATH } from "@/lib/auth/routes";

/**
 * Clears a session and sends the visitor to the login screen.
 *
 * This exists because a JWT session outlives the account behind it. When
 * `requireUser()` finds the row deleted or deactivated it cannot clear the
 * cookie itself — a Server Component may not write one — and redirecting to
 * /login is useless, because the proxy sees a structurally valid token and
 * bounces it straight back to /. Without a route that can actually take the
 * cookie away, a deactivated user keeps a working session.
 *
 * GET rather than a form post, so a redirect can reach it. The worst a forged
 * request can do here is sign someone out.
 */
export async function GET(): Promise<void> {
  await signOut({ redirectTo: `${LOGIN_PATH}?reason=session-ended` });
}
