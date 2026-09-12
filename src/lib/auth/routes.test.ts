import { describe, expect, it } from "vitest";

import { authorizeRoute, safeCallbackUrl } from "./routes";

/**
 * The access policy of the whole app. "Everything except /login" is the kind
 * of rule that inverts silently when someone adds a route, so every branch is
 * pinned here rather than inferred from reading the proxy.
 */

describe("authorizeRoute", () => {
  it("lets a signed-out person reach the login screen and nothing else", () => {
    expect(authorizeRoute("/login", undefined)).toBe("allow");

    for (const path of ["/", "/scan", "/admin", "/admin/review", "/api/inventory", "/denied"]) {
      expect(authorizeRoute(path, undefined)).toBe("sign-in");
    }
  });

  it("always lets anyone reach /signed-out, whatever they are holding", () => {
    // It is the only route that can take a cookie away. Sending a signed-in
    // visitor "home" from here, the way /login does, would strand someone
    // whose account was deleted: their token still reads as valid, so /login
    // returns them to / and nothing ever clears it.
    expect(authorizeRoute("/signed-out", undefined)).toBe("allow");
    expect(authorizeRoute("/signed-out", "staff")).toBe("allow");
    expect(authorizeRoute("/signed-out", "admin")).toBe("allow");
  });

  it("protects our own API routes — /api/inventory writes to a live store", () => {
    expect(authorizeRoute("/api/inventory", undefined)).toBe("sign-in");
    expect(authorizeRoute("/api/intake", undefined)).toBe("sign-in");
    expect(authorizeRoute("/api/inventory", "staff")).toBe("allow");
  });

  it("lets the Shopify webhook through — it carries an HMAC, not a cookie", () => {
    expect(authorizeRoute("/api/webhooks/shopify", undefined)).toBe("allow");
    // A redirect to /login reads as a failed delivery, and two days of those
    // and Shopify deletes the subscription.
    expect(authorizeRoute("/api/webhooks/shopify", "staff")).toBe("allow");
  });

  it("does not open a route that merely looks like the webhook path", () => {
    expect(authorizeRoute("/api/webhooks-admin", undefined)).toBe("sign-in");
    expect(authorizeRoute("/admin/api/webhooks/shopify", undefined)).toBe("sign-in");
  });

  it("bounces staff off the admin routes without pretending they are signed out", () => {
    // "forbid", not "sign-in": a login form is a useless answer to someone who
    // is already signed in as themselves.
    expect(authorizeRoute("/admin", "staff")).toBe("forbid");
    expect(authorizeRoute("/admin/review", "staff")).toBe("forbid");
    expect(authorizeRoute("/admin/review/123", "staff")).toBe("forbid");
  });

  it("lets an admin through the admin routes", () => {
    expect(authorizeRoute("/admin", "admin")).toBe("allow");
    expect(authorizeRoute("/admin/review", "admin")).toBe("allow");
  });

  it("does not treat a route that merely starts with the letters admin as admin-only", () => {
    // /administrators or /admin-help must not inherit the rule by prefix luck.
    expect(authorizeRoute("/administrators", "staff")).toBe("allow");
    expect(authorizeRoute("/admin-help", "staff")).toBe("allow");
  });

  it("sends an already-signed-in person away from the login screen", () => {
    expect(authorizeRoute("/login", "staff")).toBe("home");
    expect(authorizeRoute("/login", "admin")).toBe("home");
  });

  it("gives staff the ordinary app", () => {
    for (const path of ["/", "/scan", "/scan/123", "/denied"]) {
      expect(authorizeRoute(path, "staff")).toBe("allow");
    }
  });
});

describe("safeCallbackUrl", () => {
  it("keeps a path on this site", () => {
    expect(safeCallbackUrl("/scan")).toBe("/scan");
    expect(safeCallbackUrl("/admin/review?status=pending")).toBe("/admin/review?status=pending");
  });

  it("drops anything that would leave the site", () => {
    // Each of these is an open redirect off a login screen, which is a
    // credible phishing hop: the victim really did just type a password.
    expect(safeCallbackUrl("//evil.example")).toBeUndefined();
    expect(safeCallbackUrl("https://evil.example")).toBeUndefined();
    expect(safeCallbackUrl("http://evil.example")).toBeUndefined();
    expect(safeCallbackUrl("/\\evil.example")).toBeUndefined();
    expect(safeCallbackUrl("javascript:alert(1)")).toBeUndefined();
    expect(safeCallbackUrl("evil.example")).toBeUndefined();
  });

  it("drops a path whose slashes are only hidden by a stripped character", () => {
    // The URL parser removes tab, newline and carriage return from anywhere in
    // a URL, so each of these starts with a single slash on inspection and
    // resolves to https://evil.example/ when followed. A startsWith("//")
    // check passes every one of them.
    expect(safeCallbackUrl("/\t/evil.example")).toBeUndefined();
    expect(safeCallbackUrl("/\n/evil.example")).toBeUndefined();
    expect(safeCallbackUrl("/\r/evil.example")).toBeUndefined();
    expect(safeCallbackUrl("/\t\t//evil.example")).toBeUndefined();
    expect(safeCallbackUrl("/\r\n/evil.example")).toBeUndefined();
  });

  it("strips those characters out of a path it does keep", () => {
    // Returning the input verbatim would hand the stripping back to whatever
    // follows the redirect. The parsed path is what gets returned.
    expect(safeCallbackUrl("/sc\tan")).toBe("/scan");
    expect(safeCallbackUrl("/scan\n")).toBe("/scan");
  });

  it("refuses to bounce back to the login screen", () => {
    expect(safeCallbackUrl("/login")).toBeUndefined();
    expect(safeCallbackUrl("/login?callbackUrl=%2Fscan")).toBeUndefined();
  });

  it("treats an absent or empty value as no destination", () => {
    expect(safeCallbackUrl(undefined)).toBeUndefined();
    expect(safeCallbackUrl(null)).toBeUndefined();
    expect(safeCallbackUrl("")).toBeUndefined();
  });
});
