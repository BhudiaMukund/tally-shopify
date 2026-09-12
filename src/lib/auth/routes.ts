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

export type RouteDecision =
  /** Serve it. */
  | "allow"
  /** Not signed in. Send them to /login with a callback back to here. */
  | "sign-in"
  /** Signed in, wrong role. Say so — do not bounce them to a login form. */
  | "forbid"
  /** Already signed in and asking for the login screen. */
  | "home";

/** Paths served without a session. Everything not named here needs one. */
function isPublic(pathname: string): boolean {
  return pathname === LOGIN_PATH;
}

/** Paths that additionally require the admin role. */
function isAdminOnly(pathname: string): boolean {
  return pathname === "/admin" || pathname.startsWith("/admin/");
}

export function authorizeRoute(pathname: string, role: UserRole | undefined): RouteDecision {
  const signedIn = role !== undefined;

  if (isPublic(pathname)) return signedIn ? "home" : "allow";
  if (!signedIn) return "sign-in";
  if (isAdminOnly(pathname) && role !== "admin") return "forbid";
  return "allow";
}

/**
 * Reduces a `callbackUrl` to a path on this site, or drops it.
 *
 * Anything that survives is pasted into a redirect after a successful login,
 * so an attacker-supplied value is an open redirect — and on a login screen
 * that is a credible phishing hop. Only a single-slash absolute path is kept:
 * `//evil.com` is protocol-relative and `https://evil.com` is plainly off-site.
 */
export function safeCallbackUrl(value: string | null | undefined): string | undefined {
  if (typeof value !== "string" || value === "") return undefined;
  if (!value.startsWith("/")) return undefined;
  if (value.startsWith("//")) return undefined;
  // `/\evil.com` is read as a protocol-relative URL by some browsers.
  if (value.startsWith("/\\")) return undefined;
  if (value.startsWith(LOGIN_PATH)) return undefined;
  return value;
}
