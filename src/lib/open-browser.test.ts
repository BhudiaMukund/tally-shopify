import { describe, expect, it } from "vitest";

import { buildAuthorizeUrl } from "@/lib/shopify/oauth";

import { browserCommand } from "./open-browser";

/**
 * The authorize URL is built correctly and printed correctly; it was being
 * destroyed on the way to the browser. These pin the handoff.
 */
const AUTHORIZE_URL = buildAuthorizeUrl({
  shop: "example-store.myshopify.com",
  clientId: "client-id",
  redirectUri: "http://localhost:3456/auth/callback",
  state: "nonce",
});

describe("browserCommand", () => {
  it("passes the URL as one intact argument on every platform", () => {
    for (const platform of ["win32", "darwin", "linux"] as const) {
      const { args } = browserCommand(platform, AUTHORIZE_URL);
      expect(args.filter((arg) => arg === AUTHORIZE_URL)).toHaveLength(1);
      expect(args.at(-1)).toBe(AUTHORIZE_URL);
    }
  });

  it("never routes a URL through cmd on Windows", () => {
    // `cmd /c start` is what dropped every parameter after the first &.
    const { command, args } = browserCommand("win32", AUTHORIZE_URL);
    expect(command.toLowerCase()).not.toContain("cmd");
    expect(args).not.toContain("/c");
    expect(args).not.toContain("start");
  });

  it("keeps every query parameter the URL was built with", () => {
    const { args } = browserCommand("win32", AUTHORIZE_URL);
    const opened = new URL(args.at(-1) as string);
    expect(opened.searchParams.get("redirect_uri")).toBe("http://localhost:3456/auth/callback");
    expect(opened.searchParams.get("state")).toBe("nonce");
    expect(opened.searchParams.get("client_id")).toBe("client-id");
    expect(opened.searchParams.get("scope")).toContain("write_inventory");
  });

  it("survives a URL whose parameters a shell would treat as operators", () => {
    const nasty = "https://example.test/a?x=1&y=2&z=3";
    for (const platform of ["win32", "darwin", "linux"] as const) {
      expect(browserCommand(platform, nasty).args.at(-1)).toBe(nasty);
    }
  });
});
