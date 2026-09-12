import { NextResponse } from "next/server";
import type { NextAuthConfig } from "next-auth";

import { authorizeRoute, DENIED_PATH, HOME_PATH, LOGIN_PATH } from "@/lib/auth/routes";
import { userRole } from "@/lib/db/schemas/users";

/**
 * The half of the Auth.js config that needs no database.
 *
 * `src/proxy.ts` builds its own Auth.js instance from this alone, so route
 * protection costs a cookie decode and nothing else — no Mongo connection, no
 * argon2 native module, on every request in the app. The credentials provider,
 * which needs both, is added in `src/auth.ts` for the server runtime.
 */

/**
 * Thirty days. Staff must not be asked to re-authenticate mid-shift, on a
 * phone, wearing gloves, in a stockroom.
 */
const THIRTY_DAYS_IN_SECONDS = 30 * 24 * 60 * 60;

export const authConfig = {
  /**
   * JWT, not database sessions — not a preference.
   * `@auth/core` returns `UnsupportedStrategy` ("Signing in with credentials
   * only supported if JWT strategy is enabled") when a credentials provider
   * meets `strategy: "database"`, and configuring an adapter is what flips the
   * default to "database" in the first place. See `lib/utils/assert.js`.
   *
   * The cost is that a token stays syntactically valid until it expires, so
   * deactivating an account does not invalidate one already issued. That is
   * why `active` is re-read from Mongo in `requireUser()` rather than trusted
   * from the token: the proxy does cheap routing, the guards do the real check.
   */
  session: { strategy: "jwt", maxAge: THIRTY_DAYS_IN_SECONDS },
  pages: { signIn: LOGIN_PATH, error: LOGIN_PATH },
  /** One host, behind a tunnel that terminates TLS. There is no origin to guess. */
  trustHost: true,
  providers: [],
  callbacks: {
    /**
     * Runs on sign-in and on every token read. `user` is only present the
     * first time, so the role is copied onto the token once and rides along
     * from then on.
     */
    jwt({ token, user }) {
      if (user) {
        token.role = user.role;
        token.name = user.name;
      }
      return token;
    },

    session({ session, token }) {
      if (token.sub) session.user.id = token.sub;
      // A token minted before `role` existed, or tampered with, must not
      // silently read as an admin — parse it rather than assigning it.
      const role = userRole.safeParse(token.role);
      session.user.role = role.success ? role.data : "staff";
      return session;
    },

    /**
     * The single gate every request passes through. See `lib/auth/routes.ts`.
     *
     * Every "no" returns a Response rather than `false`. Auth.js only honours
     * `false` when no handler is passed alongside it — `lib/index.js` runs
     * `else if (userMiddlewareOrRoute)` before `else if (!authorized)`, so with
     * a handler present a `false` here would be dropped on the floor and the
     * request served. Building the redirect explicitly also means the
     * callbackUrl is a path this app will accept back: Auth.js's own default
     * writes the full absolute href, which `safeCallbackUrl` rejects.
     */
    authorized({ request, auth }) {
      const { pathname, search } = request.nextUrl;
      const decision = authorizeRoute(pathname, auth?.user?.role);
      if (decision === "allow") return true;

      if (decision === "sign-in") {
        const target = new URL(LOGIN_PATH, request.nextUrl.origin);
        const from = `${pathname}${search}`;
        if (from !== HOME_PATH) target.searchParams.set("callbackUrl", from);
        return NextResponse.redirect(target);
      }

      const target = new URL(decision === "home" ? HOME_PATH : DENIED_PATH, request.nextUrl.origin);
      if (decision === "forbid") target.searchParams.set("from", `${pathname}${search}`);
      return NextResponse.redirect(target);
    },
  },
} satisfies NextAuthConfig;
