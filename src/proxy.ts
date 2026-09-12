import NextAuth from "next-auth";
import type { NextFetchEvent, NextRequest } from "next/server";

import { authConfig } from "@/auth.config";

/**
 * Route protection. `proxy.ts` is Next 16's replacement for `middleware.ts`
 * (renamed in v16), and the file must export a function named `proxy` or a
 * default — a destructured `export const { auth: proxy }` is not statically
 * analysable and Next refuses to load it.
 *
 * This builds its own Auth.js instance from the database-free config rather
 * than importing `@/auth`, which would pull Mongo and a native argon2 binary
 * into a file that runs ahead of every request. Deciding whether a cookie is
 * allowed through needs neither.
 */
const { auth } = NextAuth(authConfig);

/**
 * The `authorized` callback in `auth.config.ts` makes the whole decision and
 * short-circuits when the answer is no, so the wrapped handler has nothing
 * left to do: returning nothing means "carry on and serve the route".
 *
 * Both parameters are annotated even though neither is used. `auth()` is
 * overloaded, and a callback with no declared parameters matches the route
 * handler overload first — which types the result as an `AppRouteHandlerFn`
 * wanting a `params` context, not as middleware.
 */
const handler = auth((_request: NextRequest, _event: NextFetchEvent) => undefined);

export function proxy(request: NextRequest, event: NextFetchEvent) {
  return handler(request, event);
}

export const config = {
  matcher: [
    /*
     * Everything except:
     * - api/auth  (Auth.js's own endpoints — protecting them locks out login)
     * - _next/static, _next/image  (build output)
     * - the metadata and icon files served from the app root
     *
     * Our own /api routes are deliberately NOT excluded: /api/inventory writes
     * to a live store and must not be reachable without a session.
     */
    "/((?!api/auth|_next/static|_next/image|favicon.ico|icon.png|apple-icon.png|manifest.webmanifest|robots.txt|sitemap.xml).*)",
  ],
};
