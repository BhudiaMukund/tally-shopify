/**
 * `pnpm shopify:install` — one-time OAuth, to get an admin token.
 *
 * Dev Dashboard apps do not show a per-install token in the UI, and legacy
 * custom apps can no longer be created, so the authorization code grant is the
 * only way to obtain one. It is a script rather than a documented curl because
 * we run it again for every store.
 *
 * It starts a throwaway HTTP server on localhost, opens Shopify's authorize
 * page, verifies the state nonce and the request HMAC on the callback,
 * exchanges the code, and prints the token.
 *
 * The redirect URI it uses must be listed on the app in the Dev Dashboard.
 *
 *   pnpm shopify:install           normal run
 *   pnpm shopify:install --debug   also dump the HMAC message and digests
 */
import { randomUUID, randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import {
  buildAuthorizeUrl,
  isValidShopDomain,
  REQUIRED_SCOPES,
  scopeDifference,
  statesMatch,
  tokenExchangeBody,
  verifyCallbackHmacDetailed,
  type HmacResult,
} from "@/lib/shopify/oauth";

import { openBrowser } from "@/lib/open-browser";

import { loadEnvFiles } from "./load-env";

const PORT = Number(process.env.SHOPIFY_OAUTH_PORT ?? 3456);
const CALLBACK_PATH = "/auth/callback";

/**
 * `--debug`, not an environment variable.
 *
 * `SHOPIFY_OAUTH_DEBUG=1 pnpm shopify:install` is bash syntax. PowerShell reads
 * the assignment as a command name and fails with "is not recognized as the
 * name of a cmdlet", so the script never runs at all — and this is a Windows
 * project. A flag works the same way in every shell.
 */
const DEBUG = process.argv.slice(2).includes("--debug");

/**
 * Prints everything needed to work out why a signature did not match: the
 * query exactly as it arrived, both candidate messages, and both digests
 * beside the one Shopify sent.
 *
 * The client secret is never printed. The dump does contain the shop domain
 * and the one-time authorization code, so it is off by default and the code
 * is spent (or expired) within minutes — but do not paste it somewhere public.
 */
function dumpHmac(rawQuery: string, result: HmacResult): void {
  const line = (label: string, value: string): void =>
    console.log(`\n${label}\n  ${value === "" ? "(empty)" : value}`);

  console.log(`\n${"=".repeat(64)}\nHMAC debug`);
  line("raw callback query string, exactly as received:", rawQuery);
  line("parameters signed (hmac removed), sorted:", result.messages.keys.join(", "));
  line("message - values left percent-encoded:", result.messages.encoded);
  line("message - values URL-decoded:", result.messages.decoded);
  line("digest from the encoded message:", result.computed.encoded);
  line("digest from the decoded message:", result.computed.decoded);
  line("hmac Shopify sent:", result.messages.hmac ?? "(none)");
  line("result:", result.ok ? `matched the ${result.variant} message` : "neither message matched");
  console.log(`${"=".repeat(64)}\n`);
}

class UsageError extends Error {}

function required(name: string, hint: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === "")
    throw new UsageError(`${name} is not set. ${hint}`);
  return value.trim();
}

function reply(response: ServerResponse, status: number, title: string, detail: string): void {
  response.writeHead(status, { "content-type": "text/html; charset=utf-8" });
  response.end(
    `<!doctype html><meta charset="utf-8"><title>${title}</title>` +
      `<body style="font:16px system-ui;padding:3rem;max-width:34rem">` +
      `<h1 style="font-size:1.4rem">${title}</h1><p>${detail}</p></body>`,
  );
}

interface CallbackResult {
  shop: string;
  code: string;
}

function waitForCallback(expectedState: string, clientSecret: string): Promise<CallbackResult> {
  return new Promise((resolve, reject) => {
    const server = createServer((request: IncomingMessage, response: ServerResponse) => {
      const url = new URL(request.url ?? "/", `http://localhost:${PORT}`);
      if (url.pathname !== CALLBACK_PATH) {
        reply(response, 404, "Not this URL", "Waiting for the Shopify callback.");
        return;
      }

      const params = url.searchParams;
      // The raw query string, before any decoding — the HMAC is computed over
      // these exact bytes, so `url.searchParams` is no good for it.
      const rawQuery = (request.url ?? "").split("?")[1] ?? "";

      const fail = (why: string): void => {
        reply(response, 400, "Install failed", why);
        server.close();
        reject(new Error(why));
      };

      // Order matters: the state nonce proves the round trip is ours, the HMAC
      // proves Shopify sent it, and the domain check stops a callback naming
      // some other store from pointing the token exchange elsewhere.
      if (!statesMatch(expectedState, params.get("state"))) {
        fail("The state nonce did not match. Start again.");
        return;
      }

      const hmac = verifyCallbackHmacDetailed(rawQuery, clientSecret);
      if (DEBUG) dumpHmac(rawQuery, hmac);
      if (!hmac.ok) {
        fail(
          "The request HMAC did not verify. Re-run with --debug to see the " +
            "signed message, or check SHOPIFY_API_SECRET.",
        );
        return;
      }
      if (hmac.variant === "decoded") {
        // Worth knowing: it means the encoded form is not what Shopify signed,
        // and the fallback in oauth.ts is load-bearing rather than belt-and-braces.
        console.warn("\nNote: the HMAC matched the URL-decoded message, not the encoded one.");
      }

      const shop = params.get("shop") ?? "";
      const code = params.get("code") ?? "";
      if (!isValidShopDomain(shop)) {
        fail(`The callback named "${shop}", which is not a myshopify.com domain.`);
        return;
      }
      if (code === "") {
        fail("The callback carried no authorization code.");
        return;
      }

      reply(
        response,
        200,
        "Tally is installed",
        "The access token has been printed in your terminal. You can close this tab.",
      );
      server.close();
      resolve({ shop, code });
    });

    server.on("error", reject);
    server.listen(PORT, "127.0.0.1");
  });
}

async function exchangeCode(shop: string, code: string, clientId: string, clientSecret: string) {
  const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: tokenExchangeBody({ clientId, clientSecret, code }),
  });

  if (!response.ok) {
    throw new Error(
      `Token exchange failed: HTTP ${response.status} ${(await response.text()).slice(0, 300)}`,
    );
  }

  const payload = (await response.json()) as { access_token?: string; scope?: string };
  if (typeof payload.access_token !== "string" || payload.access_token === "") {
    throw new Error("Token exchange returned no access_token.");
  }
  return { accessToken: payload.access_token, scope: payload.scope ?? "" };
}

async function main(): Promise<void> {
  loadEnvFiles();

  const shop = required("SHOPIFY_STORE_DOMAIN", "Set it to <store>.myshopify.com in .env.local.");
  const clientId = required(
    "SHOPIFY_API_KEY",
    "It is the Client ID on your app in the Shopify Dev Dashboard.",
  );
  const clientSecret = required(
    "SHOPIFY_API_SECRET",
    "It is the Client secret on your app in the Shopify Dev Dashboard.",
  );

  if (!isValidShopDomain(shop)) {
    throw new UsageError(`SHOPIFY_STORE_DOMAIN is "${shop}", not a <store>.myshopify.com domain.`);
  }

  const redirectUri = `http://localhost:${PORT}${CALLBACK_PATH}`;
  const state = `${randomUUID()}${randomBytes(8).toString("hex")}`;
  const authorizeUrl = buildAuthorizeUrl({ shop, clientId, redirectUri, state });

  console.log(`\nInstalling Tally on ${shop}`);
  console.log(`Scopes: ${REQUIRED_SCOPES.join(", ")}`);
  console.log(`\nThis redirect URL must be listed on the app in the Dev Dashboard:`);
  console.log(`  ${redirectUri}`);

  // Printed on every run, before the browser is touched and whatever the flags.
  // It is the one thing worth seeing if anything downstream goes wrong: if what
  // the browser opens does not match this, the URL was mangled on the way out,
  // not built wrong.
  console.log(`\n${"-".repeat(64)}\nAuthorize URL:\n\n${authorizeUrl}\n${"-".repeat(64)}`);
  console.log(`\nOpening your browser. If nothing opens, paste the URL above.\n`);

  const waiting = waitForCallback(state, clientSecret);
  openBrowser(authorizeUrl);

  const { shop: callbackShop, code } = await waiting;
  const { accessToken, scope } = await exchangeCode(callbackShop, code, clientId, clientSecret);

  const { missing, extra } = scopeDifference(scope);
  if (missing.length > 0) {
    console.warn(`\nWarning: the install did not grant ${missing.join(", ")}.`);
    console.warn("Update the app's scopes in the Dev Dashboard and run this again.");
  }
  if (extra.length > 0) console.warn(`\nNote: also granted ${extra.join(", ")}.`);

  console.log(`\nPaste this into .env.local:\n`);
  console.log(`SHOPIFY_ADMIN_TOKEN=${accessToken}`);
  console.log(`\nThen run: pnpm shopify:doctor\n`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\n${message}\n`);
  process.exitCode = 1;
});
