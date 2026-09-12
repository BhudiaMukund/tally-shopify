import type { UserRole } from "@/lib/db/schemas/users";

/**
 * Who may see what, as a pure function.
 *
 * Kept out of the Auth.js config so it can be tested directly: this is the
 * whole access-control policy of the app, and "everything except /login" is
 * the kind of rule that silently inverts when someone adds a route.
 */

export const LOGIN_PATH = "/login";
export const DENIED_PATH = "/denied";
export const HOME_PATH = "/";
/** Clears a session that survived its account. Public: reaching it is the point. */
export const SIGNED_OUT_PATH = "/signed-out";

export type RouteDecision =
  /** Serve it. */
  | "allow"
  /** Not signed in. Send them to /login with a callback back to here. */
  | "sign-in"
  /** Signed in, wrong role. Say so — do not bounce them to a login form. */
  | "forbid"
  /** Already signed in and asking for the login screen. */
  | "home";

/**
 * Routes that authenticate themselves and must never be sent to a login form.
 *
 * Only the Shopify webhook, and only because Shopify has no cookie to send: the
 * HMAC over the raw body is that route's authentication and it is fatal on
 * mismatch (`src/lib/shopify/webhooks.ts`). Redirecting it to /login would turn
 * every delivery into a 307 that Shopify counts as a failure, and after two
 * days of those it removes the subscription — the mirror would go quietly
 * stale rather than loudly broken.
 *
 * Nothing else belongs in here. `/api/inventory` writes to a live store and
 * stays behind a session.
 */
const SELF_AUTHENTICATED_PREFIXES = ["/api/webhooks/"] as const;

function isSelfAuthenticated(pathname: string): boolean {
  return SELF_AUTHENTICATED_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

/** Paths that additionally require the admin role. */
function isAdminOnly(pathname: string): boolean {
  return pathname === "/admin" || pathname.startsWith("/admin/");
}

export function authorizeRoute(pathname: string, role: UserRole | undefined): RouteDecision {
  const signedIn = role !== undefined;

  // Always reachable, signed in or not. Someone whose account was deleted still
  // holds a valid token, and this is the one route that can take it off them —
  // bouncing them to /login instead would send them straight back to /.
  if (pathname === SIGNED_OUT_PATH) return "allow";
  if (isSelfAuthenticated(pathname)) return "allow";

  if (pathname === LOGIN_PATH) return signedIn ? "home" : "allow";
  if (!signedIn) return "sign-in";
  if (isAdminOnly(pathname) && role !== "admin") return "forbid";
  return "allow";
}

/**
 * The origin a callback URL is resolved against. Deliberately not the real
 * hostname: nothing absolute is ever returned, so this only has to be a fixed
 * origin that no attacker can also be at. `.invalid` is reserved by RFC 2606.
 */
const TRUSTED_ORIGIN = "https://callback.invalid";

/**
 * Reduces a `callbackUrl` to a path on this site, or drops it.
 *
 * Anything that survives is pasted into a redirect after a successful login,
 * so an attacker-supplied value is an open redirect — and on a login screen
 * that is a credible phishing hop.
 *
 * Prefix checks alone are not enough, which is why the value is resolved and
 * the result compared by origin. The URL parser strips tab, newline and
 * carriage return anywhere in a URL, so `/<tab>/evil.example` passes a
 * `startsWith("//")` test and then loads `https://evil.example/` — the
 * characters that made it look like a path are gone by the time it is
 * followed. Returning the *parsed* path rather than the input is the other
 * half of the fix: it is what strips those characters here too.
 */
export function safeCallbackUrl(value: string | null | undefined): string | undefined {
  if (typeof value !== "string" || value === "") return undefined;
  if (!value.startsWith("/")) return undefined;
  if (value.startsWith("//")) return undefined;
  // `/\evil.com` is read as a protocol-relative URL by some browsers.
  if (value.startsWith("/\\")) return undefined;

  let resolved: URL;
  try {
    resolved = new URL(value, TRUSTED_ORIGIN);
  } catch {
    return undefined;
  }
  if (resolved.origin !== TRUSTED_ORIGIN) return undefined;

  const path = `${resolved.pathname}${resolved.search}`;
  if (path.startsWith(LOGIN_PATH)) return undefined;
  return path;
}
