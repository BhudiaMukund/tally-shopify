import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { authConfig } from "./auth.config";
import type { UserRole } from "./lib/db/schemas/users";

/**
 * The proxy's decision, exercised through the actual Auth.js callback.
 *
 * `routes.test.ts` covers the policy; this covers the wiring, which failed
 * silently once already. Returning `false` from `authorized` is ignored
 * whenever a handler is passed alongside it — next-auth's `lib/index.js` runs
 * `else if (userMiddlewareOrRoute)` before `else if (!authorized)` — so every
 * refusal here has to be a Response, and nothing but a test at this level
 * notices when it stops being one.
 */

function decide(pathname: string, role: UserRole | undefined) {
  const request = new NextRequest(new URL(`https://tally.example.com${pathname}`));
  const auth = role === undefined ? null : { user: { role }, expires: "" };

  // The callback is sync in our config; the type allows a promise.
  return authConfig.callbacks.authorized({
    request,
    auth,
  } as Parameters<typeof authConfig.callbacks.authorized>[0]);
}

function locationOf(result: unknown): string {
  expect(result).toBeInstanceOf(Response);
  const location = (result as Response).headers.get("location");
  expect(location).not.toBeNull();
  return new URL(location as string).pathname + new URL(location as string).search;
}

describe("authorized", () => {
  it("refuses with a redirect, never with a bare false", () => {
    // The regression. `false` would be dropped and the request served.
    for (const [path, role] of [
      ["/scan", undefined],
      ["/admin", "staff"],
      ["/login", "staff"],
    ] as const) {
      expect(decide(path, role)).toBeInstanceOf(Response);
    }
  });

  it("sends a signed-out visitor to the login screen, carrying where they were going", () => {
    expect(locationOf(decide("/scan", undefined))).toBe("/login?callbackUrl=%2Fscan");
  });

  it("does not bother with a callbackUrl for the home page", () => {
    expect(locationOf(decide("/", undefined))).toBe("/login");
  });

  it("sends staff asking for an admin route to the explanation, not to a login form", () => {
    expect(locationOf(decide("/admin/review", "staff"))).toBe("/denied?from=%2Fadmin%2Freview");
  });

  it("sends an already-signed-in person off the login screen", () => {
    expect(locationOf(decide("/login", "admin"))).toBe("/");
  });

  it("lets the allowed cases through", () => {
    expect(decide("/login", undefined)).toBe(true);
    expect(decide("/scan", "staff")).toBe(true);
    expect(decide("/admin/review", "admin")).toBe(true);
  });
});

describe("session", () => {
  it("lasts 30 days, so staff are not asked to sign in mid-shift", () => {
    expect(authConfig.session.maxAge).toBe(30 * 24 * 60 * 60);
  });

  it("is a JWT, which the credentials provider requires", () => {
    // @auth/core throws UnsupportedStrategy for credentials + "database".
    expect(authConfig.session.strategy).toBe("jwt");
  });
});
